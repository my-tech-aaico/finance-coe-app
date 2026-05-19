import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, department, class_ } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { ClaimOverviewCard } from "./_components/ClaimOverviewCard";
import { ReceiptsSummaryCard } from "./_components/ReceiptsSummaryCard";
import { ReceiptsTable } from "./_components/ReceiptsTable";
import { ReceiptForm } from "./_components/ReceiptForm";
import { resolveDetailViewMode, loadReceipts } from "./_lib/access";

export default async function ClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string; rid?: string }>;
}) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { id } = await params;
  const sp = await searchParams;

  const claimRow = await db.query.claim.findFirst({
    where: and(eq(claim.id, id), isNull(claim.deletedAt)),
    with: {
      entity: true,
      claimant: true,
      createdByUser: true,
    },
  });
  if (!claimRow) notFound();

  const mode = await resolveDetailViewMode(actor, claimRow);

  const receipts = await loadReceipts(claimRow.id, mode, actor);

  const summary = {
    count: receipts.length,
    totalLocal: receipts.reduce((sum, r) => sum + Number(r.amountLocal), 0),
    totalUsd: receipts.reduce((sum, r) => sum + Number(r.amountUsd), 0),
    currency: claimRow.entity.currency,
  };

  const action = sp.action;
  const editingReceipt =
    action === "edit-receipt" && sp.rid
      ? receipts.find((r) => r.id === sp.rid)
      : undefined;

  // Load dropdowns for the form
  let departments: { id: string; code: string; name: string; status: "active" | "inactive" }[] = [];
  let classes: { id: string; code: string; name: string; status: "active" | "inactive" }[] = [];
  if (action === "add-receipt" || action === "edit-receipt") {
    departments = await db.query.department.findMany({
      where: (d, { eq: e }) => e(d.status, "active"),
      orderBy: (d, { asc }) => [asc(d.code)],
    });
    classes = await db.query.class_.findMany({
      where: (c, { eq: e }) => e(c.status, "active"),
      orderBy: (c, { asc }) => [asc(c.code)],
    });
    // If editing, include the currently assigned inactive dept/class in the dropdown
    if (editingReceipt) {
      const hasDept = departments.some((d) => d.id === editingReceipt.departmentId);
      if (!hasDept) {
        const inactive = await db.query.department.findFirst({
          where: eq(department.id, editingReceipt.departmentId),
        });
        if (inactive) departments = [...departments, inactive];
      }
      const hasCls = classes.some((c) => c.id === editingReceipt.classId);
      if (!hasCls) {
        const inactive = await db.query.class_.findFirst({
          where: eq(class_.id, editingReceipt.classId),
        });
        if (inactive) classes = [...classes, inactive];
      }
    }
  }

  return (
    <div className="animate-in">
      <Link
        href="/claims/receipts"
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Receipts
      </Link>

      <ClaimOverviewCard claim={claimRow} mode={mode} />
      <ReceiptsSummaryCard summary={summary} mode={mode} />

      {action === "add-receipt" ? (
        <ReceiptForm
          mode="add"
          claimId={claimRow.id}
          claimDisplayId={claimRow.displayId}
          entityCurrency={claimRow.entity.currency}
          departments={departments}
          classes={classes}
        />
      ) : action === "edit-receipt" && editingReceipt ? (
        <ReceiptForm
          mode="edit"
          claimId={claimRow.id}
          claimDisplayId={claimRow.displayId}
          entityCurrency={claimRow.entity.currency}
          departments={departments}
          classes={classes}
          receipt={editingReceipt}
        />
      ) : (
        <ReceiptsTable
          receipts={receipts}
          mode={mode}
          actorId={actor.id}
          claimId={claimRow.id}
        />
      )}
    </div>
  );
}
