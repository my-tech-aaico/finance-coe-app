import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, statement, user } from "@/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { isStatementMutable } from "../../_lib/mutability";
import { EditStatementForm } from "./EditStatementForm";

export default async function EditStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireRole(["admin", "finance", "credit_card_holder"]);
  const { id } = await params;

  const existing = await db.query.statement.findFirst({
    where: and(eq(statement.id, id), isNull(statement.deletedAt)),
    with: { claim: { with: { claimant: true } } },
  });
  if (!existing) notFound();

  // v2 scoping: Admin/Finance or the uploader (CCH).
  const isAdminOrFinance = actor.role === "admin" || actor.role === "finance";
  const canSee = isAdminOrFinance || existing.uploadedBy === actor.id;
  if (!canSee) notFound();

  // Mutability gate (§9.0 layer 1).
  if (!isStatementMutable(existing.verificationStatus)) {
    redirect(`/claims/statements/${id}?notice=locked`);
  }

  // Load eligible claims for the dropdown:
  //   - status = awaiting_statement, deletedAt IS NULL (no claimant requirement in v2)
  //   - PLUS the current claim (so the user can see what's currently linked,
  //     even though it's now 'statement_attached' and wouldn't normally appear).
  const eligibleConditions = [
    eq(claim.status, "awaiting_statement"),
    isNull(claim.deletedAt),
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const eligibleClaims = await db
    .select({
      id: claim.id,
      displayId: claim.displayId,
      description: claim.description,
      claimantName: user.name,
    })
    .from(claim)
    .leftJoin(user, eq(claim.claimantId, user.id))
    .where(
      or(
        and(...eligibleConditions),
        eq(claim.id, existing.claimId)
      )
    )
    .orderBy(sql`${claim.displayId} ASC`);

  return (
    <EditStatementForm
      statementId={existing.id}
      statementDisplayId={existing.displayId}
      claims={eligibleClaims}
      current={{
        statementDate: existing.statementDate,
        claimId: existing.claimId,
        fileName: existing.fileName,
        fileSizeBytes: existing.fileSizeBytes,
        fileUrl: existing.fileUrl,
        uploadDate: existing.uploadDate,
      }}
    />
  );
}
