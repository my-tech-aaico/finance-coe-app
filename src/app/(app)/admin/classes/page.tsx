import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { class_ as klass } from "@/db/schema";
import { and, eq, or, ilike } from "drizzle-orm";
import { ClassTable } from "./_components/ClassTable";

type Search = { q?: string; status?: string };

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole(["admin"]);
  const { q, status } = await searchParams;

  const conditions = [
    q ? or(ilike(klass.code, `%${q}%`), ilike(klass.name, `%${q}%`)) : undefined,
    status ? eq(klass.status, status as "active" | "inactive") : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const rows = await db.query.class_.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (c, { asc }) => [asc(c.code)],
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

  const classes = rows.map((r) => ({
    ...r,
    createdByName: r.createdBy ? (userMap[r.createdBy] ?? "System") : "System",
    updatedByName: r.updatedBy ? (userMap[r.updatedBy] ?? null) : null,
  }));

  return (
    <div className="animate-in">
      <ClassTable classes={classes} filters={{ q, status }} />
    </div>
  );
}
