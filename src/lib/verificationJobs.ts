import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  claim,
  class_,
  department,
  receipt,
  statement,
  statementVerificationAttempt,
  teamSplit,
} from "@/db/schema";
import {
  OpusError,
  type ReceiptMeta,
  executeJob,
  getJobResultFile,
  getJobStatus,
  getUploadUrl,
  initiateJob,
  uploadFileToPresignedUrl,
} from "@/lib/opus";
import { downloadDriveFileAsBuffer, uploadDriveFileFromBuffer } from "@/lib/drive";
import { finalizeAttempt } from "@/lib/verification";

/**
 * Shared logic behind the `verification-submit` / `verification-poll` schedulers.
 * Callable both from the standalone tsx CLI scripts (src/scripts/*) and from the
 * authenticated /api/cron/* routes, so there is exactly one implementation of each job.
 * Neither function calls process.exit — that is the caller's responsibility.
 */

const SUBMIT_LOG = "[verification-submit]";
const POLL_LOG = "[verification-poll]";

const REMARK_NO_RECEIPTS = "No receipts on the linked claim to verify against.";
const REMARK_DRIVE = "File/Folder is not found, please check in Google Drive.";
const REMARK_OPUS = "Error from OPUS, please check in OPUS or retry";
const REMARK_TIMED_OUT = "Verification timed out in OPUS, please retry.";
const REMARK_STOPPED = "Verification was stopped in OPUS, please check in OPUS or retry.";
const REMARK_NOT_STARTED = "Verification did not start in time, please retry.";
const REMARK_NO_RESULT = "Verification succeeded but no result file was returned by OPUS.";
const REMARK_UPLOAD_FAILED =
  "Verification succeeded but the result file could not be uploaded to Google Drive.";

function fileExtensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : "";
}

export interface VerificationSubmitResult {
  ok: number;
  failed: number;
  batchSize: number;
  ms: number;
}

