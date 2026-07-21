"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { projectCode } from "@/db/schema";

type ActionResult = { error: string } | { ok: true };

export async function toggleProjectCodeStatus(projectCodeId: string): Promise<ActionResult> {
  await requireRole(["admin", "finance"]);

  const existing = await db.query.projectCode.findFirst({
    where: eq(projectCode.id, projectCodeId),
  });
  if (!existing) return { error: "Project code not found." };

  const next: "active" | "inactive" = existing.status === "active" ? "inactive" : "active";

  await db.update(projectCode)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(projectCode.id, projectCodeId));

  revalidatePath("/admin/project-code");
  return { ok: true };
}
