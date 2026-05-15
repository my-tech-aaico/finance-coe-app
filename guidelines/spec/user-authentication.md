# Implementation Plan — Google Workspace Login

**Project:** COE Finance Claims Portal
**Scope:** Authentication (login, session, route protection, logout), the authenticated app shell, a placeholder Dashboard landing page, and the Admin User Management CRUD UI. Claims/Statements/Entities pages are out of scope for this plan.
**Stack (per request):** Next.js App Router · TypeScript · Better Auth · Drizzle ORM · PostgreSQL · Google OAuth.

---

## 0. Stack note — read this first

The project's `Basic_spec` specifies **TanStack Start** as the framework. This plan is written for **Next.js App Router** per the explicit instruction in the prompt. The auth library choices (Better Auth, Drizzle, Google) are framework-agnostic; only the route handler shape, middleware, and server-component helpers differ. Reconcile this with the team before starting.

---

## 1. What the login must do

Distilled from the UI spec (section 1):

1. Single sign-in method: **Sign in with Google** (no password form, no self-registration).
2. Only company-domain emails accepted (e.g. `*@yourcompany.com`).
3. The user must already exist in our `user` table (pre-created by an Admin in the User Management section).
4. The user's status must be **Active**. Inactive users are blocked even if they exist.
5. The application **never** sees or stores the Google password.
6. On success: session cookie issued; user can access protected routes scoped to their role (Admin / Finance / Employee).

Any failure (wrong domain, unknown email, inactive) → block and show a clear, non-leaky error message.

---

## 2. Prerequisites

### 2.1 Google Cloud Console (one-time, by an Admin)

- Create an OAuth 2.0 Client ID for a **Web application**.
- Authorized JavaScript origins: `http://localhost:3000`, `https://<staging-domain>`, `https://<production-domain>`.
- Authorized redirect URIs: `<origin>/api/auth/callback/google` for each environment.
- Capture the **Client ID** and **Client Secret**.
- Recommended: in Google Workspace Admin, restrict the OAuth client's scope or use the `hd` (hosted domain) parameter so the consent screen only accepts company accounts. We still validate server-side regardless — `hd` is a UX nicety, not a security boundary.

### 2.2 Environment variables

```
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=<32+ char random>
BETTER_AUTH_URL=http://localhost:3000              # full origin, no trailing slash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ALLOWED_EMAIL_DOMAIN=growthops.asia,aaico.com      # comma-separated, server-side gate
BOOTSTRAP_ADMIN_EMAILS=gurbhinder.singh@growthops.asia,lambertws@growthops.asia   # see section 12
```

Document these in `.env.example` and load them via a typed config module (`zod` or similar) so a missing var fails at boot, not at runtime.

### 2.3 npm packages

```
better-auth
drizzle-orm
drizzle-kit
pg
```

(Better Auth ships its Drizzle adapter as part of the main package; no separate install needed.)

---

## 3. Database schema (Drizzle)

Better Auth needs four core tables: `user`, `session`, `account`, `verification`. We extend `user` with app-specific fields the UI spec calls for (role, status, createdBy, createdAt).

**Files:**
- `src/db/schema/auth.ts` — Better Auth tables.
- `src/db/schema/index.ts` — re-exports and any app tables (entities, claims, statements, etc.) added later.

