"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { department } from "@/db/schema";

const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const CodeSchema = z.string()
  .trim()
  .min(2, "Code must be at least 2 characters.")
  .max(32, "Code must be at most 32 characters.")
  .regex(CODE_PATTERN, "Code must be lowercase letters, digits, and hyphens only.");

const NameSchema = z.string().trim().min(1, "Name is required.").max(200);

const CreateInput = z.object({ code: CodeSchema, name: NameSchema });

type ActionResult = { error: string } | { ok: true } | null;

export async function createDepartment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const parsed = CreateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const dup = await db.query.department.findFirst({ where: eq(department.code, parsed.data.code) });
  if (dup) return { error: `Code "${parsed.data.code}" is already in use.` };

  await db.insert(department).values({
    code: parsed.data.code,
    name: parsed.data.name,
    status: "active",
    createdBy: admin.id,
  });

  revalidatePath("/admin/departments");
  redirect("/admin/departments");
}

const UpdateInput = z.object({
  departmentId: z.string(),
  code: CodeSchema,
  name: NameSchema,
});

export async function updateDepartment(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const codeClash = await db.query.department.findFirst({
    where: and(eq(department.code, parsed.data.code), ne(department.id, parsed.data.departmentId)),
  });
  if (codeClash) return { error: `Code "${parsed.data.code}" is already in use.` };

  await db.update(department)
    .set({
      code: parsed.data.code,
      name: parsed.data.name,
      updatedBy: admin.id,
      updatedAt: new Date(),
    })
    .where(eq(department.id, parsed.data.departmentId));

  revalidatePath("/admin/departments");
  redirect("/admin/departments");
}

export async function getDeactivationContext(departmentId: string) {
  await requireRole(["admin"]);
  const target = await db.query.department.findFirst({ where: eq(department.id, departmentId) });
  if (!target) return null;

  const otherActive = await db.query.department.findMany({
    where: and(eq(department.status, "active"), ne(department.id, departmentId)),
  });
  const isLastActive = target.status === "active" && otherActive.length === 0;

  return {
    code: target.code,
    currentStatus: target.status,
    isLastActive,
  };
}

export async function toggleDepartmentStatus(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const departmentId = z.string().parse(formData.get("departmentId"));
  const target = await db.query.department.findFirst({ where: eq(department.id, departmentId) });
  if (!target) return { error: "Department not found." };

  const next: "active" | "inactive" = target.status === "active" ? "inactive" : "active";

  await db.update(department)
    .set({ status: next, updatedBy: admin.id, updatedAt: new Date() })
    .where(eq(department.id, departmentId));

  revalidatePath("/admin/departments");
  return { ok: true };
}
