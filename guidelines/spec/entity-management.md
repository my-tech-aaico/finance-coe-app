# Implementation Spec — Entities Management

**Project:** COE Finance Claims Portal
**Scope:** Admin CRUD UI for legal entities (`/admin/entities`). Entities are referenced by the Claim creation form to scope a claim to a country/business unit. This spec covers the data model, UI, business rules, and server logic.
**Stack:** Next.js App Router · TypeScript · Better Auth · Drizzle ORM · PostgreSQL.

This spec assumes the auth foundation, app shell, and User Management work from the **Google Workspace Login Implementation Plan** are complete. The patterns here mirror that plan — Server Actions, the `(app)/admin/...` route group, `requireRole(['admin'])`, no hard deletes.

---

## 1. What entities are and what they do

An **entity** is a legal business unit that owns a claim. The portal supports multiple entities so a single instance can serve multiple country offices. From the UI mock and UI spec:

- Entities have a short code (e.g. `apd-my`, `apd-sg`, `apd-hk`) displayed as a chip in tables.
- Entities have a full name (e.g. "APD Malaysia") and a country.
- Entities can be Active or Inactive. Inactive entities **do not appear** in the Claim creation dropdown but historical claims still reference them.
- Entities are managed only by Admins.

Three example entities have appeared in the mock and design conversations: `apd-my`, `apd-sg`, `apd-hk`. These will be created by the first admin through the UI on first deploy (the spec does not seed them — see section 12 for rationale).

---

## 2. Data model

### 2.1 New table: `entity`

**File:** `src/db/schema/entity.ts`

| Column      | Type                                      | Notes                                                            |
|-------------|-------------------------------------------|------------------------------------------------------------------|
| `id`        | `text` (uuid), primary key                | Internal identifier. Used as foreign key from `claim`.            |
| `code`      | `text`, unique, not null                  | The chip value, e.g. `apd-my`. Lowercase + hyphens only. Editable after creation (see section 7).  |
| `name`      | `text`, not null                          | Full legal name, e.g. "APD Malaysia".                             |
| `country`   | `text`, not null                          | ISO 3166-1 alpha-2 code (e.g. `MY`, `SG`, `HK`). See section 8. Independent of `code` — no enforced relationship between the two. |
| `status`    | enum `('active','inactive')`, default `'active'` | Toggle. No hard deletes.                                    |
| `createdBy` | `text`, FK → `user.id`, nullable           | Kept nullable for forward-compatibility with future data migrations. In normal operation, every entity has a real admin creator. |
| `createdAt` | `timestamp`, default `now()`               |                                                                  |
| `updatedBy` | `text`, FK → `user.id`, nullable           | The admin who last modified the entity. Set on every mutation. Null until the entity is first edited. |
| `updatedAt` | `timestamp`, default `now()`               | Updated on every mutation, alongside `updatedBy`.                |

**Indexes:**
- Unique index on `code`.
- Plain index on `status` (the claim creation dropdown filters by `status = 'active'` on every load).

**Database CHECK constraints:**
- `CHECK (code = lower(code))` — guarantees no uppercase codes can ever exist, regardless of write path (Server Action, raw SQL, data import, future microservice). Belt-and-braces alongside the Zod regex.

**Why ID-as-FK and not code-as-FK:** entity codes are *displayed* as identifiers but are editable (section 7), so foreign keys must point at the stable `id`. Claims store `entityId`, not `entityCode`. Rendering a claim row joins to `entity` to fetch the current code for display.

### 2.2 Forward-looking: `claim` table reference

When the Claims workstream lands, it will add:

```
claim.entityId  text NOT NULL REFERENCES entity(id)
```

This spec doesn't create the claim table — it just notes the foreign key contract so the entity table is designed correctly.

### 2.3 Migration plan

1. `drizzle-kit generate` from the new schema.
2. `drizzle-kit migrate`.

