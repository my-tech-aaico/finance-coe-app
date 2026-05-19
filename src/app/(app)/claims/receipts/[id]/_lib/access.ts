import { db } from "@/db";
import { receipt } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type DetailViewMode = "admin_finance" | "employee_claimant" | "employee_other";

type Actor = { id: string; role: string };
type Claim = { id: string; claimantId: string | null };

export async function resolveDetailViewMode(
  actor: Actor,
  claim: Claim
): Promise<DetailViewMode> {
  if (actor.role === "admin" || actor.role === "finance") {
    return "admin_finance";
  }
  if (actor.id === claim.claimantId) {
    return "employee_claimant";
  }
  // All other employees see only their own receipts (employee_other).
  // This includes employees with zero uploads — they get an empty list.
  return "employee_other";
}

export async function loadReceipts(claimId: string, mode: DetailViewMode, actor: Actor) {
  const baseWhere = eq(receipt.claimId, claimId);
  if (mode === "employee_other") {
    return db.query.receipt.findMany({
      where: and(baseWhere, eq(receipt.uploadedBy, actor.id)),
      orderBy: (r, { desc }) => [desc(r.receiptDate)],
      with: {
        department: true,
        class_: true,
        uploadedByUser: true,
      },
    });
  }
  return db.query.receipt.findMany({
    where: baseWhere,
    orderBy: (r, { desc }) => [desc(r.receiptDate)],
    with: {
      department: true,
      class_: true,
      uploadedByUser: true,
    },
  });
}
