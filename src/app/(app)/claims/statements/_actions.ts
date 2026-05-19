"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import {
  claim,
  statement,
  statementVerificationAttempt,
} from "@/db/schema";
import { formatStatementDisplayId } from "@/lib/statement-id";
import { reserveNextStatementSequence } from "@/lib/statement-seq.server";
import {
  uploadStatementFile,
  moveStatementFile,
  deleteDriveFile,
} from "@/lib/drive";
import { isStatementMutable } from "./_lib/mutability";

const FILE_MAX_BYTES = Number(
  process.env.STATEMENT_FILE_MAX_BYTES ?? 10 * 1024 * 1024
);
const FILE_ALLOWED_TYPES = (
  process.env.STATEMENT_FILE_ALLOWED_TYPES ??
  "application/pdf,image/jpeg,image/png"
).split(",");

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function isUniqueConstraintViolation(
  err: unknown,
  constraintName: string
): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code !== "23505") return false;
  return (
    e.constraint === constraintName ||
    (e.message ?? "").includes(constraintName)
  );
}

type ActionResult = { error: string } | { ok: true } | null;

// ───────────────────────── uploadStatement ─────────────────────────

const UploadInput = z.object({
  claimId: z.string().min(1, "Claim is required."),
  statementDate: z.string().min(1, "Statement date is required."),
  startVerification: z
    .preprocess((v) => v === "on" || v === "true", z.boolean())
    .optional(),
});

export async function uploadStatement(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const parsed = UploadInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please select a file." };
  }
  if (file.size > FILE_MAX_BYTES) {
    return {
      error: `File too large. Max ${(FILE_MAX_BYTES / 1024 / 1024).toFixed(
        0
      )} MiB.`,
    };
  }
  if (!FILE_ALLOWED_TYPES.includes(file.type)) {
    return {
      error: `Unsupported file type ${file.type}. Allowed: PDF, JPEG, PNG.`,
    };
  }

  const claimRow = await db.query.claim.findFirst({
    where: and(eq(claim.id, parsed.data.claimId), isNull(claim.deletedAt)),
  });
  if (!claimRow) return { error: "Claim not found." };
  if (claimRow.status !== "awaiting_statement") {
    return { error: "Claim is not awaiting a statement." };
  }
  if (!claimRow.claimantId) {
    return { error: "Claim has no claimant assigned." };
  }
  if (actor.role === "employee" && claimRow.claimantId !== actor.id) {
    return { error: "You can only upload statements for claims assigned to you." };
  }

  const sequenceNumber = await reserveNextStatementSequence();
  const displayId = formatStatementDisplayId(sequenceNumber);

  const statementId = crypto.randomUUID();
  const driveFilename = `${statementId}_${sanitizeFilename(file.name)}`;

  let uploaded: { fileId: string; webViewLink: string };
  try {
    uploaded = await uploadStatementFile(
      claimRow.driveStatementsFolderId,
      driveFilename,
      file
    );
  } catch (err) {
    console.error(
      `[uploadStatement] Drive upload failed for claim ${claimRow.displayId}:`,
      err
    );
    return { error: "Could not upload file to Google Drive. Please try again." };
  }

  try {
    await db.insert(statement).values({
      id: statementId,
      sequenceNumber,
      displayId,
      claimId: claimRow.id,
      statementDate: parsed.data.statementDate,
      driveFileId: uploaded.fileId,
      fileUrl: uploaded.webViewLink,
      fileName: file.name,
      fileMimeType: file.type,
      fileSizeBytes: file.size,
      verificationStatus: parsed.data.startVerification
        ? "queued"
        : "pending_verification",
      uploadedBy: actor.id,
    });

    await db
      .update(claim)
      .set({ status: "statement_attached" })
      .where(eq(claim.id, claimRow.id));

    if (parsed.data.startVerification) {
      await db.insert(statementVerificationAttempt).values({
        statementId,
        status: "queued",
        triggerSource: "upload_checkbox",
        triggeredBy: actor.id,
      });
    }
  } catch (err) {
    console.error(
      `[uploadStatement] DB insert failed after Drive upload. Attempting cleanup:`,
      err
    );
    try {
      await deleteDriveFile(uploaded.fileId);
    } catch (cleanupErr) {
      console.error(
        `[uploadStatement] Cleanup also failed. Orphan in Drive (fileId=${uploaded.fileId}):`,
        cleanupErr
      );
    }
    if (isUniqueConstraintViolation(err, "statement_claim_id_unique")) {
      return {
        error:
          "This claim was just attached to a statement by another user. Please go back and pick a different claim.",
      };
    }
    return { error: "Database error while saving statement. Please try again." };
  }

  revalidatePath("/claims/statements");
  redirect("/claims/statements");
}

