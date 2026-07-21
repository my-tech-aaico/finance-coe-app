import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, department, class_, teamSplit, projectCode } from "@/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { ClaimOverviewCard } from "./_components/ClaimOverviewCard";
import { ReceiptsSummaryCard } from "./_components/ReceiptsSummaryCard";
import { ReceiptsTable } from "./_components/ReceiptsTable";
import { ReceiptForm } from "./_components/ReceiptForm";
import { resolveDetailViewMode, loadReceipts, canViewClaim } from "./_lib/access";

export default async function ClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string; rid?: string }>;
}) {
  const actor = await requireRole(["admin", "finance", "credit_card_holder", "employee"]);
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

  // Employees may only open claims they are the claimant of.
  if (!canViewClaim(actor, claimRow)) notFound();

  const mode = resolveDetailViewMode(actor);
  const receipts = await loadReceipts(claimRow.id, actor);

  const summary = { count: receipts.length };

  const action = sp.action;
  const editingReceipt =
    action === "edit-receipt" && sp.rid
      ? receipts.find((r) => r.id === sp.rid)
      : undefined;

  // Load dropdowns for the form
  let departments: { id: string; code: string; name: string; status: "active" | "inactive" }[] = [];
  let classes: { id: string; code: string; name: string; status: "active" | "inactive" }[] = [];
  let teamSplits: { id: string; code: string; name: string; classId: string }[] = [];
  let projectCodes: { id: string; code: string; name: string }[] = [];
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
    // Load only active team splits for all classes in the dropdown.
    const classIds = classes.map((c) => c.id);
    if (classIds.length > 0) {
      teamSplits = await db.query.teamSplit.findMany({
        where: and(inArray(teamSplit.classId, classIds), eq(teamSplit.status, "active")),
        orderBy: (t, { asc }) => [asc(t.code)],
      });
    }
    // If editing and the currently assigned split is inactive, inject it so the form
    // can display it as "(inactive)" and the server will accept it unchanged.
    if (editingReceipt?.teamSplitId) {
      const hasCurrentSplit = teamSplits.some((s) => s.id === editingReceipt.teamSplitId);
      if (!hasCurrentSplit) {
        const inactiveSplit = await db.query.teamSplit.findFirst({
          where: eq(teamSplit.id, editingReceipt.teamSplitId),
        });
        if (inactiveSplit) {
          teamSplits = [
            ...teamSplits,
            {
              id: inactiveSplit.id,
              code: inactiveSplit.code,
              name: `${inactiveSplit.name} (inactive)`,
              classId: inactiveSplit.classId,
            },
          ];
        }
      }
    }
    // Only active project codes are selectable on the form.
    projectCodes = await db.query.projectCode.findMany({
      where: (p, { eq: e }) => e(p.status, "active"),
      orderBy: (p, { asc }) => [asc(p.code)],
    });
    // If editing and the currently assigned project code is inactive, inject it so the form
    // can display it as "(inactive)" and the server will accept it unchanged.
    if (editingReceipt?.projectCodeId) {
      const hasCurrentCode = projectCodes.some((p) => p.id === editingReceipt.projectCodeId);
      if (!hasCurrentCode) {
        const inactiveCode = await db.query.projectCode.findFirst({
          where: eq(projectCode.id, editingReceipt.projectCodeId),
        });
        if (inactiveCode) {
          projectCodes = [
            ...projectCodes,
            {
              id: inactiveCode.id,
              code: inactiveCode.code,
              name: `${inactiveCode.name} (inactive)`,
            },
          ];
        }
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
      <ReceiptsSummaryCard summary={summary} />

      {action === "add-receipt" ? (
        <ReceiptForm
          mode="add"
          claimId={claimRow.id}
          claimDisplayId={claimRow.displayId}
          departments={departments}
          classes={classes}
          teamSplits={teamSplits}
          projectCodes={projectCodes}
        />
      ) : action === "edit-receipt" && editingReceipt ? (
        <ReceiptForm
          mode="edit"
          claimId={claimRow.id}
          claimDisplayId={claimRow.displayId}
          departments={departments}
          classes={classes}
          teamSplits={teamSplits}
          projectCodes={projectCodes}
          receipt={{
            id: editingReceipt.id,
            departmentId: editingReceipt.departmentId,
            classId: editingReceipt.classId,
            teamSplitId: editingReceipt.teamSplitId,
            projectCodeId: editingReceipt.projectCodeId,
            fileName: editingReceipt.fileName,
          }}
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
