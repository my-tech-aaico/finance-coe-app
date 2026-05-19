"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { class_ as klass } from "@/db/schema";

const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const CodeSchema = z.string()
  .trim()
  .min(2, "Code must be at least 2 characters.")
  .max(32, "Code must be at most 32 characters.")
  .regex(CODE_PATTERN, "Code must be lowercase letters, digits, and hyphens only.");

const NameSchema = z.string().trim().min(1, "Name is required.").max(200);

const CreateInput = z.object({ code: CodeSchema, name: NameSchema });

type ActionResult = { error: string } | { ok: true } | null;

export async function createClass(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const parsed = CreateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const dup = await db.query.class_.findFirst({ where: eq(klass.code, parsed.data.code) });
  if (dup) return { error: `Code "${parsed.data.code}" is already in use.` };

  await db.insert(klass).values({
    code: parsed.data.code,
    name: parsed.data.name,
    status: "active",
    createdBy: admin.id,
  });

  revalidatePath("/admin/classes");
  redirect("/admin/classes");
}

const UpdateInput = z.object({
  classId: z.string(),
  code: CodeSchema,
  name: NameSchema,
});

export async function updateClass(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const codeClash = await db.query.class_.findFirst({
    where: and(eq(klass.code, parsed.data.code), ne(klass.id, parsed.data.classId)),
  });
  if (codeClash) return { error: `Code "${parsed.data.code}" is already in use.` };

  await db.update(klass)
    .set({
      code: parsed.data.code,
      name: parsed.data.name,
      updatedBy: admin.id,
      updatedAt: new Date(),
    })
    .where(eq(klass.id, parsed.data.classId));

  revalidatePath("/admin/classes");
  redirect("/admin/classes");
}

export async function getDeactivationContext(classId: string) {
  await requireRole(["admin"]);
  const target = await db.query.class_.findFirst({ where: eq(klass.id, classId) });
  if (!target) return null;

  const otherActive = await db.query.class_.findMany({
    where: and(eq(klass.status, "active"), ne(klass.id, classId)),
  });
  const isLastActive = target.status === "active" && otherActive.length === 0;

  return {
    code: target.code,
    currentStatus: target.status,
    isLastActive,
  };
}

export async function toggleClassStatus(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const classId = z.string().parse(formData.get("classId"));
  const target = await db.query.class_.findFirst({ where: eq(klass.id, classId) });
  if (!target) return { error: "Class not found." };

  const next: "active" | "inactive" = target.status === "active" ? "inactive" : "active";

  await db.update(klass)
    .set({ status: next, updatedBy: admin.id, updatedAt: new Date() })
    .where(eq(klass.id, classId));

  revalidatePath("/admin/classes");
  return { ok: true };
}