export async function runVerificationSubmit(): Promise<VerificationSubmitResult> {
  const start = Date.now();
  const BATCH = Number(process.env.VERIFICATION_SUBMIT_BATCH_SIZE ?? 5);

  // ── Step 1: atomically claim a batch of queued attempts (lock + flip). ──
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        attemptId: statementVerificationAttempt.id,
        statementId: statement.id,
        statementDisplayId: statement.displayId,
        statementDriveFileId: statement.driveFileId,
        statementFileName: statement.fileName,
        statementFileMimeType: statement.fileMimeType,
        claimId: claim.id,
        claimDisplayId: claim.displayId,
        claimDriveNetsuiteFolderId: claim.driveNetsuiteFolderId,
      })
      .from(statementVerificationAttempt)
      .innerJoin(statement, eq(statementVerificationAttempt.statementId, statement.id))
      .innerJoin(claim, eq(statement.claimId, claim.id))
      .where(
        and(
          eq(statementVerificationAttempt.status, "queued"),
          isNull(statement.deletedAt),
          isNull(claim.deletedAt),
        ),
      )
      .orderBy(asc(statementVerificationAttempt.createdAt))
      .limit(BATCH)
      .for("update", { of: statementVerificationAttempt, skipLocked: true });

    if (rows.length === 0) return rows;

    const now = new Date();
    const attemptIds = rows.map((r) => r.attemptId);
    const statementIds = rows.map((r) => r.statementId);

    await tx
      .update(statementVerificationAttempt)
      .set({ status: "in_progress", updatedAt: now })
      .where(inArray(statementVerificationAttempt.id, attemptIds));

    await tx
      .update(statement)
      .set({ verificationStatus: "in_progress", updatedAt: now })
      .where(inArray(statement.id, statementIds));

    return rows;
  });

  let ok = 0;
  let failed = 0;

  // ── Step 2: per attempt — upload files, initiate, execute, record. ──
  for (const row of claimed) {
    console.log(`${SUBMIT_LOG} Processing attempt ${row.attemptId} (statement ${row.statementDisplayId}).`);

    // 1. Load receipts for the claim, joining the name lookups the metadata
    //    input needs (opus-api.md §6.1). department/class are notNull FKs →
    //    inner join; team_split is nullable → left join.
    const receipts = await db
      .select({
        id: receipt.id,
        driveFileId: receipt.driveFileId,
        fileName: receipt.fileName,
        departmentName: department.name,
        className: class_.name,
        teamSplitName: teamSplit.name,
        projectCode: receipt.projectCode,
      })
      .from(receipt)
      .innerJoin(department, eq(receipt.departmentId, department.id))
      .innerJoin(class_, eq(receipt.classId, class_.id))
      .leftJoin(teamSplit, eq(receipt.teamSplitId, teamSplit.id))
      .where(eq(receipt.claimId, row.claimId));

    if (receipts.length === 0) {
      console.warn(`${SUBMIT_LOG} Attempt ${row.attemptId}: claim has no receipts.`);
      await finalizeAttempt({
        attemptId: row.attemptId,
        statementId: row.statementId,
        status: "failed",
        remarks: REMARK_NO_RECEIPTS,
      });
      failed++;
      continue;
    }

    // 2. Upload the statement + every receipt to Opus.
    let statementFileUrl: string;
    const receiptMetas: ReceiptMeta[] = [];
    try {
      // Statement.
      console.log(`${SUBMIT_LOG} Attempt ${row.attemptId}: [get-upload-url] statement "${row.statementFileName}".`);
      const stmtUpload = await getUploadUrl({
        fileExtension: fileExtensionOf(row.statementFileName),
        originalName: row.statementFileName,
      });
      const stmtFile = await downloadDriveFileAsBuffer(row.statementDriveFileId);
      console.log(
        `${SUBMIT_LOG} Attempt ${row.attemptId}: [file-upload] statement "${row.statementFileName}" (${stmtFile.buffer.length} bytes) → ${stmtUpload.fileUrl}.`,
      );
      await uploadFileToPresignedUrl({
        presignedUrl: stmtUpload.presignedUrl,
        body: stmtFile.buffer,
        contentType: row.statementFileMimeType,
      });
      statementFileUrl = stmtUpload.fileUrl;

      // Receipts.
      let receiptIdx = 0;
      for (const r of receipts) {
        receiptIdx++;
        console.log(
          `${SUBMIT_LOG} Attempt ${row.attemptId}: [get-upload-url] receipt ${receiptIdx}/${receipts.length} "${r.fileName}".`,
        );
        const upload = await getUploadUrl({
          fileExtension: fileExtensionOf(r.fileName),
          originalName: r.fileName,
        });
        const file = await downloadDriveFileAsBuffer(r.driveFileId);
        console.log(
          `${SUBMIT_LOG} Attempt ${row.attemptId}: [file-upload] receipt ${receiptIdx}/${receipts.length} "${r.fileName}" (${file.buffer.length} bytes) → ${upload.fileUrl}.`,
        );
        await uploadFileToPresignedUrl({
          presignedUrl: upload.presignedUrl,
          body: file.buffer,
          contentType: file.mimeType,
        });
        // Pair the uploaded fileUrl with the receipt's metadata (nulls → "").
        // executeJob derives the metadata `filename` from this fileUrl's basename.
        receiptMetas.push({
          fileUrl: upload.fileUrl,
          department: r.departmentName ?? "",
          class: r.className ?? "",
          projectCode: r.projectCode ?? "",
          teamSplit: r.teamSplitName ?? "",
        });
      }
    } catch (err) {
      const fromOpus = err instanceof OpusError;
      console.error(`${SUBMIT_LOG} Attempt ${row.attemptId}: file gather/upload failed:`, err);
      await finalizeAttempt({
        attemptId: row.attemptId,
        statementId: row.statementId,
        status: "failed",
        remarks: fromOpus ? REMARK_OPUS : REMARK_DRIVE,
      });
      failed++;
      continue;
    }

    // 3. Initiate — persist the job id immediately (before Execute).
    let jobExecutionId: string;
    try {
      console.log(`${SUBMIT_LOG} Attempt ${row.attemptId}: [initiate] initializing workflow.`);
      ({ jobExecutionId } = await initiateJob());
      console.log(`${SUBMIT_LOG} Attempt ${row.attemptId}: [initiate] job ${jobExecutionId}.`);
      await db
        .update(statementVerificationAttempt)
        .set({ opusJobId: jobExecutionId, updatedAt: new Date() })
        .where(eq(statementVerificationAttempt.id, row.attemptId));
    } catch (err) {
      console.error(`${SUBMIT_LOG} Attempt ${row.attemptId}: initiate failed:`, err);
      await finalizeAttempt({
        attemptId: row.attemptId,
        statementId: row.statementId,
        status: "failed",
        remarks: REMARK_OPUS,
      });
      failed++;
      continue;
    }

    // 4. Execute — then record the response. Status stays in_progress.
    try {
      console.log(
        `${SUBMIT_LOG} Attempt ${row.attemptId}: [execute] job ${jobExecutionId} (1 statement, ${receiptMetas.length} receipts).`,
      );
      const { raw } = await executeJob({
        jobExecutionId,
        statementFileUrl,
        receipts: receiptMetas,
        netsuiteFolderId: row.claimDriveNetsuiteFolderId,
      });
      await db
        .update(statementVerificationAttempt)
        .set({ opusResponse: raw, updatedAt: new Date() })
        .where(eq(statementVerificationAttempt.id, row.attemptId));
      ok++;
      console.log(`${SUBMIT_LOG} Attempt ${row.attemptId}: submitted (job ${jobExecutionId}).`);
    } catch (err) {
      console.error(`${SUBMIT_LOG} Attempt ${row.attemptId}: execute failed:`, err);
      await finalizeAttempt({
        attemptId: row.attemptId,
        statementId: row.statementId,
        status: "failed",
        remarks: REMARK_OPUS,
      });
      failed++;
    }
  }

  const ms = Date.now() - start;
  console.log(
    `${SUBMIT_LOG} Done in ${ms}ms. Submitted: ${ok}, Failed: ${failed}, Empty batch: ${claimed.length === 0}.`,
  );
  return { ok, failed, batchSize: claimed.length, ms };
}

