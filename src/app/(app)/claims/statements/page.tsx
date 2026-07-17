import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { statement, claim } from "@/db/schema";
import { and, eq, or, ilike, gte, lte, desc, asc, sql, isNull } from "drizzle-orm";
import { StatementsTable } from "./_components/StatementsTable";

const PAGE_SIZE = 20;

type Search = {
  q?: string;
  status?: string;
  dateField?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: string;
  notice?: string;
};

function clampDateRange(from?: string, to?: string) {
  if (!from && !to) return { from: undefined, to: undefined };
  const f = from ? new Date(from) : undefined;
  let t = to ? new Date(to) : undefined;
  if (f && t) {
    const maxTo = new Date(f);
    maxTo.setMonth(maxTo.getMonth() + 12);
    if (t > maxTo) t = maxTo;
  }
  return { from: f, to: t };
}

function resolveSort(sort: string | undefined, dir: string | undefined) {
  const direction = dir === "asc" ? asc : desc;
  switch (sort) {
    case "displayId":
      return [direction(statement.displayId)];
    case "statementDate":
      return [direction(statement.statementDate), desc(statement.uploadDate), desc(statement.id)];
    case "linkedClaim":
      return [direction(claim.displayId)];
    case "uploadDate":
      return [direction(statement.uploadDate)];
    case "verification":
      return [direction(statement.verificationStatus)];
    default:
      return [desc(statement.statementDate), desc(statement.uploadDate), desc(statement.id)];
  }
}

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const actor = await requireRole(["admin", "finance", "credit_card_holder"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));

  const { from, to } = clampDateRange(sp.from, sp.to);
  const dateField: "statement" | "upload" =
    sp.dateField === "upload" ? "upload" : "statement";
  const dateCol = dateField === "upload" ? statement.uploadDate : statement.statementDate;

  // v2: Credit Card Holders see only statements they uploaded. Admin/Finance see all.
  const cchScope =
    actor.role === "credit_card_holder"
      ? eq(statement.uploadedBy, actor.id)
      : undefined;

  const conditions = [
    isNull(statement.deletedAt),
    cchScope,
    sp.q
      ? or(
          ilike(statement.displayId, `%${sp.q}%`),
          ilike(claim.displayId, `%${sp.q}%`),
          ilike(claim.description, `%${sp.q}%`)
        )
      : undefined,
    sp.status
      ? eq(
          statement.verificationStatus,
          sp.status as
            | "pending_verification"
            | "queued"
            | "in_progress"
            | "success"
            | "failed"
        )
      : undefined,
    from ? gte(dateCol, dateField === "upload" ? from : from.toISOString().split("T")[0]) : undefined,
    to ? lte(dateCol, dateField === "upload" ? to : to.toISOString().split("T")[0]) : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const orderBy = resolveSort(sp.sort, sp.dir);

  const rows = await db
    .select({
      id: statement.id,
      displayId: statement.displayId,
      statementDate: statement.statementDate,
      uploadDate: statement.uploadDate,
      verificationStatus: statement.verificationStatus,
      claimId: statement.claimId,
      claimDisplayId: claim.displayId,
      claimDescription: claim.description,
    })
    .from(statement)
    .innerJoin(claim, eq(statement.claimId, claim.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statement)
    .innerJoin(claim, eq(statement.claimId, claim.id))
    .where(conditions.length ? and(...conditions) : undefined);

  const statements = rows.map((r) => ({
    ...r,
    statementDate: String(r.statementDate),
  }));

  const filters = {
    ...sp,
    dateField: dateField === "statement" ? undefined : dateField,
  };

  return (
    <div className="animate-in">
      <StatementsTable
        statements={statements}
        total={totalResult[0].count}
        page={page}
        filters={filters}
        isAdminOrFinance={actor.role === "admin" || actor.role === "finance"}
        notice={sp.notice ?? null}
      />
    </div>
  );
}
