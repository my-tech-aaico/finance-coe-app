import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { projectCode } from "@/db/schema";
import { and, or, ilike } from "drizzle-orm";
import { ProjectCodeTable } from "./_components/ProjectCodeTable";

type Search = { q?: string };

export default async function ProjectCodePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole(["admin", "finance"]);
  const { q } = await searchParams;

  const conditions = [
    q ? or(ilike(projectCode.code, `%${q}%`), ilike(projectCode.name, `%${q}%`)) : undefined,
  ].filter(Boolean) as Parameters<typeof and>[0][];

  const rows = await db.query.projectCode.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (p, { asc }) => [asc(p.code)],
  });

  return (
    <div className="animate-in">
      <ProjectCodeTable
        projectCodes={rows.map((r) => ({ id: r.id, code: r.code, name: r.name, status: r.status }))}
        filters={{ q }}
      />
    </div>
  );
}