No seed step — entities are created by the first admin through the UI (see section 12).

---

## 3. Routes and files

| File                                                                | Purpose                                                |
|---------------------------------------------------------------------|--------------------------------------------------------|
| `src/db/schema/entity.ts`                                           | Drizzle table definition + CHECK constraint            |
| `src/app/(app)/admin/entities/page.tsx`                             | List page with filters from URL params                  |
| `src/app/(app)/admin/entities/_actions.ts`                          | Server Actions: create / update / toggle status         |
| `src/app/(app)/admin/entities/_components/EntityTable.tsx`          | Client wrapper for search/filter UI                     |
| `src/app/(app)/admin/entities/_components/AddEntityModal.tsx`       | Add Entity modal with `useFormState` for inline errors  |
| `src/app/(app)/admin/entities/_components/EditEntityModal.tsx`      | Edit modal (code + name + country, no status)           |
| `src/app/(app)/admin/entities/_components/ToggleStatusButton.tsx`   | Row action with confirm dialog (matches User Management)|
| `src/lib/countries.ts`                                              | Fixed list of supported countries (ISO codes + labels) |

---

## 4. Access control — defense in depth

Three layers, all required:

1. **Middleware** (already in place from the auth plan): redirects unauthenticated requests.
2. **Page**: `await requireRole(['admin'])` at the top of `page.tsx` — Finance and Employee redirect to `/dashboard`.
3. **Server Actions**: every action calls `requireRole(['admin'])` server-side. Hiding the nav is not security.

The sidebar hides the entire Admin section for non-admins, per UI spec section 2.1.

---

## 5. List page

Server component. Filters come from URL search params:

- `?q=text` — case-insensitive match against code or name
- `?status=active|inactive`

```tsx
// src/app/(app)/admin/entities/page.tsx
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { entity } from "@/db/schema";
import { and, eq, or, ilike } from "drizzle-orm";
import { EntityTable } from "./_components/EntityTable";

type Search = { q?: string; status?: string };

export default async function EntitiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRole(["admin"]);
  const { q, status } = await searchParams;

  const conditions = [
    q ? or(ilike(entity.code, `%${q}%`), ilike(entity.name, `%${q}%`)) : undefined,
    status ? eq(entity.status, status as "active" | "inactive") : undefined,
  ].filter(Boolean);

  const rows = await db.query.entity.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (e, { asc }) => [asc(e.code)],
    with: {
      createdByUser: true,   // resolve createdBy → name
      updatedByUser: true,   // resolve updatedBy → name
    },
  });

  return <EntityTable entities={rows} filters={{ q, status }} />;
}
```

**Columns** (per UI mock and UI spec section 8.1):

| Column           | Source / format                                                              |
|------------------|------------------------------------------------------------------------------|
| Entity Code      | Chip, monospace, brand colors (matches the `apd-my` chip in the mock)         |
| Entity Name      | Plain text, medium weight                                                    |
| Country          | Flag emoji + country label (resolved from `src/lib/countries.ts`)             |
| Status           | Badge (green Active / grey Inactive)                                         |
| Date Added       | Formatted `createdAt`                                                        |
| Created By       | Resolved user name. "System" fallback retained in the UI for forward-compatibility with migrations but should not appear in normal operation. |
| Last Updated By  | Resolved user name with `updatedAt` shown as supporting text inline ("Sarah Chen · 2 days ago"). Shows "—" if `updatedBy` is null (entity has never been edited since creation). |
| Actions          | Two row buttons: Edit (pencil icon → modal for code/name/country) and Toggle Status (with confirm dialog — see sections 7 and 11). Matches the User Management pattern. |

**Empty state:** when no entities exist, show the friendly empty state per UI spec section 9 with an "Add your first entity" CTA. This is the first-deploy experience now that the spec doesn't pre-seed entities — the first admin lands here, sees the CTA, and creates `apd-my`, `apd-sg`, `apd-hk` (or whatever entities the org actually needs) one at a time through the Add Entity modal.

