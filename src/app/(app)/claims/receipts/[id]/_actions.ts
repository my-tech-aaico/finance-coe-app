"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, receipt, department, class_ as klass } from "@/db/schema";
import { uploadReceiptFile, deleteDriveFile } from "@/lib/drive";
import { getCurrentRate } from "@/lib/fx";

const FILE_MAX_BYTES = Number(process.env.RECEIPT_FILE_MAX_BYTES ?? 10 * 1024 * 1024);
const FILE_ALLOWED_TYPES = (
  process.env.RECEIPT_FILE_ALLOWED_TYPES ?? "application/pdf,image/jpeg,image/png,image/heic"
).split(",");

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

type ActionResult = { error: string } | { ok: true } | null;

const CreateReceiptInput = z.object({
  claimId: z.string(),
  receiptDate: z.string().min(1, "Receipt date is required."),
  amountLocal: z.coerce.number().positive("Amount must be greater than zero."),
  departmentId: z.string().min(1, "Department is required."),
  classId: z.string().min(1, "Class is required."),
});

export async function createReceipt(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
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
    with: { entity: true },
  });
  if (!parent) return { error: "Claim not found." };

  // Any authenticated user (admin, finance, or employee) can add receipts to any visible claim.

  const dept = await db.query.department.findFirst({ where: eq(department.id, parsed.data.departmentId) });
  if (!dept || dept.status !== "active") return { error: "Selected department is invalid." };

  const cls = await db.query.class_.findFirst({ where: eq(klass.id, parsed.data.classId) });
  if (!cls || cls.status !== "active") return { error: "Selected class is invalid." };

  const { rate, fetchedAt } = await getCurrentRate(parent.entity.currency);
  const amountUsd = Math.round(parsed.data.amountLocal * rate * 100) / 100;

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
      receiptDate: parsed.data.receiptDate,
      amountLocal: String(parsed.data.amountLocal),
      currencyCode: parent.entity.currency,
      amountUsd: String(amountUsd),
      fxRate: String(rate),
      fxRateFetchedAt: fetchedAt,
      departmentId: parsed.data.departmentId,
      classId: parsed.data.classId,
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
  receiptDate: z.string().min(1, "Receipt date is required."),
  amountLocal: z.coerce.number().positive("Amount must be greater than zero."),
  departmentId: z.string().min(1, "Department is required."),
  classId: z.string().min(1, "Class is required."),
});

export async function updateReceipt(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const parsed = UpdateReceiptInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const existing = await db.query.receipt.findFirst({
    where: eq(receipt.id, parsed.data.receiptId),
    with: { claim: { with: { entity: true } } },
  });
  if (!existing) return { error: "Receipt not found." };

  const canEdit =
    actor.role === "admin" || actor.role === "finance" || existing.uploadedBy === actor.id;
  if (!canEdit) return { error: "You don't have permission to edit this receipt." };

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

  const amountChanged = String(parsed.data.amountLocal) !== existing.amountLocal;

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

  let fxFields: Record<string, unknown> = {};
  if (amountChanged) {
    const { rate, fetchedAt } = await getCurrentRate(existing.currencyCode);
    fxFields = {
      fxRate: String(rate),
      fxRateFetchedAt: fetchedAt,
      amountUsd: String(Math.round(parsed.data.amountLocal * rate * 100) / 100),
    };
  }

  try {
    await db.update(receipt).set({
      receiptDate: parsed.data.receiptDate,
      amountLocal: String(parsed.data.amountLocal),
      departmentId: parsed.data.departmentId,
      classId: parsed.data.classId,
      ...(newUpload
        ? {
            driveFileId: newUpload.fileId,
            fileUrl: newUpload.webViewLink,
            fileName: newFileName!,
          }
        : {}),
      ...fxFields,
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
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { receiptId } = DeleteReceiptInput.parse(Object.fromEntries(formData));

  const existing = await db.query.receipt.findFirst({ where: eq(receipt.id, receiptId) });
  if (!existing) return { error: "Receipt not found." };

  const canDelete =
    actor.role === "admin" || actor.role === "finance" || existing.uploadedBy === actor.id;
  if (!canDelete) return { error: "You don't have permission to delete this receipt." };

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
