import { db } from "@/db";
import { receipt } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// v2: receipt visibility within a claim is role-dependent. Admin/Finance/CCH see ALL
// receipts on a claim they can view; an Employee sees ONLY receipts they uploaded.
// The remaining view-mode distinction is whether the viewer can edit claim metadata /
// open the Drive folder (Admin/Finance) vs not (Credit Card Holder / Employee).
// Row-level edit/delete is gated separately (owner, or Admin/Finance override).
export type DetailViewMode = "admin_finance" | "restricted";

type Actor = { id: string; role: string };

export function resolveDetailViewMode(actor: Actor): DetailViewMode {
  return actor.role === "admin" || actor.role === "finance"
    ? "admin_finance"
    : "restricted";
}

export async function loadReceipts(claimId: string, actor: Actor) {
  // Employees only see receipts they uploaded; everyone else sees all on the claim.
  const where =
    actor.role === "employee"
      ? and(eq(receipt.claimId, claimId), eq(receipt.uploadedBy, actor.id))
      : eq(receipt.claimId, claimId);

  return db.query.receipt.findMany({
    where,
    orderBy: (r, { desc }) => [desc(r.uploadedAt)],
    with: {
      department: true,
      class_: true,
      teamSplit: true,
      uploadedByUser: true,
    },
  });
}

// Employees may only reach a claim where they are the claimant. Admin/Finance/CCH
// may reach any claim. Returns true if the actor is allowed to view the claim.
export function canViewClaim(
  actor: Actor,
  claim: { claimantId: string | null }
): boolean {
  if (actor.role === "admin" || actor.role === "finance" || actor.role === "credit_card_holder") {
    return true;
  }
  // employee
  return claim.claimantId === actor.id;
}

// Receipt-level visibility (view page + file API). Admin/Finance/CCH may access any
// receipt on a viewable claim; an Employee may access ONLY receipts they uploaded.
// Stricter than canViewClaim so an employee can't open another user's receipt file
// directly by URL, even on a claim they are the claimant of.
export function canViewReceipt(
  actor: Actor,
  receiptRow: { uploadedBy: string | null },
  claim: { claimantId: string | null }
): boolean {
  if (!canViewClaim(actor, claim)) return false;
  if (actor.role === "employee") return receiptRow.uploadedBy === actor.id;
  return true;
}
