"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, entity, user } from "@/db/schema";
import { formatDisplayId } from "@/lib/claim-id";
import { reserveNextSequence } from "@/lib/claim-seq.server";
import { createClaimFolders, renameFolder } from "@/lib/drive";

type ActionResult = { error: string } | { ok: true } | null;

const CreateInput = z.object({
  claimMonth: z.coerce.number().int().min(1).max(12),
  claimYear: z.coerce.number().int().min(2020).max(2100),
  entityId: z.string().min(1, "Entity is required."),
  description: z.string().trim().min(1, "Description is required.").max(1000),
  claimantId: z
    .string()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
});

export async function createClaim(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance"]);
  const parsed = CreateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };
  const data = parsed.data;

  const ent = await db.query.entity.findFirst({ where: eq(entity.id, data.entityId) });
  if (!ent) return { error: "Entity not found." };
  if (ent.status !== "active") return { error: "Entity is inactive — pick another." };

  if (data.claimantId) {
    const claimant = await db.query.user.findFirst({
      where: eq(user.id, data.claimantId),
    });
    if (!claimant) return { error: "Claimant not found." };
    if (claimant.status !== "active") return { error: "Claimant is inactive — pick another." };
  }

  const sequenceNumber = await reserveNextSequence();
  const displayId = formatDisplayId(data.claimMonth, data.claimYear, sequenceNumber);

  let folders;
  try {
    folders = await createClaimFolders(displayId);
  } catch {
    return { error: "Could not provision Google Drive folders. Please try again." };
  }

  try {
    await db.insert(claim).values({
      sequenceNumber,
      displayId,
      claimMonth: data.claimMonth,
      claimYear: data.claimYear,
      entityId: data.entityId,
      description: data.description,
      claimantId: data.claimantId,
      status: "awaiting_statement",
      driveFolderId: folders.parentId,
      driveReceiptsFolderId: folders.receiptsId,
      driveStatementsFolderId: folders.statementsId,
      driveNetsuiteFolderId: folders.netsuiteId,
      driveReceiptsUrl: folders.receiptsUrl,
      createdBy: actor.id,
    });
  } catch (err) {
    console.error(
      `Orphan Drive folder ${folders.parentId} for claim ${displayId} — DB insert failed.`,
      err
    );
    return {
      error: "Database error while creating claim. Drive folders were created and need manual cleanup.",
    };
  }

  revalidatePath("/claims/receipts");
  redirect("/claims/receipts");
}

const UpdateInput = z.object({
  claimId: z.string(),
  claimMonth: z.coerce.number().int().min(1).max(12),
  claimYear: z.coerce.number().int().min(2020).max(2100),
  entityId: z.string().min(1, "Entity is required."),
  description: z.string().trim().min(1, "Description is required.").max(1000),
  claimantId: z
    .string()
    .optional()
    .transform((v) => (v && v.length ? v : null)),
});

export async function updateClaim(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance"]);
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };
  const data = parsed.data;

  const existing = await db.query.claim.findFirst({
    where: eq(claim.id, data.claimId),
  });
  if (!existing) return { error: "Claim not found." };

  const ent = await db.query.entity.findFirst({ where: eq(entity.id, data.entityId) });
  if (!ent) return { error: "Entity not found." };
  if (ent.status !== "active" && ent.id !== existing.entityId) {
    return { error: "Selected entity is inactive — pick an active one." };
  }

  if (data.claimantId) {
    const claimant = await db.query.user.findFirst({
      where: eq(user.id, data.claimantId),
    });
    if (!claimant) return { error: "Claimant not found." };
    if (claimant.status !== "active" && claimant.id !== existing.claimantId) {
      return { error: "Selected claimant is inactive — pick an active one." };
    }
  }

  const periodChanged =
    data.claimMonth !== existing.claimMonth || data.claimYear !== existing.claimYear;

  if (!periodChanged) {
    await db
      .update(claim)
      .set({
        entityId: data.entityId,
        description: data.description,
        claimantId: data.claimantId,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(claim.id, data.claimId));

    revalidatePath("/claims/receipts");
    redirect("/claims/receipts");
  }

  const newDisplayId = formatDisplayId(
    data.claimMonth,
    data.claimYear,
    existing.sequenceNumber
  );

  try {
    await renameFolder(existing.driveFolderId, newDisplayId);
  } catch (err) {
    console.error(
      `Drive folder rename failed for claim ${existing.displayId} → ${newDisplayId}.`,
      err
    );
    return {
      error: "Could not rename Google Drive folder. Claim not updated. Please try again.",
    };
  }

  try {
    await db
      .update(claim)
      .set({
        displayId: newDisplayId,
        claimMonth: data.claimMonth,
        claimYear: data.claimYear,
        entityId: data.entityId,
        description: data.description,
        claimantId: data.claimantId,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(claim.id, data.claimId));
  } catch (err) {
    console.error(
      `DB update failed for claim ${existing.displayId} → ${newDisplayId}. Attempting Drive rollback.`,
      err
    );
    try {
      await renameFolder(existing.driveFolderId, existing.displayId);
    } catch (rollbackErr) {
      console.error(
        `Drive rollback also failed. Folder is now named "${newDisplayId}" but DB still shows "${existing.displayId}" — manual reconciliation needed.`,
        rollbackErr
      );
    }
    return { error: "Database error while updating claim. Please try again." };
  }

  revalidatePath("/claims/receipts");
  redirect("/claims/receipts");
}

const DeleteInput = z.object({ claimId: z.string() });

export async function deleteClaim(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin"]);
  const { claimId } = DeleteInput.parse(Object.fromEntries(formData));

  const existing = await db.query.claim.findFirst({ where: eq(claim.id, claimId) });
  if (!existing) return { error: "Claim not found." };
  if (existing.deletedAt) return { error: "Claim is already deleted." };

  const deletedAt = new Date();

  await db.transaction(async (tx) => {
    await tx.update(claim).set({ deletedAt, deletedBy: actor.id }).where(eq(claim.id, claimId));
  });

  revalidatePath("/claims/receipts");
  return { ok: true };
}

export async function restoreClaim(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireRole(["admin"]);
  const { claimId } = DeleteInput.parse(Object.fromEntries(formData));

  const existing = await db.query.claim.findFirst({ where: eq(claim.id, claimId) });
  if (!existing) return { error: "Claim not found." };
  if (!existing.deletedAt) return { error: "Claim is not deleted." };

  await db.transaction(async (tx) => {
    await tx.update(claim).set({ deletedAt: null, deletedBy: null }).where(eq(claim.id, claimId));
  });

  revalidatePath("/claims/receipts");
  return { ok: true };
}