---

## 6. Add Entity modal

Modal fields per UI mock and UI spec section 8.2:

| Field       | Type         | Validation                                                              |
|-------------|--------------|-------------------------------------------------------------------------|
| Entity Code | Text (mono)  | Required. Pattern `^[a-z0-9]+(-[a-z0-9]+)*$`. Unique. Max 32 chars.      |
| Entity Name | Text         | Required. Max 200 chars. Trimmed.                                       |
| Country     | Dropdown     | Required. Must be one of the supported country codes (section 8).        |

**Submit button** stays disabled until all three are populated. On success, the modal closes and the new entity appears in the table (revalidated server-side).

**Helper text under Entity Code** (already in the mock):
> "Lowercase, hyphen-separated. Used in claim IDs and dropdowns."

Worth keeping — sets expectations for the format.

---

## 7. Edit Entity modal

The edit modal exposes three fields:

| Field       | Editable? | Notes                                                                                                                                                  |
|-------------|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| Entity Code | **Yes**, with confirm | Editable in the modal. On Save, if the code has changed, show a confirm dialog: *"Rename `apd-my` to `apd-malaysia`? This code is displayed everywhere across the portal — existing claims will show the new code immediately. Existing data is preserved; only the displayed identifier changes. Continue?"* Validation rules (lowercase, format, uniqueness) apply on save. |
| Entity Name | Yes       | Free text edit. No confirm dialog needed — name changes are low-impact (companies rebrand all the time).                                                |
| Country     | Yes       | Rare but possible (entity moves jurisdictions; code-country are independent so this can happen freely).                                                  |

**What's NOT in the edit modal:** status. Toggling between Active and Inactive happens via a separate row-action button (see section 5), with its own confirm dialog that includes the linked-claim count and the last-active-entity check (see section 11). This matches the User Management pattern and keeps status changes — which are higher-impact and lower-frequency than field edits — out of the field-edit flow.

**Server-side checks on code change:**
- Pattern validation (Zod regex).
- Uniqueness check against the `entity` table — if another entity already has that code (active or inactive), return a friendly error: *"Code `apd-my` is already in use. To reuse this code, first edit the existing entity that holds it."*
- The CHECK constraint at the DB level (section 2.1) is the safety net for any uppercase-code path that bypasses Zod.

---

## 8. Country handling

A fixed list of supported countries lives in `src/lib/countries.ts`. ISO 3166-1 alpha-2 codes are the source of truth in the database; labels and flag emojis are derived for display.

```ts
// src/lib/countries.ts
export const COUNTRIES = [
  { code: "MY", label: "Malaysia",           flag: "🇲🇾" },
  { code: "SG", label: "Singapore",          flag: "🇸🇬" },
  { code: "HK", label: "Hong Kong",          flag: "🇭🇰" },
  { code: "PH", label: "Philippines",        flag: "🇵🇭" },
  { code: "AE", label: "United Arab Emirates", flag: "🇦🇪" },
] as const;

export type CountryCode = typeof COUNTRIES[number]["code"];

export const COUNTRY_CODES = new Set<string>(COUNTRIES.map((c) => c.code));

export function getCountry(code: string) {
  return COUNTRIES.find((c) => c.code === code);
}
```

This is the same five countries shown in the mock's Add Entity modal. Adding a new country is a code change, not an admin action — which is fine because supported jurisdictions are a business-level decision, not a per-deployment one. See section 13 for the decision.

---

## 9. Server Actions