// ───────────────────────── updateStatement ─────────────────────────

const UpdateInput = z.object({
  statementId: z.string(),
  statementDate: z.string().min(1, "Statement date is required."),
  claimId: z.string().min(1, "Claim is required."),
});

export async function updateStatement(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const existing = await db.query.statement.findFirst({
    where: eq(statement.id, parsed.data.statementId),
    with: { claim: true },
  });
  if (!existing) return { error: "Statement not found." };

  // Permission (per spec §5.1 — OR rule).
  const canEdit =
    actor.role === "admin" ||
    actor.role === "finance" ||
    existing.uploadedBy === actor.id ||
    existing.claim.claimantId === actor.id;
  if (!canEdit) {
    return { error: "You don't have permission to edit this statement." };
  }

  // Mutability gate (§8.5).
  if (!isStatementMutable(existing.verificationStatus)) {
    return {
      error:
        "Cannot edit — verification is queued or in progress. Wait for it to complete (or fail) before editing.",
    };
  }
  if (existing.deletedAt) {
    return {
      error: "This statement is part of a deleted claim. Restore the claim first.",
    };
  }

  const claimChanging = parsed.data.claimId !== existing.claimId;
  let newClaimRow: typeof existing.claim | null = null;
  if (claimChanging) {
    const row = await db.query.claim.findFirst({
      where: and(eq(claim.id, parsed.data.claimId), isNull(claim.deletedAt)),
    });
    if (!row) return { error: "New linked claim not found." };
    if (row.status !== "awaiting_statement") {
      return { error: "New claim is not awaiting a statement." };
    }
    if (!row.claimantId) {
      return { error: "New claim has no claimant assigned." };
    }
    if (actor.role === "employee" && row.claimantId !== actor.id) {
      return { error: "You can only link to claims assigned to you." };
    }
    newClaimRow = row;
  }

  const file = formData.get("file");
  const fileChanging = file instanceof File && file.size > 0;

  // Drive ops first.
  let newDriveFileId = existing.driveFileId;
  let newFileUrl = existing.fileUrl;
  let newFileName = existing.fileName;
  let newMime = existing.fileMimeType;
  let newSize = existing.fileSizeBytes;
  let oldFileToTrashAfterCommit: string | null = null;

  if (fileChanging) {
    if (file.size > FILE_MAX_BYTES) return { error: "File too large." };
    if (!FILE_ALLOWED_TYPES.includes(file.type)) {
      return { error: `Unsupported file type ${file.type}.` };
    }

    const targetFolder =
      newClaimRow?.driveStatementsFolderId ??
      existing.claim.driveStatementsFolderId;
    const driveFilename = `${existing.id}_${sanitizeFilename(file.name)}`;
    try {
      const uploadedNew = await uploadStatementFile(
        targetFolder,
        driveFilename,
        file
      );
      newDriveFileId = uploadedNew.fileId;
      newFileUrl = uploadedNew.webViewLink;
      newFileName = file.name;
      newMime = file.type;
      newSize = file.size;
      oldFileToTrashAfterCommit = existing.driveFileId;
    } catch (err) {
      console.error(`[updateStatement] Drive upload failed:`, err);
      return { error: "Could not upload new file. Statement not updated." };
    }
  } else if (claimChanging) {
    try {
      await moveStatementFile(
        existing.driveFileId,
        existing.claim.driveStatementsFolderId,
        newClaimRow!.driveStatementsFolderId
      );
    } catch (err) {
      console.error(`[updateStatement] Drive move failed:`, err);
      return {
        error:
          "Could not move file to the new claim's folder. Statement not updated.",
      };
    }
  }

  const statusReset = fileChanging || claimChanging;
  const isDestructive = fileChanging || claimChanging;

  try {
    const updated = await db
      .update(statement)
      .set({
        statementDate: parsed.data.statementDate,
        claimId: parsed.data.claimId,
        driveFileId: newDriveFileId,
        fileUrl: newFileUrl,
        fileName: newFileName,
        fileMimeType: newMime,
        fileSizeBytes: newSize,
        verificationStatus: statusReset
          ? "pending_verification"
          : existing.verificationStatus,
        lastDestructiveEditAt: isDestructive
          ? new Date()
          : existing.lastDestructiveEditAt,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(statement.id, existing.id),
          inArray(statement.verificationStatus, [
            "pending_verification",
            "success",
            "failed",
          ])
        )
      )
      .returning({ id: statement.id });

    if (updated.length === 0) {
      // Race: status flipped under us. Roll back Drive ops.
      if (fileChanging) {
        try {
          await deleteDriveFile(newDriveFileId);
        } catch (rollbackErr) {
          console.warn(
            `[updateStatement] Rollback: failed to trash new upload ${newDriveFileId}.`,
            rollbackErr
          );
        }
      } else if (claimChanging && newClaimRow) {
        try {
          await moveStatementFile(
            existing.driveFileId,
            newClaimRow.driveStatementsFolderId,
            existing.claim.driveStatementsFolderId
          );
        } catch (rollbackErr) {
          console.warn(
            `[updateStatement] Rollback: failed to move file back to old claim's folder.`,
            rollbackErr
          );
        }
      }
      return {
        error:
          "Cannot edit — verification status changed while you were editing. Reload to see the current state.",
      };
    }

    if (claimChanging) {
      await db
        .update(claim)
        .set({ status: "awaiting_statement" })
        .where(eq(claim.id, existing.claimId));
      await db
        .update(claim)
        .set({ status: "statement_attached" })
        .where(eq(claim.id, parsed.data.claimId));
    }
  } catch (err) {
    console.error(`[updateStatement] DB update failed:`, err);
    if (oldFileToTrashAfterCommit !== null) {
      try {
        await deleteDriveFile(newDriveFileId);
      } catch {
        /* ignore */
      }
    }
    return { error: "Database error while updating statement." };
  }

  if (oldFileToTrashAfterCommit) {
    try {
      await deleteDriveFile(oldFileToTrashAfterCommit);
    } catch (cleanupErr) {
      console.warn(
        `[updateStatement] Could not trash old Drive file (fileId=${oldFileToTrashAfterCommit}). Manual cleanup needed:`,
        cleanupErr
      );
    }
  }

  revalidatePath("/claims/statements");
  revalidatePath(`/claims/statements/${existing.id}`);
  redirect(`/claims/statements/${existing.id}`);
}

