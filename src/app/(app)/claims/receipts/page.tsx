import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, entity, user } from "@/db/schema";
import { and, eq, or, ilike, gte, lte, desc, asc, sql, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ClaimsTable } from "./_components/ClaimsTable";

const PAGE_SIZE = 20;

type Search = {
  q?: string;
  status?: string;
  claimant?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: string;
  showDeleted?: string;
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

function resolveSort(sort?: string, dir?: string) {
  const direction = dir === "asc" ? asc : desc;
  switch (sort) {
    case "displayId": return [direction(claim.displayId)];
    case "description": return [direction(claim.description)];
    case "period": return [direction(claim.claimYear), direction(claim.claimMonth)];
    case "status": return [direction(claim.status)];
    case "createdAt": return [direction(claim.createdAt)];
    default: return [desc(claim.createdAt)];
  }
}

const claimantAlias = alias(user, "claimant");
const deletedByAlias = alias(user, "deleted_by");

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));

  const { from, to } = clampDateRange(sp.from, sp.to);

  // Defense in depth: only Admin can see deleted claims.
  const includeDeleted = actor.role === "admin" && sp.showDeleted === "true";

  const conditions = [
    includeDeleted ? undefined : isNull(claim.deletedAt),
    sp.q
      ? or(
          ilike(claim.displayId, `%${sp.q}%`),
          ilike(claim.description, `%${sp.q}%`),
          ilike(
            sql`(SELECT name FROM "user" WHERE id = ${claim.claimantId})`,
            `%${sp.q}%`
          )
        )
      : undefined,
    sp.status
      ? eq(claim.status, sp.status as "awaiting_statement" | "statement_attached")
      : undefined,
    sp.claimant === "unassigned" ? isNull(claim.claimantId) : undefined,
    from ? gte(claim.createdAt, from) : undefined,
    to ? lte(claim.createdAt, to) : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const orderBy = resolveSort(sp.sort, sp.dir);

  const rows = await db
    .select({
      claim: claim,
      entity: entity,
      claimantName: claimantAlias.name,
      claimantStatus: claimantAlias.status,
      deletedByName: deletedByAlias.name,
    })
    .from(claim)
    .leftJoin(entity, eq(claim.entityId, entity.id))
    .leftJoin(claimantAlias, eq(claim.claimantId, claimantAlias.id))
    .leftJoin(deletedByAlias, eq(claim.deletedBy, deletedByAlias.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(claim)
    .where(conditions.length ? and(...conditions) : undefined);

  const claims = rows.map((r) => ({
    ...r.claim,
    entityCode: r.entity?.code ?? "",
    entityName: r.entity?.name ?? "",
    claimantName: r.claimantName ?? null,
    claimantStatus: r.claimantStatus ?? null,
    deletedByName: r.deletedByName ?? null,
  }));

  return (
    <div className="animate-in">
      <ClaimsTable
        claims={claims}
        total={totalResult[0].count}
        page={page}
        filters={sp}
        isAdmin={actor.role === "admin"}
        isAdminOrFinance={actor.role === "admin" || actor.role === "finance"}
        showDeleted={includeDeleted}
      />
    </div>
  );
}
