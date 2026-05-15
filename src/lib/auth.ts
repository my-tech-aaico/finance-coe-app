import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { user } from "@/db/schema";
import { validatePreRegisteredUser } from "./auth-validation";
import { APIError } from "better-auth/api";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Restrict the Google account picker to Workspace accounts (hides personal Gmail).
      // Server-side domain check in auth-validation.ts is the security boundary.
      hd: "*",
    },
  },

  emailAndPassword: { enabled: false },

  // Allow Google to link to a pre-seeded user row that has no account yet.
  // Without this, Better Auth rejects sign-in when the email exists but no
  // Google account is linked (which is always true for pre-seeded admins).
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      // Pre-seeded users have emailVerified=false (no prior sign-in).
      // Google verifies the email on its side, so we don't require local verification.
      requireLocalEmailVerified: false,
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          await validatePreRegisteredUser(u);
          return { data: u };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const u = await db.query.user.findFirst({
            where: eq(user.id, session.userId),
          });
          if (!u || u.status !== "active") {
            throw new APIError("FORBIDDEN", {
              message: "Your account is inactive.",
            });
          }
          return { data: session };
        },
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