// ───────────────────────── transitionVerificationStatus (helper) ─────────────────────────

async function transitionVerificationStatus(
  statementId: string,
  fromStatuses: readonly (
    | "pending_verification"
    | "queued"
    | "in_progress"
    | "success"
    | "failed"
  )[],
  toStatus: "queued",
  opts: {
    source: "upload_checkbox" | "manual_start" | "manual_retry";
    triggeredBy: string;
  }
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(statement)
      .set({ verificationStatus: toStatus, updatedAt: new Date() })
      .where(
        and(
          eq(statement.id, statementId),
          inArray(statement.verificationStatus, fromStatuses)
        )
      )
      .returning({ id: statement.id });

    if (updated.length === 0) {
      throw new Error("CONCURRENT_CALL");
    }

    await tx.insert(statementVerificationAttempt).values({
      statementId,
      status: toStatus,
      triggerSource: opts.source,
      triggeredBy: opts.triggeredBy,
    });
  });
}

// ───────────────────────── startVerification / retryVerification ─────────────────────────

const StatementIdInput = z.object({ statementId: z.string() });

function isVisibleToActor(
  actor: { id: string; role: string },
  stmt: {
    uploadedBy: string;
    claim: { claimantId: string | null };
    deletedAt: Date | null;
  }
): boolean {
  if (stmt.deletedAt) return false;
  if (actor.role === "admin" || actor.role === "finance") return true;
  return (
    stmt.uploadedBy === actor.id || stmt.claim.claimantId === actor.id
  );
}

