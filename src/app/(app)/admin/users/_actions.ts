"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq, and, ne } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { user, session, account } from "@/db/schema";
import { generateId } from "better-auth";

const ALLOWED = new Set(
  (process.env.ALLOWED_EMAIL_DOMAIN ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
);

const ROLE = z.enum(["admin", "finance", "credit_card_holder", "employee"]);

const CreateInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z
    .string()
    .email("Invalid email address")
    .transform((e) => e.toLowerCase())
    .refine(
      (e) => ALLOWED.has(e.split("@")[1] ?? ""),
      "Email must be from an allowed company domain."
    ),
  role: ROLE,
});

type ActionResult = { error: string } | { ok: true } | null;

export async function createUser(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const parsed = CreateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return { error: parsed.error.errors[0].message };

  const dup = await db.query.user.findFirst({
    where: eq(user.email, parsed.data.email),
  });
  if (dup) return { error: "A user with this email already exists." };

  await db.insert(user).values({
    id: generateId(),
    name: parsed.data.name,
    email: parsed.data.email,
    role: parsed.data.role,
    status: "active",
    createdBy: admin.id,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

const UpdateUserInput = z.object({
  userId: z.string(),
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z
    .string()
    .email("Invalid email address")
    .transform((e) => e.toLowerCase())
    .refine(
      (e) => ALLOWED.has(e.split("@")[1] ?? ""),
      "Email must be from an allowed company domain."
    ),
  role: ROLE,
});

export async function updateUser(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const parsed = UpdateUserInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  if (parsed.data.userId === admin.id && parsed.data.role !== "admin") {
    const check = await checkLastActiveAdmin(parsed.data.userId);
    if (check) return { error: check };
  }

  const emailChanged = await (async () => {
    const existing = await db.query.user.findFirst({ where: eq(user.id, parsed.data.userId) });
    return existing?.email !== parsed.data.email;
  })();

  if (emailChanged) {
    const dup = await db.query.user.findFirst({
      where: and(eq(user.email, parsed.data.email), ne(user.id, parsed.data.userId)),
    });
    if (dup) return { error: "This email is already in use by another user." };

    // Sever the old Google identity link and invalidate all active sessions.
    await db.delete(account).where(eq(account.userId, parsed.data.userId));
    await db.delete(session).where(eq(session.userId, parsed.data.userId));
  }

  await db
    .update(user)
    .set({ name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, updatedAt: new Date() })
    .where(eq(user.id, parsed.data.userId));

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function toggleUserStatus(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const admin = await requireRole(["admin"]);
  const userId = z.string().parse(formData.get("userId"));
  const target = await db.query.user.findFirst({
    where: eq(user.id, userId),
  });
  if (!target) return { error: "User not found." };

  const next: "active" | "inactive" =
    target.status === "active" ? "inactive" : "active";

  if (target.role === "admin" && next === "inactive") {
    const check = await checkLastActiveAdmin(userId);
    if (check) return { error: check };
  }

  await db
    .update(user)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(user.id, userId));

  revalidatePath("/admin/users");
  return { ok: true };
}

async function checkLastActiveAdmin(excludeUserId: string): Promise<string | null> {
  const others = await db.query.user.findMany({
    where: and(
      eq(user.role, "admin"),
      eq(user.status, "active"),
      ne(user.id, excludeUserId)
    ),
  });
  if (others.length === 0) {
    return "At least one active Admin must remain in the system.";
  }
  return null;
}
