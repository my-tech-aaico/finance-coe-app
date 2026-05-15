import "dotenv/config";
import { db } from "../src/db";
import { user } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "better-auth";

const SEED_ADMINS = (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function seed() {
  if (SEED_ADMINS.length === 0) {
    console.log("No BOOTSTRAP_ADMIN_EMAILS set — skipping seed.");
    return;
  }

  for (const email of SEED_ADMINS) {
    const existing = await db.query.user.findFirst({
      where: eq(user.email, email),
    });

    if (existing) {
      console.log(
        `Skip: ${email} already exists (role=${existing.role}, status=${existing.status}).`
      );
      continue;
    }

    const name = email
      .split("@")[0]
      .split(/[._-]/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");

    await db.insert(user).values({
      id: generateId(),
      email,
      name,
      role: "admin",
      status: "active",
      createdBy: null,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`Seeded admin: ${email} (${name})`);
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
