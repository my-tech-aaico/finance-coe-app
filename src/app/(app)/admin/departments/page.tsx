import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { department } from "@/db/schema";
import { and, eq, or, ilike, asc } from "drizzle-orm";
import { DepartmentTable } from "./_components/DepartmentTable";
import { user } from "@/db/schema";

type Search = { q?: string; status?: string };

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole(["admin"]);
  const { q, status } = await searchParams;

  const conditions = [
    q ? or(ilike(department.code, `%${q}%`), ilike(department.name, `%${q}%`)) : undefined,
    status ? eq(department.status, status as "active" | "inactive") : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const rows = await db.query.department.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (d, { asc: a }) => [a(d.code)],
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

  const departments = rows.map((r) => ({
    ...r,
    createdByName: r.createdBy ? (userMap[r.createdBy] ?? "System") : "System",
    updatedByName: r.updatedBy ? (userMap[r.updatedBy] ?? null) : null,
  }));

  return (
    <div className="animate-in">
      <DepartmentTable departments={departments} filters={{ q, status }} />
    </div>
  );
}