```ts
// src/app/(app)/admin/entities/_actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { entity } from "@/db/schema";
import { COUNTRY_CODES } from "@/lib/countries";

const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const CodeSchema = z.string()
  .trim()
  .min(2, "Entity code must be at least 2 characters.")
  .max(32)
  .regex(CODE_PATTERN, "Entity code must be lowercase letters, digits, and hyphens only.");

const NameSchema = z.string().trim().min(1).max(200);

const CountrySchema = z.string().refine((c) => COUNTRY_CODES.has(c), "Unsupported country.");

const CreateInput = z.object({
  code: CodeSchema,
  name: NameSchema,
  country: CountrySchema,
});

export async function createEntity(_prev: unknown, formData: FormData) {
  const admin = await requireRole(["admin"]);
  const parsed = CreateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const dup = await db.query.entity.findFirst({ where: eq(entity.code, parsed.data.code) });
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

export async function updateEntity(_prev: unknown, formData: FormData) {
  const admin = await requireRole(["admin"]);
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  // Uniqueness check on code — only block if a *different* entity holds this code.
  const codeClash = await db.query.entity.findFirst({
    where: and(eq(entity.code, parsed.data.code), ne(entity.id, parsed.data.entityId)),
  });
  if (codeClash) {
    return {
      error: `Code "${parsed.data.code}" is already in use. To reuse this code, first edit the existing entity that holds it.`,
    };
  }

  await db.update(entity)
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

/**
 * Returns context the UI needs to render the deactivation confirm dialog
 * with informed warnings (claim count, last-active check). Called by the
 * client before the toggle dialog is shown.
 */
export async function getDeactivationContext(entityId: string) {
  await requireRole(["admin"]);
  const target = await db.query.entity.findFirst({ where: eq(entity.id, entityId) });
  if (!target) return null;

  // Active-entity count excluding the target itself.
  const otherActive = await db.query.entity.findMany({
    where: and(eq(entity.status, "active"), ne(entity.id, entityId)),
  });
  const isLastActive = target.status === "active" && otherActive.length === 0;

  // Claim count — forward-looking. Until the Claims module lands, this
  // returns 0. When Claims is implemented, replace with a real query.
  const claimCount = 0;       // TODO: Claims workstream
  const openClaimCount = 0;   // TODO: Claims workstream

  return {
    entityCode: target.code,
    currentStatus: target.status,
    isLastActive,
    claimCount,
    openClaimCount,
  };
}

export async function toggleEntityStatus(_prev: unknown, formData: FormData) {
  const admin = await requireRole(["admin"]);
  const entityId = z.string().parse(formData.get("entityId"));
  const target = await db.query.entity.findFirst({ where: eq(entity.id, entityId) });
  if (!target) return { error: "Entity not found." };

  const next: "active" | "inactive" = target.status === "active" ? "inactive" : "active";

  await db.update(entity)
    .set({ status: next, updatedBy: admin.id, updatedAt: new Date() })
    .where(eq(entity.id, entityId));

  revalidatePath("/admin/entities");
  return { ok: true };
}
```

### 9.1 The deactivation confirm dialog (UI side)

The `ToggleStatusButton` component flow on deactivation:

1. User clicks the toggle button on a row whose status is Active.
2. Component calls `getDeactivationContext(entityId)` to fetch claim counts and the last-active check.
3. Shows a confirm dialog with copy assembled from the context:
    - **Linked claims warning** (if `claimCount > 0`): *"`apd-my` has 47 claims linked (12 in progress). Deactivating means it won't appear in the dropdown for new claims; existing claims are unaffected."*
    - **Last-active warning** (if `isLastActive`): *"⚠️ This is the last active entity. Deactivating means no new claims can be created until another entity is added or reactivated."*
    - **Both warnings can appear together.** If neither applies (no claims, not last active), the dialog falls back to a simple *"Deactivate `apd-my`?"* prompt.
4. User confirms → component calls `toggleEntityStatus` Server Action → revalidate.

Reactivation (Inactive → Active) shows a simpler confirm: *"Reactivate `apd-my`? It will be selectable again in the Claim creation dropdown."* No claim-count or last-active checks needed.

---

## 10. Validation summary