function normalizeOpusCsv(buf: Buffer): Buffer {
  // Opus encodes row terminators as literal \n (two chars: 0x5C 0x6E) inside quotes.
  // Data rows: ,"<\n>" → field 21 acts as terminator; replace with empty field + real newline + open next row.
  // Header row: "<\n>" between last header field and first data field; replace preserving surrounding quotes.
  const str = buf
    .toString("utf-8")
    .replace(/,"\\n"/g, ',""\n"')
    .replace(/"\\n"/g, '"\n"');
  return Buffer.from(str, "utf-8");
}

function mimeForExtension(ext: string): string {
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".csv":
      return "text/csv";
    default:
      return "application/octet-stream";
  }
}

export interface VerificationPollResult {
  succeeded: number;
  failed: number;
  skipped: number;
  batchSize: number;
  ms: number;
}

export async function runVerificationPoll(): Promise<VerificationPollResult> {
  const start = Date.now();
  const BATCH = Number(process.env.VERIFICATION_POLL_BATCH_SIZE ?? 5);
  const STUCK_MS = Number(process.env.VERIFICATION_SUBMIT_STUCK_MINUTES ?? 60) * 60_000;
  const TIMEOUT_MS =
    Number(process.env.VERIFICATION_INPROGRESS_TIMEOUT_HOURS ?? 24) * 3_600_000;

  const rows = await db
    .select({
      attemptId: statementVerificationAttempt.id,
      statementId: statement.id,
      statementDisplayId: statement.displayId,
      opusJobId: statementVerificationAttempt.opusJobId,
      attemptUpdatedAt: statementVerificationAttempt.updatedAt,
      claimDriveNetsuiteFolderId: claim.driveNetsuiteFolderId,
    })
    .from(statementVerificationAttempt)
    .innerJoin(statement, eq(statementVerificationAttempt.statementId, statement.id))
    .innerJoin(claim, eq(statement.claimId, claim.id))
    .where(
      and(
        eq(statementVerificationAttempt.status, "in_progress"),
        isNull(statement.deletedAt),
      ),
    )
    .orderBy(asc(statementVerificationAttempt.updatedAt))
    .limit(BATCH);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const ageMs = Date.now() - row.attemptUpdatedAt.getTime();

    // ── No job id: the submit run flipped the row but never recorded a job. ──
    if (!row.opusJobId) {
      if (ageMs <= STUCK_MS) {
        // A submission run may still be processing this attempt — leave it.
        skipped++;
        continue;
      }
      console.warn(`${POLL_LOG} Attempt ${row.attemptId}: no job id past stuck window — force-failing.`);
      await finalizeAttempt({
        attemptId: row.attemptId,
        statementId: row.statementId,
        status: "failed",
        remarks: REMARK_NOT_STARTED,
      });
      failed++;
      continue;
    }

    // ── Job id present: poll Opus. ──
    let status: Awaited<ReturnType<typeof getJobStatus>>;
    try {
      status = await getJobStatus(row.opusJobId);
    } catch (err) {
      if (err instanceof OpusError && ageMs > TIMEOUT_MS) {
        console.error(`${POLL_LOG} Attempt ${row.attemptId}: status unreachable past timeout — force-failing.`, err);
        await finalizeAttempt({
          attemptId: row.attemptId,
          statementId: row.statementId,
          status: "failed",
          remarks: REMARK_OPUS,
        });
        failed++;
      } else {
        console.error(`${POLL_LOG} Attempt ${row.attemptId}: transient status error, will retry next cycle.`, err);
        skipped++;
      }
      continue;
    }

    if (status.state === "success") {
      // ── §7.5: fetch the result file and upload it to Drive, then finalize. ──
      let remarks: string | null = null;
      try {
        const result = await getJobResultFile(row.opusJobId);
        if (!result) {
          remarks = REMARK_NO_RESULT;
        } else {
          // Opus now returns the result as CSV text, so the output is always a
          // .csv file. normalizeOpusCsv stays as a defensive step: it only
          // rewrites literal "\n" sequences, so a CSV that already has real
          // newlines passes through untouched.
          const ext = ".csv";
          const uploadBuffer = normalizeOpusCsv(result.buffer);
          // Postfix a per-attempt timestamp so each successful verification writes a
          // DISTINCT file (a history accumulates in the netsuite folder — one per attempt).
          // Source the timestamp from attempt.updatedAt (a stable "verification started at"
          // marker), NOT wall-clock now: this keeps concurrent re-polls of the SAME attempt
          // idempotent (same name → overwrite-by-name collapses them to one file), while
          // separate attempts (retries) get distinct names → separate files. (opus-api §8.2)
          const ts = row.attemptUpdatedAt
            .toISOString()
            .slice(0, 19)
            .replace(/[-:T]/g, ""); // e.g. 20260714153045
          const base = result.fileTitle || row.statementDisplayId || `result_${row.attemptId}`;
          const fileName = `${base}_${ts}${ext}`;
          const folderId = result.netsuiteFolderId || row.claimDriveNetsuiteFolderId;
          if (!folderId) throw new Error("No netsuite Drive folder id available for upload.");
          const { webViewLink } = await uploadDriveFileFromBuffer(folderId, fileName, uploadBuffer, mimeForExtension(ext));
          console.log(`${POLL_LOG} Attempt ${row.attemptId}: result uploaded as "${fileName}". Link: ${webViewLink}`);
        }
      } catch (err) {
        console.error(`${POLL_LOG} Attempt ${row.attemptId}: result fetch/upload failed:`, err);
        remarks = REMARK_UPLOAD_FAILED;
      }
      await finalizeAttempt({
        attemptId: row.attemptId,
        statementId: row.statementId,
        status: "success",
        opusResponse: status.raw,
        remarks,
      });
      succeeded++;
      continue;
    }

    if (status.state === "failed") {
      const rv = status.rawStatus.trim().toLowerCase().replace(/\s+/g, "_");
      const remarks =
        rv === "timed_out" ? REMARK_TIMED_OUT : rv === "stopped" ? REMARK_STOPPED : REMARK_OPUS;
      await finalizeAttempt({
        attemptId: row.attemptId,
        statementId: row.statementId,
        status: "failed",
        opusResponse: status.raw,
        remarks,
      });
      failed++;
      continue;
    }

    // state === "in_progress" (or unrecognized) — still running.
    if (ageMs > TIMEOUT_MS) {
      console.warn(`${POLL_LOG} Attempt ${row.attemptId}: in_progress past timeout — force-failing.`);
      await finalizeAttempt({
        attemptId: row.attemptId,
        statementId: row.statementId,
        status: "failed",
        remarks: REMARK_OPUS,
      });
      failed++;
    } else {
      skipped++;
    }
  }

  const ms = Date.now() - start;
  console.log(
    `${POLL_LOG} Done in ${ms}ms. Succeeded: ${succeeded}, Failed: ${failed}, Skipped: ${skipped}, Empty batch: ${rows.length === 0}.`,
  );
  return { succeeded, failed, skipped, batchSize: rows.length, ms };
}