export async function startVerification(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { statementId } = StatementIdInput.parse(
    Object.fromEntries(formData)
  );

  const stmt = await db.query.statement.findFirst({
    where: eq(statement.id, statementId),
    with: { claim: true },
  });
  if (!stmt) return { error: "Statement not found." };
  if (!isVisibleToActor(actor, stmt)) return { error: "Statement not found." };
  if (stmt.verificationStatus !== "pending_verification") {
    return { error: "Verification has already been started." };
  }

  try {
    await transitionVerificationStatus(
      stmt.id,
      ["pending_verification"],
      "queued",
      { source: "manual_start", triggeredBy: actor.id }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "CONCURRENT_CALL") {
      revalidatePath("/claims/statements");
      revalidatePath(`/claims/statements/${statementId}`);
      return { ok: true };
    }
    throw err;
  }

  revalidatePath("/claims/statements");
  revalidatePath(`/claims/statements/${statementId}`);
  return { ok: true };
}

export async function retryVerification(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { statementId } = StatementIdInput.parse(
    Object.fromEntries(formData)
  );

  const stmt = await db.query.statement.findFirst({
    where: eq(statement.id, statementId),
    with: { claim: true },
  });
  if (!stmt) return { error: "Statement not found." };
  if (!isVisibleToActor(actor, stmt)) return { error: "Statement not found." };
  if (
    stmt.verificationStatus !== "success" &&
    stmt.verificationStatus !== "failed"
  ) {
    return { error: "Can only retry from a terminal status." };
  }

  try {
    await transitionVerificationStatus(
      stmt.id,
      ["success", "failed"],
      "queued",
      { source: "manual_retry", triggeredBy: actor.id }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "CONCURRENT_CALL") {
      revalidatePath("/claims/statements");
      revalidatePath(`/claims/statements/${statementId}`);
      return { ok: true };
    }
    throw err;
  }

  revalidatePath("/claims/statements");
  revalidatePath(`/claims/statements/${statementId}`);
  return { ok: true };
}

// ───────────────────────── deleteStatement ─────────────────────────

const DeleteInput = z.object({ statementId: z.string() });

export async function deleteStatement(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance"]);
  const { statementId } = DeleteInput.parse(Object.fromEntries(formData));

  const existing = await db.query.statement.findFirst({
    where: eq(statement.id, statementId),
  });
  if (!existing) {
    return { error: "Statement not found or already deleted." };
  }
  if (existing.deletedAt) {
    return {
      error:
        "This statement is part of a deleted claim. Restore the claim first (Claims page → Show deleted → Restore) before hard-deleting.",
    };
  }
  if (!isStatementMutable(existing.verificationStatus)) {
    return {
      error:
        "Cannot delete — verification is queued or in progress. Reload to see the current status, or wait for it to finish.",
    };
  }

  try {
    await db.transaction(async (tx) => {
      const result = await tx
        .delete(statement)
        .where(
          and(
            eq(statement.id, statementId),
            inArray(statement.verificationStatus, [
              "pending_verification",
              "success",
              "failed",
            ])
          )
        )
        .returning({ id: statement.id });

      if (result.length === 0) {
        throw new Error("RACE_LOSER");
      }

      await tx
        .update(claim)
        .set({ status: "awaiting_statement" })
        .where(eq(claim.id, existing.claimId));
    });
  } catch (err) {
    if (err instanceof Error && err.message === "RACE_LOSER") {
      return {
        error:
          "Cannot delete — verification status changed while you were preparing the delete. Reload to see the current state.",
      };
    }
    console.error(
      `[deleteStatement] DB delete failed for ${existing.displayId}:`,
      err
    );
    return { error: "Database error while deleting statement. Please try again." };
  }

  try {
    await deleteDriveFile(existing.driveFileId);
  } catch (err) {
    console.warn(
      `[deleteStatement] Orphan Drive file after DB delete succeeded (fileId=${existing.driveFileId}, statement=${existing.displayId}). Manual cleanup via Drive trash.`,
      err
    );
  }

  revalidatePath("/claims/statements");
  revalidatePath(`/claims/receipts/${existing.claimId}`);
  return { ok: true };
}