| Field       | Rule                                                                                       |
|-------------|--------------------------------------------------------------------------------------------|
| Code        | Required. Lowercase alphanumeric + hyphens. Min 2 chars, max 32. Unique. Cannot start or end with `-`. Pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`. Editable after creation, with confirm dialog (section 7). DB-level `CHECK (code = lower(code))` constraint catches any bypass of the Zod regex. |
| Name        | Required. Trimmed. Max 200 chars.                                                          |
| Country     | Required. Must be one of `MY`, `SG`, `HK`, `PH`, `AE`.                                       |
| Status      | One of `active` / `inactive`. Defaults to `active` on create.                              |
| createdBy   | Auto-set to the calling admin's user ID on create. Never accepted from the form.            |
| updatedBy   | Auto-set to the calling admin's user ID on every mutation (update + status toggle).         |

Surface validation errors inline in the modal — the modal stays open with the error visible, like the User Management modal.

---

## 11. Business rules / invariants

1. **Entity code is editable, with a confirm dialog.** Codes can be changed after creation via the edit modal. The save triggers a confirm dialog explaining that the rename is visible everywhere across the portal (existing claims, dropdowns, audit messages). Existing data is preserved — only the displayed identifier changes. (Decision: codes are not immutable; rename via deactivate-and-recreate is replaced by direct edit.)
2. **Code and country are independent.** No enforced relationship between them. An admin can create `apd-my` with country = Singapore, or `xyz-corp` with country = Malaysia. The mock's convention is `<prefix>-<lowercase country code>` but it's a polite suggestion, not a rule. Helper text in the Add Entity modal surfaces the convention without enforcing it.
3. **Entity name and country are editable.** Companies rebrand. Headquarters move. No invariants to enforce; no confirm dialog needed.
4. **Codes are globally unique** (active or inactive). Enforced by a unique index in the database; the Server Action pre-checks for a friendly error. To reuse a taken code, edit the holder first.
5. **No hard deletes.** Only status toggle (UI spec section 10).
6. **`createdBy` is set from the session**, never from the form. Same pattern as User Management.
7. **`updatedBy` is set from the session on every mutation** (edit or status toggle). Like `createdBy`, never accepted from the form. Drift between `updatedBy` and `updatedAt` is impossible because both are written in the same `set()` call.
8. **Inactive entities don't appear in the Claim creation dropdown.** This is enforced at the Claim form's data fetch (forward-looking, section 13).
9. **Deactivating an entity does NOT cascade.** Existing claims remain linked to that entity. Only the dropdown is filtered.
10. **Deactivation surfaces a warning with linked-claim count.** Not a hard block. The admin sees the impact and decides. Reactivation does not need this check. (See section 9.1 for the confirm-dialog copy.)
11. **Deactivating the last active entity surfaces an additional warning** — *"This is the last active entity. Deactivating means no new claims can be created until another entity is added or reactivated."* Still not a hard block; the admin can confirm and proceed. This asymmetry vs the User Management "at least one Admin must remain" hard rule is intentional: an empty entity list is a workflow problem (toggle one active in 5 seconds), not a recovery problem.
12. **Case insensitivity at the DB level.** A `CHECK (code = lower(code))` constraint guarantees no uppercase codes can ever exist, even via paths that bypass the Server Action's Zod validation.

### 11.1 What about claims linked to a deactivated entity?

Two design options when the Claims workstream lands:

- **Option A (recommended):** Existing claims continue to display the entity normally. No banner, no warning. The entity is simply no longer selectable for new claims.
- **Option B:** Show a small "Inactive" badge next to the entity chip on existing claim rows. More information but more visual noise.

This spec recommends Option A — it's quieter and the Claims list already has enough going on. Surfaced here so the team is aware; the Claims workstream owns the final call.

### 11.2 Code change retroactively affects existing claims

Because claims store `entityId` (FK by ID) and render the code by joining to the live `entity` row, **renaming an entity is retroactively visible on every existing claim**. If a 2-year-old claim referenced `apd-my` and an admin renames the entity to `apd-malaysia`, that claim's chip now reads `apd-malaysia`. The confirm dialog wording (section 7) makes this explicit.

If the team eventually wants historical-claim-code preservation (a claim shows the code it had at creation time, not the current code), the Claims workstream would need to snapshot the code onto the claim row at creation. That's deferred — not in scope for this spec.

---

## 12. No seed — first admin creates entities via the UI

The spec deliberately does **not** include a seed script for entities. Rationale:

- **No chicken-and-egg.** Bootstrap admins need to be seeded because the system has no way to create admins without an existing admin. Entities have no equivalent problem — once any admin is logged in, they can create entities through `/admin/entities` in the normal flow.
- **Accurate `createdBy`.** A real admin's name appears in the Created By column instead of "System." This is a more honest audit trail.
- **Forces explicit deployment decisions.** The deploying admin actively chooses which entities to create. No magic that diverges between environments.
- **The empty state we already need handles it.** Fresh local dev databases need an empty state anyway. Production now uses the same path.

The "saved time" of seeding three rows is minor. The first admin opens `/admin/entities`, sees the empty state's "Add your first entity" CTA, and creates `apd-my`, `apd-sg`, `apd-hk` in about 90 seconds — and `createdBy` reflects their actual name, not "System."

If the team later decides they want bulk-seeded entities in some environment, the path of least resistance is a small env-driven seed script (parallel to `BOOTSTRAP_ADMIN_EMAILS`). Not in scope for now.

---

## 13. Integration with Claims (forward-looking)

This spec does not implement the Claims module, but the entity table is designed for it. When Claims lands:

- The Claim creation form's Entity dropdown sources from `entity` where `status = 'active'`, ordered by code.
- The Claim record stores `entityId` (the UUID), not the code, as the foreign key.
- The Claims list table joins to `entity` and displays the entity code as a chip per the mock.
- Deactivating an entity has no effect on existing claims — it only removes the entity from the dropdown.

The contract from this spec to the Claims spec:

```ts
// In the future Claims module:
const activeEntities = await db.query.entity.findMany({
  where: eq(entity.status, "active"),
  orderBy: (e, { asc }) => [asc(e.code)],
});
```

---

## 14. Testing checklist

Manual end-to-end:

1. ✅ Admin opens `/admin/entities` for the first time on a fresh deploy → sees the empty state with "Add your first entity" CTA.
2. ❌ Finance user navigates to `/admin/entities` → redirected to `/dashboard`.
3. ❌ Employee user → does not see Admin section in the nav at all.
4. ✅ Admin clicks Add Entity → modal opens → submits with valid code (`apd-my`), name, country → new row appears. `createdBy` shows the admin's actual name (not "System").
5. ❌ Add Entity with code `APD-PH` (uppercase) → inline error: code must be lowercase / hyphens.
6. ❌ Add Entity with code `a` (one char) → inline error: must be at least 2 characters.
7. ❌ Add Entity with code `apd-my` when one already exists (active or inactive) → inline error suggesting to edit the existing entity first.
8. ❌ Add Entity with code `apd--ph` (double hyphen) → inline error: invalid format.
9. ❌ Add Entity with code starting or ending with a hyphen → inline error: invalid format.
10. ✅ Admin clicks Edit on `apd-my` → modal opens with **Entity Code as an editable field**, alongside Name and Country.
11. ✅ Edits name only (no code change) → save → table reflects new name immediately, no confirm dialog appears. "Last Updated By" column updates.
12. ✅ Edits code from `apd-my` to `apd-malaysia` → save → confirm dialog appears with the rename warning → confirm → table reflects new code, audit columns update.
13. ❌ Edits code to one already in use by another entity → inline error suggesting to edit that other entity first.
14. ✅ Toggles `apd-hk` from Active to Inactive via the **row toggle button** (not the modal) → confirm dialog appears with linked-claim count (0 until Claims module lands) → confirm → status badge updates to grey, "Last Updated By" updates.
15. ✅ Deactivates the last active entity → confirm dialog includes the "last active entity" warning alongside the claim count → admin can still confirm and proceed.
16. ✅ Reactivates an inactive entity → simpler confirm dialog (no claim-count or last-active warnings), then status flips to active.
17. ✅ Entity that has never been edited since creation → "Last Updated By" column shows "—".
18. ✅ Search by `apd-s` → only matching entities show.
19. ✅ Filter by status = Inactive → only inactive entities show.
20. ✅ URL `/admin/entities?q=hong&status=active` is shareable and renders the filtered view on a fresh load.
21. ❌ DB-level: attempt a raw SQL `INSERT INTO entity (code, ...) VALUES ('APD-MY', ...)` → rejected by the `CHECK (code = lower(code))` constraint.

Unit / integration:

- `createEntity` Server Action: valid input persists; non-admin caller throws; bad code format returns error; min-length violation returns error; duplicate code returns error; unsupported country returns error; `createdBy` is set to the caller; `updatedBy` stays null.
- `updateEntity`: code + name + country all update; `updatedBy` and `updatedAt` are set; uniqueness check on code excludes the entity being updated (you can save the same code without conflict).
- `toggleEntityStatus`: flips status; sets `updatedBy` and `updatedAt`; non-admin caller throws.
- `getDeactivationContext`: returns `isLastActive: true` when the target is the only active entity; returns `false` when at least one other active entity exists.
- Country resolver: `getCountry('MY')` returns Malaysia; `getCountry('XX')` returns undefined.

---

## 15. Decisions (locked)

All open questions resolved during the design grill.

| # | Decision                          | Value                                                                                                |
|---|-----------------------------------|------------------------------------------------------------------------------------------------------|
| 1 | Country list                      | Five hardcoded countries: MY, SG, HK, PH, AE. Adding a new country is a code change to `src/lib/countries.ts`. |
| 2 | Code-country coupling             | Free-form. No enforced relationship between `code` and `country`. Helper text in the Add modal surfaces the `<prefix>-<lowercase country>` convention without enforcing it. |
| 3 | Code editability after creation   | Editable in the edit modal with a confirm dialog explaining that the rename is visible everywhere across the portal. (Replaces "immutable" stance.) |
| 4 | Deactivation safeguard (claims)    | Warning with linked-claim count in the confirm dialog. Not a hard block. Claims module owns the count source when it lands. |
| 5 | Last-active-entity deactivation    | Additional strong warning in the confirm dialog. Still allowed if the admin confirms. Asymmetric vs the User Management "at least one Admin must remain" hard block — justified because an empty entity list is a workflow problem, not a recovery problem. |
| 6 | Seed strategy                     | No seed. First admin adds entities through the UI on first deploy. `createdBy` reflects their real name. |
| 7 | Toggle status UX pattern          | Row action button with confirm dialog. Matches User Management. Edit modal contains only field edits (code/name/country). |
| 8 | DB-level case enforcement         | `CHECK (code = lower(code))` constraint in addition to the Zod regex. Defense in depth at zero ongoing cost. |

---

## 16. Out of scope

- **Full audit log** of every change made to an entity. The `createdBy` / `updatedBy` columns capture "who last touched this" but not the history of changes (old name vs new name, who flipped status when). A separate `audit_log` table for full history is deferred — the User Management spec deferred this too; consider adding one later that covers both.
- **Bulk import** of entities (CSV upload). Three to eight entities is hand-editable territory; bulk import isn't worth the complexity.
- **Entity-level permissions.** All admins manage all entities. There's no concept of "Admin for `apd-my` only" — that would be a bigger access-control project.
- **Claim creation, listing, statement upload, verification flow** — all owned by the separate Claims workstream. This spec only sets up the foreign key contract.