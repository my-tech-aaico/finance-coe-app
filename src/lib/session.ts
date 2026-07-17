import { auth } from "@/lib/auth";
import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/lib/permissions";

export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  const u = await db.query.user.findFirst({
    where: eq(userTable.id, session.user.id),
  });

  return u ?? null;
}

export async function requireUser() {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireRole(roles: Role[]) {
  const u = await requireUser();
  if (!roles.includes(u.role)) redirect("/dashboard");
  return u;
}
