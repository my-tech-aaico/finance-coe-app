import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { user } from "@/db/schema";
import { and, eq, or, ilike } from "drizzle-orm";
import { UserTable } from "./_components/UserTable";

type Search = { q?: string; role?: string; status?: string };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole(["admin"]);
  const { q, role, status } = await searchParams;

  const conditions = [
    q ? or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)) : undefined,
    role ? eq(user.role, role as "admin" | "finance" | "credit_card_holder" | "employee") : undefined,
    status ? eq(user.status, status as "active" | "inactive") : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const rows = await db.query.user.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (u, { desc }) => [desc(u.createdAt)],
  });

  // Resolve createdBy names
  const creatorIds = [...new Set(rows.map((r) => r.createdBy).filter(Boolean))];
  const creators =
    creatorIds.length > 0
      ? await db.query.user.findMany({
          where: (u, { inArray }) => inArray(u.id, creatorIds as string[]),
        })
      : [];
  const creatorMap = Object.fromEntries(creators.map((c) => [c.id, c.name]));

  const usersWithCreators = rows.map((r) => ({
    ...r,
    createdByName: r.createdBy ? (creatorMap[r.createdBy] ?? "Unknown") : "System",
  }));

  return (
    <div className="animate-in">
      <UserTable
        users={usersWithCreators}
        filters={{ q, role, status }}
      />
    </div>
  );
}