**`user` table extensions (additive — Better Auth's required columns stay intact):**

| Column      | Type                                          | Notes                                                                 |
|-------------|-----------------------------------------------|-----------------------------------------------------------------------|
| `role`      | enum `('admin','finance','employee')`         | Required. Determines nav visibility and data scope.                   |
| `status`    | enum `('active','inactive')`, default `active`| The login gate. Inactive blocks all sign-in.                          |
| `createdBy` | text, FK → `user.id`, nullable                | Who admitted this user. Nullable so the seeded first Admin can exist. |
| `createdAt` | timestamp, default `now()`                    | Already provided by Better Auth — keep its column.                    |

The Better Auth `account` table is what links a `user` row to a Google identity (provider, providerAccountId, etc.). We do **not** pre-populate `account` — it's filled on first successful Google sign-in. We pre-populate `user` only (with email + name + role + status).

**Migration plan:**
1. `drizzle-kit generate` from the schema.
2. Apply with `drizzle-kit migrate`.
3. Seed the bootstrap Admin users (see section 12 — chicken-and-egg).

---

## 4. Better Auth configuration

**File:** `src/lib/auth.ts`

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // hd="*" restricts the Google account picker to Workspace (G Suite) accounts only,
      // hiding personal @gmail.com from the chooser for a cleaner UX. It does NOT
      // restrict to our two specific domains — the server-side check in section 5 does that.
      // We use "*" instead of a single domain because we allow two: growthops.asia + aaico.com.
      hd: "*",
    },
  },

  // Disable email/password and any other sign-up paths.
  emailAndPassword: { enabled: false },

  // The all-important hook — see section 5.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          await validatePreRegisteredUser(user);  // throws if invalid
          return { data: user };
        },
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,   // 7 days
    updateAge: 60 * 60 * 24,        // refresh every day of activity
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
});
```

**File:** `src/app/api/auth/[...all]/route.ts`

```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth);
```

This single catch-all route handles `/api/auth/sign-in/social`, `/api/auth/callback/google`, `/api/auth/sign-out`, `/api/auth/session`, etc.

---

## 5. The validation hook — the critical part

This is what enforces "domain match + pre-registered + active" *before* a user row or session can be created.

**File:** `src/lib/auth-validation.ts`

```ts
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";

const ALLOWED = new Set(
  process.env.ALLOWED_EMAIL_DOMAIN!.split(",").map((d) => d.trim().toLowerCase())
);

export async function validatePreRegisteredUser(incoming: { email: string }) {
  const email = incoming.email.toLowerCase();
  const domain = email.split("@")[1];

  // 1. Domain check
  if (!domain || !ALLOWED.has(domain)) {
    throw new APIError("FORBIDDEN", {
      code: "DOMAIN_NOT_ALLOWED",
      message: "Sign-in is restricted to company email addresses.",
    });
  }

  // 2. Pre-registration check
  const existing = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (!existing) {
    throw new APIError("FORBIDDEN", {
      code: "USER_NOT_REGISTERED",
      message: "Your account hasn't been added to the portal. Contact an administrator.",
    });
  }

  // 3. Active-status check
  if (existing.status !== "active") {
    throw new APIError("FORBIDDEN", {
      code: "USER_INACTIVE",
      message: "Your account is inactive. Contact an administrator.",
    });
  }
}
```

**Why this is in `user.create.before` rather than a sign-in callback:** Better Auth's Google flow, on first sign-in, calls `user.create` to insert the user row. By throwing in `create.before`, we abort the entire sign-in attempt — no user row, no account row, no session. On *subsequent* sign-ins the user row already exists, so `create.before` doesn't fire; we add a second guard in `session.create.before` for the active-status check (so deactivating a user blocks them next time they sign in, even though their `user` row already exists).

**Second hook for returning users:**

```ts
databaseHooks: {
  user: { create: { before: async (u) => { await validatePreRegisteredUser(u); return { data: u }; } } },
  session: {
    create: {
      before: async (session) => {
        const u = await db.query.user.findFirst({ where: eq(user.id, session.userId) });
        if (!u || u.status !== "active") {
          throw new APIError("FORBIDDEN", { code: "USER_INACTIVE", message: "Your account is inactive." });
        }
        return { data: session };
      },
    },
  },
},
```

Now: every sign-in (first or returning) is gated by status, and only the first-time path runs the domain + pre-registration check.

---

## 6. Login page UI

**Route:** `/login`
**Files:**
- `src/app/login/page.tsx` (server component)
- `src/app/login/login-button.tsx` (client component for the Google button)

The server component checks for an existing session and redirects to `/dashboard` if one exists, otherwise renders the card from the mock (heading "Welcome back", subheading, single Google button, info note about pre-registration). Match the styling from `COE_Finance_Claims_Portal_UI_Mock.html` (lines for `#login-screen`).

The client component calls Better Auth's client SDK:

```ts
"use client";
import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton() {
  return (
    <button onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" })}>
      Sign in with Google
    </button>
  );
}
```

**File:** `src/lib/auth-client.ts`

```ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient({ baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL });
```

---

## 7. Error feedback when sign-in is rejected

