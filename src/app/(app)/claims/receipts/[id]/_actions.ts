"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import {
  claim,
  receipt,
  department,
  class_ as klass,
  teamSplit,
  projectCode,
} from "@/db/schema";
import { uploadReceiptFile, deleteDriveFile } from "@/lib/drive";

const FILE_MAX_BYTES = Number(process.env.RECEIPT_FILE_MAX_BYTES ?? 10 * 1024 * 1024);
const FILE_ALLOWED_TYPES = (
  process.env.RECEIPT_FILE_ALLOWED_TYPES ?? "application/pdf,image/jpeg,image/png,image/heic"
).split(",");

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

type ActionResult = { error: string } | { ok: true } | null;

// Validate the team split against the selected class using only ACTIVE splits.
//   - existingTeamSplitId: pass when editing; allows keeping an inactive split unchanged
//     but ONLY if it still belongs to the same classId (guards against class-change attack).
async function resolveTeamSplit(
  classId: string,
  rawTeamSplitId: string | undefined,
  existingTeamSplitId?: string | null
): Promise<{ teamSplitId: string | null } | { error: string }> {
  const chosen = (rawTeamSplitId ?? "").trim();

  // Submitting the unchanged existing split → allow even if inactive,
  // but verify it belongs to this classId (guard against class-swap).
  if (chosen && existingTeamSplitId && chosen === existingTeamSplitId) {
    const existingSplit = await db.query.teamSplit.findFirst({
      where: and(eq(teamSplit.id, existingTeamSplitId), eq(teamSplit.classId, classId)),
    });
    if (existingSplit) return { teamSplitId: chosen };
    // Split doesn't belong to the submitted classId — fall through to active validation.
  }

  const activeSplits = await db.query.teamSplit.findMany({
    where: and(eq(teamSplit.classId, classId), eq(teamSplit.status, "active")),
  });

  if (activeSplits.length === 0) {
    return { teamSplitId: null };
  }
  if (!chosen) {
    return { error: "Team Split is required for the selected class." };
  }
  if (!activeSplits.some((s) => s.id === chosen)) {
    return { error: "Selected team split does not belong to the chosen class." };
  }
  return { teamSplitId: chosen };
}

const CreateReceiptInput = z.object({
  claimId: z.string(),
  departmentId: z.string().min(1, "Department is required."),
  classId: z.string().min(1, "Class is required."),
  teamSplitId: z.string().optional(),
  projectCodeId: z.string().min(1, "Project Code is required."),
});

export async function createReceipt(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "credit_card_holder", "employee"]);
  const parsed = CreateReceiptInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please select a file." };
  }
  if (file.size > FILE_MAX_BYTES) {
    return { error: `File too large. Max ${(FILE_MAX_BYTES / 1024 / 1024).toFixed(0)} MiB.` };
  }
  if (!FILE_ALLOWED_TYPES.includes(file.type)) {
    return { error: `Unsupported file type ${file.type}. Allowed: PDF, JPEG, PNG, HEIC.` };
  }

  const parent = await db.query.claim.findFirst({
    where: and(eq(claim.id, parsed.data.claimId), isNull(claim.deletedAt)),
  });
  if (!parent) return { error: "Claim not found." };

  // Employees may only add receipts to claims they are the claimant of.
  // Admin/Finance/CCH can add to any claim.
  if (actor.role === "employee" && parent.claimantId !== actor.id) {
    return { error: "You can only add receipts to claims assigned to you." };
  }

  const dept = await db.query.department.findFirst({ where: eq(department.id, parsed.data.departmentId) });
  if (!dept || dept.status !== "active") return { error: "Selected department is invalid." };

  const cls = await db.query.class_.findFirst({ where: eq(klass.id, parsed.data.classId) });
  if (!cls || cls.status !== "active") return { error: "Selected class is invalid." };

  const ts = await resolveTeamSplit(parsed.data.classId, parsed.data.teamSplitId);
  if ("error" in ts) return { error: ts.error };

  const pc = await db.query.projectCode.findFirst({ where: eq(projectCode.id, parsed.data.projectCodeId) });
  if (!pc) return { error: "Selected project code is invalid." };

  const receiptId = crypto.randomUUID();
  const driveFilename = `${receiptId}_${sanitizeFilename(file.name)}`;

  let uploaded: { fileId: string; webViewLink: string };
  try {
    uploaded = await uploadReceiptFile(parent.driveReceiptsFolderId, driveFilename, file);
  } catch (err) {
    console.error(`[createReceipt] Drive upload failed for claim ${parent.displayId}:`, err);
    return { error: "Could not upload file to Google Drive. Please try again." };
  }

  try {
    await db.insert(receipt).values({
      id: receiptId,
      claimId: parent.id,
      departmentId: parsed.data.departmentId,
      classId: parsed.data.classId,
      teamSplitId: ts.teamSplitId,
      projectCodeId: pc.id,
      projectCode: pc.code, // snapshot
      driveFileId: uploaded.fileId,
      fileUrl: uploaded.webViewLink,
      fileName: file.name,
      uploadedBy: actor.id,
    });
  } catch (err) {
    console.error(`[createReceipt] DB insert failed after Drive upload. Attempting cleanup:`, err);
    try {
      await deleteDriveFile(uploaded.fileId);
    } catch (cleanupErr) {
      console.error(`[createReceipt] Cleanup also failed. Orphan in Drive (fileId=${uploaded.fileId}):`, cleanupErr);
    }
    return { error: "Database error while saving receipt. Please try again." };
  }

  revalidatePath(`/claims/receipts/${parent.id}`);
  redirect(`/claims/receipts/${parent.id}`);
}

