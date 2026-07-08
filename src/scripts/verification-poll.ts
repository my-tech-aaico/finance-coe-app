import "dotenv/config";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { claim, statement, statementVerificationAttempt } from "@/db/schema";
import { OpusError, getJobResultFile, getJobStatus } from "@/lib/opus";
import { uploadDriveFileFromBuffer } from "@/lib/drive";
import { finalizeAttempt } from "@/lib/verification";

const LOG = "[verification-poll]";
const BATCH = Number(process.env.VERIFICATION_POLL_BATCH_SIZE ?? 5);
const STUCK_MS = Number(process.env.VERIFICATION_SUBMIT_STUCK_MINUTES ?? 60) * 60_000;
const TIMEOUT_MS =
  Number(process.env.VERIFICATION_INPROGRESS_TIMEOUT_HOURS ?? 24) * 3_600_000;

const REMARK_OPUS = "Error from OPUS, please check in OPUS or retry";
const REMARK_TIMED_OUT = "Verification timed out in OPUS, please retry.";
const REMARK_STOPPED = "Verification was stopped in OPUS, please check in OPUS or retry.";
const REMARK_NOT_STARTED = "Verification did not start in time, please retry.";
const REMARK_NO_RESULT = "Verification succeeded but no result file was returned by OPUS.";
const REMARK_UPLOAD_FAILED =
  "Verification succeeded but the result file could not be uploaded to Google Drive.";

function detectExtension(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return ".pdf"; // %PDF
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return ".xlsx"; // PK.. (zip/OpenXML)
  }
  try {
    const sample = buf.subarray(0, 15).toString("utf-8").toUpperCase();
    if (sample.includes("EXTERNALID") || sample.includes("_EXTID") || sample.includes("ID,") || sample.includes("DATE,")) {
      return ".csv";
    }
  } catch {
    // not valid UTF-8 → not a CSV
  }
  return "";
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

async function main() {
  const start = Date.now();

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
      console.warn(`${LOG} Attempt ${row.attemptId}: no job id past stuck window — force-failing.`);
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
        console.error(`${LOG} Attempt ${row.attemptId}: status unreachable past timeout — force-failing.`, err);
        await finalizeAttempt({
          attemptId: row.attemptId,
          statementId: row.statementId,
          status: "failed",
          remarks: REMARK_OPUS,
        });
        failed++;
      } else {
        console.error(`${LOG} Attempt ${row.attemptId}: transient status error, will retry next cycle.`, err);
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
          const ext = detectExtension(result.buffer);
          const uploadBuffer = ext === ".csv" ? normalizeOpusCsv(result.buffer) : result.buffer;
          const fileName =
            (result.fileTitle || row.statementDisplayId || `result_${row.attemptId}`) + ext;
          const folderId = result.netsuiteFolderId || row.claimDriveNetsuiteFolderId;
          if (!folderId) throw new Error("No netsuite Drive folder id available for upload.");
          const { webViewLink } = await uploadDriveFileFromBuffer(folderId, fileName, uploadBuffer, mimeForExtension(ext));
          console.log(`${LOG} Attempt ${row.attemptId}: result uploaded as "${fileName}". Link: ${webViewLink}`);
        }
      } catch (err) {
        console.error(`${LOG} Attempt ${row.attemptId}: result fetch/upload failed:`, err);
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
      console.warn(`${LOG} Attempt ${row.attemptId}: in_progress past timeout — force-failing.`);
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
    `${LOG} Done in ${ms}ms. Succeeded: ${succeeded}, Failed: ${failed}, Skipped: ${skipped}, Empty batch: ${rows.length === 0}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`${LOG} Fatal:`, err);
  process.exit(1);
});
