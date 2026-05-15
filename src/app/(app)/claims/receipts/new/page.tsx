import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { entity, user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { CreateClaimForm } from "./CreateClaimForm";

export default async function NewClaimPage() {
  await requireRole(["admin", "finance"]);

  const [entities, users] = await Promise.all([
    db.query.entity.findMany({
      where: eq(entity.status, "active"),
      orderBy: (e, { asc }) => [asc(e.code)],
    }),
    db.query.user.findMany({
      where: eq(user.status, "active"),
      orderBy: (u, { asc }) => [asc(u.name)],
    }),
  ]);

  return <CreateClaimForm entities={entities} users={users} />;
}