When the hook throws, Better Auth redirects to `/api/auth/error?error=<code>` (or similar — confirm exact param shape against the version pinned). Create a `/login/error` page that shows a single unified message for all rejection cases:

> **We're sorry — you're not registered for access to this portal.**
> Please contact an administrator if you believe this is a mistake.

Internally we still throw the three distinct error codes (`DOMAIN_NOT_ALLOWED`, `USER_NOT_REGISTERED`, `USER_INACTIVE`) so they appear in server logs for debugging and audit. The user-facing copy collapses them all to one message — this avoids leaking which emails are registered vs. deactivated, and keeps the UX simple.

Add a "Try a different account" link on the error page that signs the user out of the Better Auth attempt and returns them to `/login`. Without this, a user who picked the wrong Google account is stuck.

---

## 8. Route protection

### 8.1 Middleware (cheap session presence check)

**File:** `middleware.ts` at project root.

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = ["/login", "/api/auth", "/login/error"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const cookie = getSessionCookie(req);
  if (!cookie) return NextResponse.redirect(new URL("/login", req.url));

  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

Note: `getSessionCookie` only verifies a cookie is present — it does **not** validate the session against the DB. That's correct for middleware (no DB call on the edge) but means every server component / route handler that uses session data must call `auth.api.getSession` itself for the authoritative check.

### 8.2 Server-side session helper

**File:** `src/lib/session.ts`

```ts
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

export async function requireUser() {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireRole(roles: Array<"admin" | "finance" | "employee">) {
  const u = await requireUser();
  if (!roles.includes(u.role)) redirect("/dashboard");  // or a 403 page
  return u;
}
```

Used in every protected page:

```ts
// src/app/(app)/users/page.tsx
export default async function UsersPage() {
  const user = await requireRole(["admin"]);
  // ...
}
```

### 8.3 Nav visibility

Spec section 2.1 requires unauthorized nav items to be **hidden entirely**, not greyed out. The layout component fetches the current user via `getCurrentUser()` and conditionally renders nav items based on `user.role`. Keep the rule centralized in a `canAccess(role, route)` helper to avoid scattered conditionals.

---

## 9. Logout

The header in the mock has a logout button. Wire it to `authClient.signOut()` and redirect to `/login`. Server-side: Better Auth invalidates the session row and clears the cookie automatically.

---

## 10. App shell and Dashboard landing

### 10.1 App shell layout

The portal has a sidebar + header that wraps every authenticated page (matches the mock). Use a [Route Group](https://nextjs.org/docs/app/building-your-application/routing/route-groups) `(app)` in the App Router so the layout is shared without polluting URLs.

**Files:**
- `src/app/(app)/layout.tsx` — server component; calls `requireUser()` so every page inside `(app)/` is guarded; renders Sidebar, Header, and `{children}`.
- `src/app/(app)/_components/Sidebar.tsx` — role-aware nav; uses `canAccess(role, route)` from `src/lib/permissions.ts` (see section 11.3) so an unauthorized item is hidden entirely, not just disabled.
- `src/app/(app)/_components/Header.tsx` — avatar with user initials, name, theme toggle (client), and logout button.

```ts
// src/app/(app)/layout.tsx
import { requireUser } from "@/lib/session";
import { Sidebar } from "./_components/Sidebar";
import { Header } from "./_components/Header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} />
      <div className="flex-1">
        <Header user={user} />
        <main className="p-6 max-w-7xl mx-auto">{children}</main>
      </div>
    </div>
  );
}
```

### 10.2 Dashboard landing page

**Route:** `/dashboard`
**File:** `src/app/(app)/dashboard/page.tsx`

The `Basic_spec` marks Dashboard as *"Coming soon. This section will be developed in a later phase after the initial MVP release."* For Phase 1 we ship a friendly placeholder, not the rich dashboard shown in the mock (charts, activity feed, claims-needing-attention table — those land in Phase 2).

```tsx
// src/app/(app)/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-20 h-20 rounded-2xl bg-brand-50 flex items-center justify-center mb-6">
        {/* sparkles or clock icon */}
      </div>
      <h2 className="text-xl font-bold text-surface-900 mb-2">Dashboard — Coming soon</h2>
      <p className="text-surface-400 max-w-md">
        This section will be developed in a later phase after the initial MVP release.
        In the meantime, you can manage claims, statements, and users from the sidebar.
      </p>
    </div>
  );
}
```

No `requireUser()` call needed here — the `(app)/` layout already gates everything inside it.

### 10.3 Root route redirect

The `/` route should bounce to `/dashboard` (authenticated) or `/login` (not):

```ts
// src/app/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export default async function Root() {
  const u = await getCurrentUser();
  redirect(u ? "/dashboard" : "/login");
}
```

### 10.4 Post-login landing target

The Google sign-in button in section 7 passes `callbackURL: "/dashboard"` to Better Auth. After OAuth completes and the validation hook approves, Better Auth redirects there. End-to-end check: clicking Sign in with Google → Google consent → callback → `/dashboard` rendered with the app shell.

---

## 11. User Management UI (`/admin/users`)

### 11.1 Scope and access

CRUD operations on the `user` table, restricted to Admins. Behavior matches UI mock section 7 of the UI spec. No hard deletes — only `Active` ↔ `Inactive` toggle.

| Operation          | UI surface                  | Server Action       |
|--------------------|-----------------------------|---------------------|
| List users         | Page (server component)     | n/a (DB read)       |
| Add user           | "Add User" modal            | `createUser`        |
| Edit name and role | Pencil icon on a row → modal| `updateUser`        |
| Toggle status      | Row action with confirm     | `toggleUserStatus`  |

### 11.2 Routes and files

| File                                                          | Purpose                                                       |
|---------------------------------------------------------------|---------------------------------------------------------------|
| `src/app/(app)/admin/users/page.tsx`                          | Server component: reads + renders user list with filters      |
| `src/app/(app)/admin/users/_actions.ts`                       | Server Actions for create / update (name + role) / toggle status |
| `src/app/(app)/admin/users/_components/UserTable.tsx`         | Client wrapper for filter UI (passes through to URL params)   |
| `src/app/(app)/admin/users/_components/AddUserModal.tsx`      | Client modal; uses `useFormState` for inline errors           |
| `src/app/(app)/admin/users/_components/EditUserModal.tsx`     | Client modal for editing name and role                        |
| `src/app/(app)/admin/users/_components/ToggleStatusButton.tsx`| Client component with confirm dialog                          |
| `src/lib/permissions.ts`                                      | `canAccess(role, route)` helper + invariant guards            |

### 11.3 Access control — defense in depth

Three layers, all required:

1. **Middleware** (section 8.1): the cookie-presence check redirects unauthenticated requests.
2. **Page** (`page.tsx`): `await requireRole(['admin'])` — redirects Finance/Employee to `/dashboard`.
3. **Server Actions** (`_actions.ts`): every action *also* calls `requireRole(['admin'])` server-side. Hiding the UI is not security; an unauthenticated client could craft a `POST` to a Server Action endpoint directly.

The nav (`Sidebar`) hides the Admin section entirely for non-admins, per UI spec section 2.1.

### 11.4 List page

Server component. Filters come from URL search params so the page is shareable and refresh-friendly:

- `?q=text` — case-insensitive match against name or email
- `?role=admin|finance|employee`
- `?status=active|inactive`

```tsx
// src/app/(app)/admin/users/page.tsx
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { user } from "@/db/schema";
import { and, eq, or, ilike } from "drizzle-orm";
import { UserTable } from "./_components/UserTable";

type Search = { q?: string; role?: string; status?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRole(["admin"]);
  const { q, role, status } = await searchParams;

  const conditions = [
    q ? or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)) : undefined,
    role ? eq(user.role, role as "admin" | "finance" | "employee") : undefined,
    status ? eq(user.status, status as "active" | "inactive") : undefined,
  ].filter(Boolean);

  const rows = await db.query.user.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (u, { desc }) => [desc(u.createdAt)],
    with: { createdByUser: true },   // join to resolve createdBy → name
  });

  return <UserTable users={rows} filters={{ q, role, status }} />;
}
```

Columns shown in the table (per UI spec section 7.1): Name (with avatar bubble), Email, Role (colored chip — purple Admin, teal Finance, blue Employee, matching the mock), Status (badge), Date Added, Created By (resolved name; "System" if `createdBy` is null — that's the seeded admin), Actions (Edit, Toggle Status).

### 11.5 Server Actions

```ts
// src/app/(app)/admin/users/_actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq, and, ne } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { user } from "@/db/schema";

const ALLOWED = new Set(
  process.env.ALLOWED_EMAIL_DOMAIN!.split(",").map((d) => d.trim().toLowerCase())
);

const ROLE = z.enum(["admin", "finance", "employee"]);
const STATUS = z.enum(["active", "inactive"]);

const CreateInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email().transform((e) => e.toLowerCase()).refine(
    (e) => ALLOWED.has(e.split("@")[1] ?? ""),
    "Email must be from an allowed company domain (growthops.asia or aaico.com).",
  ),
  role: ROLE,
});

export async function createUser(_prev: unknown, formData: FormData) {
  const admin = await requireRole(["admin"]);
  const parsed = CreateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const dup = await db.query.user.findFirst({ where: eq(user.email, parsed.data.email) });
  if (dup) return { error: "A user with this email already exists." };

  await db.insert(user).values({
    name: parsed.data.name,
    email: parsed.data.email,
    role: parsed.data.role,
    status: "active",
    createdBy: admin.id,
    emailVerified: false,   // Better Auth column; flipped on first Google sign-in
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

const UpdateRoleInput = z.object({ userId: z.string(), role: ROLE });

export async function updateUserRole(_prev: unknown, formData: FormData) {
  const admin = await requireRole(["admin"]);
  const parsed = UpdateRoleInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  if (parsed.data.userId === admin.id && parsed.data.role !== "admin") {
    await assertNotLastActiveAdmin(parsed.data.userId);
  }

  await db.update(user).set({ role: parsed.data.role }).where(eq(user.id, parsed.data.userId));
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function toggleUserStatus(_prev: unknown, formData: FormData) {
  const admin = await requireRole(["admin"]);
  const userId = z.string().parse(formData.get("userId"));
  const target = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!target) return { error: "User not found." };

  const next: "active" | "inactive" = target.status === "active" ? "inactive" : "active";

  if (target.role === "admin" && next === "inactive") {
    await assertNotLastActiveAdmin(userId);
  }

  await db.update(user).set({ status: next }).where(eq(user.id, userId));
  revalidatePath("/admin/users");
  return { ok: true };
}

async function assertNotLastActiveAdmin(excludeUserId: string) {
  const others = await db.query.user.findMany({
    where: and(eq(user.role, "admin"), eq(user.status, "active"), ne(user.id, excludeUserId)),
  });
  if (others.length === 0) {
    throw new Error("At least one active Admin must remain in the system.");
  }
}
```

### 11.6 Business rules / invariants

Hard rules — enforced in Server Actions, surfaced as inline form errors:

1. **Email format and domain** — must match `growthops.asia` or `aaico.com`. Same allowlist as the login validator.
2. **Email uniqueness** — DB unique constraint on `user.email` is the source of truth; the Server Action pre-checks for a friendlier error message.
3. **Role values** — exactly one of `admin` / `finance` / `employee`.
4. **Status defaults to `active`** on create.
5. **No hard deletes** — only Active ↔ Inactive toggle (UI spec section 10).
6. **At least one active Admin must remain.** Prevents lockout. Applies to both demoting the sole Admin and deactivating them. Surfaces as a clear error: *"At least one active Admin must remain in the system."*
7. **`createdBy` is set automatically** from the session (`admin.id`), not from the form. Never trust the client for this.

**Race-condition note (low priority):** two Admins could in theory pass the "not last admin" check simultaneously and both deactivate themselves, leaving none. The window is tiny (sub-second) and recovery is easy (re-run the seed script). If you want to close it, wrap the check + update in a `SERIALIZABLE` transaction or use `SELECT ... FOR UPDATE`. Not worth it for Phase 1.

### 11.7 UX details (matching the mock)

- **Add User modal** — fields per UI spec section 7.2: Name, Email, Role. Submit button stays disabled until all three are populated. Submitting calls `createUser` via `useFormState`; errors show inline; success closes the modal and the new row appears (revalidated server-side).
- **Edit User modal** — opened by the pencil icon. Pre-populates with the user's current name and role. Both fields are editable. Saving calls `updateUser`.
- **Toggle Status** — a separate row action with a confirm dialog: *"Deactivate Lee Wei Ming? They will be unable to sign in to the portal."* Confirming calls `toggleUserStatus`. Re-activating doesn't need a confirm.
- **Search and filters** — wire to URL search params via a small client component that uses `useRouter().replace()` on debounced input.
- **Empty state** — when the user table is empty (only the seeded Admin remains), show the friendly empty state from UI spec section 9.

### 11.8 Lifecycle of an Admin-added user

1. Admin opens `/admin/users` → clicks **Add User** → fills name, email, role → submits.
2. `createUser` Server Action validates, inserts a row into `user` with `status='active'`, `createdBy=<admin.id>`, no linked `account` row yet.
3. The new user appears in the table immediately (revalidated).
4. The new user (out of band — email, Slack, whatever) is told to visit the portal and click Sign in with Google.
5. On their first sign-in, Better Auth completes OAuth, hits `databaseHooks.user.create.before`. Because the row already exists in `user`, Better Auth doesn't try to create it again — it matches by email and inserts only the `account` row linking the Google identity. The validation hook still runs but finds the existing active user, so it succeeds.
6. Subsequent sign-ins: the session-creation hook (section 5) verifies `status='active'` each time the session refreshes.

There's no email invitation flow, no token, no "set your password" step. Google is the identity provider; the Admin's job is just to put a row in the table.

---

## 12. Bootstrap problem (chicken-and-egg)

Since no self-registration exists and Admins create users, the very first Admins have to be seeded directly. The seed script reads `BOOTSTRAP_ADMIN_EMAILS` (comma-separated) and inserts one `user` row per email if it doesn't already exist. The two seeded Admins for this project are:

- `gurbhinder.singh@growthops.asia`
- `lambertws@growthops.asia`

**File:** `scripts/seed-admin.ts`

```ts
import { db } from "@/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";

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
    const existing = await db.query.user.findFirst({ where: eq(user.email, email) });
    if (existing) {
      console.log(`Skip: ${email} already exists (role=${existing.role}, status=${existing.status}).`);
      continue;
    }

    // Placeholder name derived from the email local-part.
    // Better Auth updates this with the real Google profile name on first sign-in;
    // it can also be edited later via the User Management UI.
    const name = email.split("@")[0]
      .split(/[._-]/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");

    await db.insert(user).values({
      email,
      name,
      role: "admin",
      status: "active",
      createdBy: null,         // Seeded, not created by another admin → "System" in the UI
      emailVerified: false,    // Flips on first Google sign-in
    });

    console.log(`Seeded admin: ${email} (${name})`);
  }
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```

**Properties:**
- **Idempotent.** Skips any email that already has a row, so re-running on every deploy is safe.
- **No hardcoded emails.** The script reads from the env var; staging and production are configured separately if needed.
- **`createdBy = null`** for seeded users — the User Management table displays this as "System" so it's clear these weren't created through the UI.
- **Placeholder names.** The split-on-`.`-`_`-`-` heuristic gives "Gurbhinder Singh" for `gurbhinder.singh@…` and "Lambertws" for `lambertws@…` — the second is rough, but it's only ever shown until the user signs in (Better Auth pulls their real Google profile name) or an Admin edits it.

**How to run:**
- Locally: `pnpm tsx scripts/seed-admin.ts` after `pnpm drizzle-kit migrate`.
- CI/CD on Railway: add a deploy hook step `pnpm tsx scripts/seed-admin.ts` after migrations apply. Because it's idempotent, every deploy can run it without side effects.

**First-sign-in flow for a seeded Admin:**
1. Gurbhinder or Lambert visits the portal → clicks Sign in with Google.
2. Google authenticates them → returns to the OAuth callback.
3. Better Auth's `databaseHooks.user.create.before` runs the validation hook (section 5): domain ✓, exists in `user` table ✓, status active ✓.
4. Because the `user` row exists, Better Auth links the Google identity by inserting an `account` row only; the `user` row is not duplicated.
5. The session is created and they land on `/dashboard`.
6. They can immediately open `/admin/users` and start inviting the rest of the team.

---

## 13. Security checklist

- `BETTER_AUTH_SECRET` is 32+ random bytes, stored in a secrets manager (not committed).
- Cookies: `httpOnly`, `secure` in production, `sameSite=lax` (Better Auth defaults — verify on the pinned version).
- CSRF: Better Auth handles this for its own routes. App routes that mutate state should use Server Actions or include their own CSRF protection.
- Redirect URIs in Google Console match exactly — no wildcards, no trailing slashes.
- The `hd` parameter (if used) is a Google UX setting, **not** a server-side enforcement. The domain check in section 5 is the source of truth.
- The validation hook runs before any DB write, so a failed sign-in leaves no user / account / session row behind.
- Rate-limit `/api/auth/*` at the edge (Vercel WAF / Cloudflare) to slow down enumeration if you later choose to leak the "not registered" vs "inactive" distinction.

---

## 14. Testing checklist

Manual end-to-end (auth):

1. ✅ Pre-registered active user with company email → lands on `/dashboard` "Coming soon" page.
2. ❌ Personal Gmail (`@gmail.com`) → redirected to error page with `DOMAIN_NOT_ALLOWED`.
3. ❌ Company email not in `user` table → `USER_NOT_REGISTERED`.
4. ❌ Company email in `user` table with `status = inactive` → `USER_INACTIVE`.
5. ✅ Already-signed-in user visiting `/login` → redirected to `/dashboard`.
6. ✅ Unauthenticated user visiting `/admin/users` → redirected to `/login`.
7. ✅ Finance user visiting `/admin/users` → redirected away (no access).
8. ✅ Employee user → does not see Admin section in the nav (UI spec section 3.1 truth table).
9. ✅ Sign-out → session row deleted in DB, cookie cleared, redirect to `/login`.
10. ✅ Deactivating a currently-signed-in user → their next request (or next session refresh) gets blocked.
11. ✅ Visiting `/` → redirects to `/dashboard` (signed in) or `/login` (signed out).

Manual end-to-end (User Management):

12. ✅ Admin opens `/admin/users` → sees existing users, including the seeded Admin (`createdBy` shows "System").
13. ✅ Admin clicks Add User → modal opens → submits with valid `@growthops.asia` email + role → new row appears in the table.
14. ❌ Admin tries to add user with `@gmail.com` email → inline form error: domain not allowed.
15. ❌ Admin tries to add user with an existing email → inline form error: already exists.
16. ✅ Admin edits another user's role → reflected on next page load.
17. ❌ Sole Admin tries to demote themselves → error: "At least one active Admin must remain."
18. ❌ Sole Admin tries to deactivate themselves → same error.
19. ✅ Two Admins exist → either one can demote or deactivate themselves; the other remains.
20. ✅ Admin deactivates a Finance user → that user's next session refresh blocks them.
21. ✅ Admin re-activates an Inactive user → no confirm dialog → they can sign in again.
22. ✅ Newly-added user can sign in via Google immediately (no email invite step, no waiting period).
23. ✅ Search by name, email; filter by role and status — URL updates, results refetch server-side.

Unit / integration:

- `validatePreRegisteredUser` with each of: bad domain, unknown email, inactive user, valid active user.
- `getCurrentUser` returns `null` without a session cookie, returns the user object with one.
- `requireRole(['admin'])` redirects for non-admins.
- `createUser` Server Action: valid input persists; non-admin caller throws; bad domain returns error; duplicate email returns error.
- `updateUserRole`: blocks demotion of sole Admin.
- `toggleUserStatus`: blocks deactivation of sole Admin; toggles correctly otherwise.

---

## 15. Decisions (locked)

All open questions are now resolved.

| # | Decision                  | Value                                                                                                  |
|---|---------------------------|--------------------------------------------------------------------------------------------------------|
| 1 | Allowed domain(s)         | `growthops.asia` and `aaico.com` only. Comma-separated in `ALLOWED_EMAIL_DOMAIN`.                       |
| 2 | Mid-session deactivation  | No real-time eviction. Session refresh interval stays at 1 day (`session.updateAge`); a deactivated user is blocked on their next session refresh, worst-case ~24 h later. |
| 3 | Error message verbosity   | Single user-facing message for all rejections: *"We're sorry — you're not registered for access to this portal."* Internal logs still record the specific cause (domain / not-registered / inactive). |
| 4 | Google `hd` parameter     | Set to `"*"` — Workspace-only account picker, hides personal Gmail. Server-side check is still the source of truth for the two-domain allowlist. |
| 5 | Bootstrap Admin emails    | `gurbhinder.singh@growthops.asia` and `lambertws@growthops.asia`. Same values for staging and production unless the team specifies different staging emails later. Configured via `BOOTSTRAP_ADMIN_EMAILS` (comma-separated). |

---

## 16. File-by-file deliverables summary

**Auth foundation:**

| File                                       | Purpose                                                |
|--------------------------------------------|--------------------------------------------------------|
| `.env.example`                             | Documents required env vars                            |
| `src/db/schema/auth.ts`                    | Drizzle tables for Better Auth + custom user columns   |
| `src/db/index.ts`                          | Drizzle client                                         |
| `src/lib/auth.ts`                          | Better Auth instance + hooks                           |
| `src/lib/auth-client.ts`                   | Better Auth React client                               |
| `src/lib/auth-validation.ts`               | `validatePreRegisteredUser` and session-time guard     |
| `src/lib/session.ts`                       | `getCurrentUser`, `requireUser`, `requireRole`         |
| `src/lib/permissions.ts`                   | `canAccess(role, route)` helper                        |
| `src/app/api/auth/[...all]/route.ts`       | Catch-all auth route handler                           |
| `middleware.ts`                            | Cheap cookie-presence gate for protected routes        |
| `scripts/seed-admin.ts`                    | Idempotent bootstrap admin seed                        |

**Login + error pages:**

| File                                       | Purpose                                                |
|--------------------------------------------|--------------------------------------------------------|
| `src/app/login/page.tsx`                   | Login page (server)                                    |
| `src/app/login/login-button.tsx`           | Google sign-in button (client)                         |
| `src/app/login/error/page.tsx`             | Friendly error page (single unified message)           |

**App shell + Dashboard:**

| File                                                | Purpose                                                |
|-----------------------------------------------------|--------------------------------------------------------|
| `src/app/page.tsx`                                  | Root redirect: `/dashboard` or `/login`                |
| `src/app/(app)/layout.tsx`                          | Authenticated app shell; gates everything inside        |
| `src/app/(app)/_components/Sidebar.tsx`             | Role-aware nav (hides unauthorized sections)            |
| `src/app/(app)/_components/Header.tsx`              | Avatar, user info, theme toggle, logout                 |
| `src/app/(app)/dashboard/page.tsx`                  | "Coming soon" placeholder                               |

**User Management:**

| File                                                                | Purpose                                                |
|---------------------------------------------------------------------|--------------------------------------------------------|
| `src/app/(app)/admin/users/page.tsx`                                | List page with filters from URL params                  |
| `src/app/(app)/admin/users/_actions.ts`                             | Server Actions: create / update role / toggle status    |
| `src/app/(app)/admin/users/_components/UserTable.tsx`               | Client wrapper for search/filter UI                     |
| `src/app/(app)/admin/users/_components/AddUserModal.tsx`            | Add User modal with `useFormState` for inline errors    |
| `src/app/(app)/admin/users/_components/EditUserModal.tsx`           | Edit Role modal                                         |
| `src/app/(app)/admin/users/_components/ToggleStatusButton.tsx`      | Row action with confirm dialog                          |

---

## 17. Out of scope (separate workstreams)

- **Phase 2 Dashboard** — the rich dashboard shown in the mock (summary cards, verification-status bar chart, recent activity feed, claims-needing-attention table, role-specific Admin/Finance vs Employee views). Phase 1 ships only the "Coming soon" placeholder per `Basic_spec`.
- **Entity management** (`/admin/entities`).
- **Claims pages** (`/claims/receipts`, `/claims/statements`) — list, create, upload, verification flow, Opus integration, schedulers.
- **Audit logging of sign-in attempts** (recommend adding later — `signIn.before` / `signIn.after` Better Auth hooks are the right place).
- **Email notifications** to newly-added users telling them to sign in. The Lifecycle in section 11.8 assumes out-of-band notification.

When Claims, Statements, and Entities are built, they reuse the auth helpers (`requireUser`, `requireRole`), the app shell layout, and the Server Action pattern established by User Management.