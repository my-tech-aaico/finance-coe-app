import "dotenv/config";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { claim, receipt, statement, statementVerificationAttempt } from "@/db/schema";
import {
  OpusError,
  executeJob,
  getUploadUrl,
  initiateJob,
  uploadFileToPresignedUrl,
} from "@/lib/opus";
import { downloadDriveFileAsBuffer } from "@/lib/drive";
import { finalizeAttempt } from "@/lib/verification";

const LOG = "[verification-submit]";
const BATCH = Number(process.env.VERIFICATION_SUBMIT_BATCH_SIZE ?? 5);

const REMARK_NO_RECEIPTS = "No receipts on the linked claim to verify against.";
const REMARK_DRIVE = "File/Folder is not found, please check in Google Drive.";
const REMARK_OPUS = "Error from OPUS, please check in OPUS or retry";

function fileExtensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : "";
}

async function main() {
  const start = Date.now();

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
    console.log(`${LOG} Processing attempt ${row.attemptId} (statement ${row.statementDisplayId}).`);

    // 1. Load receipts for the claim.
    const receipts = await db
      .select({
        id: receipt.id,
        driveFileId: receipt.driveFileId,
        fileName: receipt.fileName,
      })
      .from(receipt)
      .where(eq(receipt.claimId, row.claimId));

    if (receipts.length === 0) {
      console.warn(`${LOG} Attempt ${row.attemptId}: claim has no receipts.`);
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
    const receiptFileUrls: string[] = [];
    try {
      // Statement.
      const stmtUpload = await getUploadUrl({
        fileExtension: fileExtensionOf(row.statementFileName),
        originalName: row.statementFileName,
      });
      const stmtFile = await downloadDriveFileAsBuffer(row.statementDriveFileId);
      await uploadFileToPresignedUrl({
        presignedUrl: stmtUpload.presignedUrl,
        body: stmtFile.buffer,
        contentType: row.statementFileMimeType,
      });
      statementFileUrl = stmtUpload.fileUrl;

      // Receipts.
      for (const r of receipts) {
        const upload = await getUploadUrl({
          fileExtension: fileExtensionOf(r.fileName),
          originalName: r.fileName,
        });
        const file = await downloadDriveFileAsBuffer(r.driveFileId);
        await uploadFileToPresignedUrl({
          presignedUrl: upload.presignedUrl,
          body: file.buffer,
          contentType: file.mimeType,
        });
        receiptFileUrls.push(upload.fileUrl);
      }
    } catch (err) {
      const fromOpus = err instanceof OpusError;
      console.error(`${LOG} Attempt ${row.attemptId}: file gather/upload failed:`, err);
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
      ({ jobExecutionId } = await initiateJob());
      await db
        .update(statementVerificationAttempt)
        .set({ opusJobId: jobExecutionId, updatedAt: new Date() })
        .where(eq(statementVerificationAttempt.id, row.attemptId));
    } catch (err) {
      console.error(`${LOG} Attempt ${row.attemptId}: initiate failed:`, err);
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
      const { raw } = await executeJob({
        jobExecutionId,
        statementFileUrl,
        receiptFileUrls,
        netsuiteFolderId: row.claimDriveNetsuiteFolderId,
      });
      await db
        .update(statementVerificationAttempt)
        .set({ opusResponse: raw, updatedAt: new Date() })
        .where(eq(statementVerificationAttempt.id, row.attemptId));
      ok++;
      console.log(`${LOG} Attempt ${row.attemptId}: submitted (job ${jobExecutionId}).`);
    } catch (err) {
      console.error(`${LOG} Attempt ${row.attemptId}: execute failed:`, err);
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
    `${LOG} Done in ${ms}ms. Submitted: ${ok}, Failed: ${failed}, Empty batch: ${claimed.length === 0}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`${LOG} Fatal:`, err);
  process.exit(1);
});
