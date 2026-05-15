import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";

const ALLOWED = new Set(
  (process.env.ALLOWED_EMAIL_DOMAIN ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
);

export async function validatePreRegisteredUser(incoming: { email: string }) {
  const email = incoming.email.toLowerCase();
  const domain = email.split("@")[1];

  if (!domain || !ALLOWED.has(domain)) {
    throw new APIError("FORBIDDEN", {
      message: "Sign-in is restricted to company email addresses.",
    });
  }

  const existing = await db.query.user.findFirst({
    where: eq(user.email, email),
  });

  if (!existing) {
    throw new APIError("FORBIDDEN", {
      message:
        "Your account hasn't been added to the portal. Contact an administrator.",
    });
  }

  if (existing.status !== "active") {
    throw new APIError("FORBIDDEN", {
      message: "Your account is inactive. Contact an administrator.",
    });
  }
}
