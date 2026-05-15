import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { entity } from "@/db/schema";
import { and, eq, or, ilike } from "drizzle-orm";
import { EntityTable } from "./_components/EntityTable";
import { user } from "@/db/schema";

type Search = { q?: string; status?: string };

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole(["admin"]);
  const { q, status } = await searchParams;

  const conditions = [
    q ? or(ilike(entity.code, `%${q}%`), ilike(entity.name, `%${q}%`)) : undefined,
    status ? eq(entity.status, status as "active" | "inactive") : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const rows = await db.query.entity.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (e, { asc }) => [asc(e.code)],
  });

  const allUserIds = [
    ...new Set([
      ...rows.map((r) => r.createdBy).filter(Boolean),
      ...rows.map((r) => r.updatedBy).filter(Boolean),
    ]),
  ] as string[];

  const users =
    allUserIds.length > 0
      ? await db.query.user.findMany({
          where: (u, { inArray }) => inArray(u.id, allUserIds),
        })
      : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));

  const entities = rows.map((r) => ({
    ...r,
    createdByName: r.createdBy ? (userMap[r.createdBy] ?? "System") : "System",
    updatedByName: r.updatedBy ? (userMap[r.updatedBy] ?? null) : null,
  }));

  return (
    <div className="animate-in">
      <EntityTable entities={entities} filters={{ q, status }} />
    </div>
  );
}