const UpdateReceiptInput = z.object({
  receiptId: z.string(),
  departmentId: z.string().min(1, "Department is required."),
  classId: z.string().min(1, "Class is required."),
  teamSplitId: z.string().optional(),
  projectCodeId: z.string().min(1, "Project Code is required."),
});

export async function updateReceipt(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "credit_card_holder", "employee"]);
  const parsed = UpdateReceiptInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const existing = await db.query.receipt.findFirst({
    where: eq(receipt.id, parsed.data.receiptId),
    with: { claim: true },
  });
  if (!existing) return { error: "Receipt not found." };

  const isOwner = existing.uploadedBy === actor.id;
  const isAdminFinance = actor.role === "admin" || actor.role === "finance";
  const canEdit = isAdminFinance || isOwner;
  if (!canEdit) return { error: "You don't have permission to edit this receipt." };
  // Employees can only touch receipts on claims assigned to them (spec §5.5.1).
  if (actor.role === "employee" && existing.claim.claimantId !== actor.id) {
    return { error: "You can only edit receipts on claims assigned to you." };
  }

  const dept = await db.query.department.findFirst({ where: eq(department.id, parsed.data.departmentId) });
  if (!dept) return { error: "Department not found." };
  if (dept.status !== "active" && dept.id !== existing.departmentId) {
    return { error: "Selected department is inactive." };
  }
  const cls = await db.query.class_.findFirst({ where: eq(klass.id, parsed.data.classId) });
  if (!cls) return { error: "Class not found." };
  if (cls.status !== "active" && cls.id !== existing.classId) {
    return { error: "Selected class is inactive." };
  }

  const ts = await resolveTeamSplit(parsed.data.classId, parsed.data.teamSplitId, existing.teamSplitId);
  if ("error" in ts) return { error: ts.error };

  const pc = await db.query.projectCode.findFirst({ where: eq(projectCode.id, parsed.data.projectCodeId) });
  if (!pc) return { error: "Selected project code is invalid." };

  const file = formData.get("file");
  const hasNewFile = file instanceof File && file.size > 0;
  let newUpload: { fileId: string; webViewLink: string } | undefined;
  let newFileName: string | undefined;

  if (hasNewFile) {
    if (file.size > FILE_MAX_BYTES) return { error: "File too large." };
    if (!FILE_ALLOWED_TYPES.includes(file.type)) return { error: `Unsupported file type ${file.type}.` };

    const driveFilename = `${existing.id}_${sanitizeFilename(file.name)}`;
    try {
      newUpload = await uploadReceiptFile(existing.claim.driveReceiptsFolderId, driveFilename, file);
      newFileName = file.name;
    } catch (err) {
      console.error(`[updateReceipt] Drive upload failed:`, err);
      return { error: "Could not upload new file. Receipt not updated." };
    }
  }

  try {
    await db.update(receipt).set({
      departmentId: parsed.data.departmentId,
      classId: parsed.data.classId,
      teamSplitId: ts.teamSplitId,
      projectCodeId: pc.id,
      projectCode: pc.code, // re-snapshot
      ...(newUpload
        ? {
            driveFileId: newUpload.fileId,
            fileUrl: newUpload.webViewLink,
            fileName: newFileName!,
          }
        : {}),
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(eq(receipt.id, existing.id));
  } catch (err) {
    console.error(`[updateReceipt] DB update failed:`, err);
    if (newUpload) {
      try {
        await deleteDriveFile(newUpload.fileId);
      } catch (cleanupErr) {
        console.error(`[updateReceipt] Cleanup of new Drive file failed (fileId=${newUpload.fileId}):`, cleanupErr);
      }
    }
    return { error: "Database error while updating receipt." };
  }

  if (newUpload && existing.driveFileId) {
    try {
      await deleteDriveFile(existing.driveFileId);
    } catch (cleanupErr) {
      console.warn(`[updateReceipt] Could not delete old Drive file (fileId=${existing.driveFileId}). Manual cleanup needed:`, cleanupErr);
    }
  }

  revalidatePath(`/claims/receipts/${existing.claimId}`);
  redirect(`/claims/receipts/${existing.claimId}`);
}

const DeleteReceiptInput = z.object({ receiptId: z.string() });

export async function deleteReceipt(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "credit_card_holder", "employee"]);
  const { receiptId } = DeleteReceiptInput.parse(Object.fromEntries(formData));

  const existing = await db.query.receipt.findFirst({
    where: eq(receipt.id, receiptId),
    with: { claim: true },
  });
  if (!existing) return { error: "Receipt not found." };

  const isOwner = existing.uploadedBy === actor.id;
  const isAdminFinance = actor.role === "admin" || actor.role === "finance";
  if (!isAdminFinance && !isOwner) {
    return { error: "You don't have permission to delete this receipt." };
  }
  if (actor.role === "employee" && existing.claim.claimantId !== actor.id) {
    return { error: "You can only delete receipts on claims assigned to you." };
  }

  try {
    await deleteDriveFile(existing.driveFileId);
  } catch (err) {
    console.error(`[deleteReceipt] Drive delete failed for receipt ${existing.id} (fileId=${existing.driveFileId}):`, err);
    return { error: "Could not delete file from Google Drive. Receipt not deleted." };
  }

  try {
    await db.delete(receipt).where(eq(receipt.id, existing.id));
  } catch (err) {
    console.error(
      `[deleteReceipt] DB delete failed AFTER Drive delete succeeded. ` +
      `Receipt ${existing.id} now points at a deleted Drive file. Manual cleanup needed:`,
      err
    );
    return { error: "Database error while deleting receipt. The file was removed from Drive but the record may persist." };
  }

  revalidatePath(`/claims/receipts/${existing.claimId}`);
  return { ok: true };
}
