"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { entity } from "@/db/schema";
import { COUNTRY_CODES } from "@/lib/countries";

const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const CodeSchema = z
  .string()
  .trim()
  .min(2, "Entity code must be at least 2 characters.")
  .max(32, "Entity code must be at most 32 characters.")
  .regex(CODE_PATTERN, "Entity code must be lowercase letters, digits, and hyphens only.");

const NameSchema = z.string().trim().min(1, "Entity name is required.").max(200);

const CountrySchema = z
  .string()
  .refine((c) => COUNTRY_CODES.has(c), "Unsupported country.");

const CreateInput = z.object({
  code: CodeSchema,
  name: NameSchema,
  country: CountrySchema,
});

type ActionResult = { error: string } | { ok: true } | null;

export async function createEntity(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const parsed = CreateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const dup = await db.query.entity.findFirst({
    where: eq(entity.code, parsed.data.code),
  });
  if (dup) {
    return {
      error: `Code "${parsed.data.code}" is already in use. To reuse this code, first edit the existing entity that holds it.`,
    };
  }

  await db.insert(entity).values({
    code: parsed.data.code,
    name: parsed.data.name,
    country: parsed.data.country,
    status: "active",
    createdBy: admin.id,
  });

  revalidatePath("/admin/entities");
  return { ok: true };
}

const UpdateInput = z.object({
  entityId: z.string(),
  code: CodeSchema,
  name: NameSchema,
  country: CountrySchema,
});

export async function updateEntity(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const codeClash = await db.query.entity.findFirst({
    where: and(
      eq(entity.code, parsed.data.code),
      ne(entity.id, parsed.data.entityId)
    ),
  });
  if (codeClash) {
    return {
      error: `Code "${parsed.data.code}" is already in use. To reuse this code, first edit the existing entity that holds it.`,
    };
  }

  await db
    .update(entity)
    .set({
      code: parsed.data.code,
      name: parsed.data.name,
      country: parsed.data.country,
      updatedBy: admin.id,
      updatedAt: new Date(),
    })
    .where(eq(entity.id, parsed.data.entityId));

  revalidatePath("/admin/entities");
  return { ok: true };
}

export async function getDeactivationContext(entityId: string) {
  await requireRole(["admin"]);
  const target = await db.query.entity.findFirst({
    where: eq(entity.id, entityId),
  });
  if (!target) return null;

  const otherActive = await db.query.entity.findMany({
    where: and(eq(entity.status, "active"), ne(entity.id, entityId)),
  });
  const isLastActive = target.status === "active" && otherActive.length === 0;

  const claimCount = 0;
  const openClaimCount = 0;

  return {
    entityCode: target.code,
    currentStatus: target.status,
    isLastActive,
    claimCount,
    openClaimCount,
  };
}

export async function toggleEntityStatus(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const entityId = z.string().parse(formData.get("entityId"));
  const target = await db.query.entity.findFirst({
    where: eq(entity.id, entityId),
  });
  if (!target) return { error: "Entity not found." };

  const next: "active" | "inactive" = target.status === "active" ? "inactive" : "active";

  await db
    .update(entity)
    .set({ status: next, updatedBy: admin.id, updatedAt: new Date() })
    .where(eq(entity.id, entityId));

  revalidatePath("/admin/entities");
  return { ok: true };
}
