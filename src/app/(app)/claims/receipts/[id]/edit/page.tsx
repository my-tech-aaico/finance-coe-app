import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, entity, user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { EditClaimForm } from "./EditClaimForm";

export default async function EditClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin", "finance"]);
  const { id } = await params;

  const [existing, allEntities, allUsers] = await Promise.all([
    db.query.claim.findFirst({ where: eq(claim.id, id) }),
    db.query.entity.findMany({ orderBy: (e, { asc }) => [asc(e.code)] }),
    db.query.user.findMany({ orderBy: (u, { asc }) => [asc(u.name)] }),
  ]);

  if (!existing) notFound();

  const activeEntities = allEntities.filter((e) => e.status === "active");
  const currentEntity = allEntities.find((e) => e.id === existing.entityId);
  const entities =
    currentEntity && currentEntity.status !== "active"
      ? [currentEntity, ...activeEntities]
      : activeEntities;

  const activeUsers = allUsers.filter((u) => u.status === "active");
  const currentClaimant = existing.claimantId
    ? allUsers.find((u) => u.id === existing.claimantId)
    : null;
  const users =
    currentClaimant && currentClaimant.status !== "active"
      ? [currentClaimant, ...activeUsers]
      : activeUsers;

  return (
    <EditClaimForm
      claim={existing}
      entities={entities}
      users={users}
    />
  );
}
