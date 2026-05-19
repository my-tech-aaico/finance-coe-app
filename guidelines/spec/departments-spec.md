# Implementation Spec — Departments Management

**Project:** COE Finance Claims Portal
**Scope:** Admin CRUD UI for receipt departments (`/admin/departments`). Departments are referenced by the Receipt creation form to categorize an expense by which department incurred it.
**Stack:** Next.js App Router · TypeScript · Better Auth · Drizzle ORM · PostgreSQL.

This spec assumes the auth foundation, app shell, User Management, and Entities Management work are complete. The patterns here closely mirror **Entities Management** — same admin-only access, same code+name+status data model, same row-action toggle pattern, same `createdBy`/`updatedBy` audit columns. If anything is ambiguous in this spec, the resolution is "do what Entities does."

---

## 1. What departments are and what they do

A **department** is an organizational unit that a receipt is attributed to (e.g. Engineering, Marketing, Operations). Receipts pick a department from a dropdown at creation time. The department list is small (typically 5–15 entries) and managed only by Admins.

- Departments have a short code (`eng`, `mkt`, `ops`) displayed as a chip in the receipts table.
- Departments have a full name ("Engineering", "Marketing", "Operations").
- Departments can be Active or Inactive. Inactive departments **do not appear** in the Receipt creation dropdown but historical receipts still reference them.
- Departments are managed only by Admins.

There is no seed list — the first Admin creates the departments their org actually uses (same pattern as Entities, which dropped its seed in the entities grill).

---

## 2. Data model

### 2.1 New table: `department`

**File:** `src/db/schema/department.ts`

| Column      | Type                                      | Notes                                                                                          |
|-------------|-------------------------------------------|------------------------------------------------------------------------------------------------|
| `id`        | `text` (uuid), primary key                | Internal identifier. Used as foreign key from `receipt`.                                        |
| `code`      | `text`, unique, not null                  | The chip value, e.g. `eng`. Lowercase + hyphens only. Editable after creation (see section 7). |
| `name`      | `text`, not null                          | Full name, e.g. "Engineering".                                                                  |
| `status`    | enum `('active','inactive')`, default `'active'` | Toggle. No hard deletes.                                                                |
| `createdBy` | `text`, FK → `user.id`, nullable           | Kept nullable for forward-compatibility with future data migrations.                            |
| `createdAt` | `timestamp`, default `now()`               |                                                                                                |
| `updatedBy` | `text`, FK → `user.id`, nullable           | The admin who last modified the department. Set on every mutation. Null until first edit.       |
| `updatedAt` | `timestamp`, default `now()`               | Updated on every mutation, alongside `updatedBy`.                                              |

**Indexes:**
- Unique index on `code`.
- Plain index on `status` (the receipt-creation dropdown filters by `status = 'active'` on every load).

**Database CHECK constraints:**
- `CHECK (code = lower(code))` — guarantees no uppercase codes can ever exist, regardless of write path. Same belt-and-braces defense as Entities.

**Why ID-as-FK and not code-as-FK:** department codes are *displayed* identifiers but are editable (section 7), so foreign keys must point at the stable `id`. Receipts store `departmentId`, not `departmentCode`.

### 2.2 Forward-looking: `receipt` table reference

When the Receipt workstream (`receipt-cr.md`) lands, it will add:

```
receipt.departmentId  text NOT NULL REFERENCES department(id)
```

This spec doesn't create the receipt table — it just notes the FK contract so the department table is designed correctly.

### 2.3 Migration plan

1. `drizzle-kit generate` from the new schema.
2. `drizzle-kit migrate`.
3. No seed — the first Admin creates departments through the UI.

---

## 3. Routes and files

| File                                                                  | Purpose                                                       |
|-----------------------------------------------------------------------|---------------------------------------------------------------|
| `src/db/schema/department.ts`                                         | Drizzle table definition + CHECK constraint                   |
| `src/app/(app)/admin/departments/page.tsx`                            | List page with filters from URL params                         |
| `src/app/(app)/admin/departments/new/page.tsx`                        | Inline Add Department form                                     |
| `src/app/(app)/admin/departments/[id]/edit/page.tsx`                  | Inline Edit Department form                                    |
| `src/app/(app)/admin/departments/_actions.ts`                         | Server Actions: create / update / toggle status                |
| `src/app/(app)/admin/departments/_components/DepartmentTable.tsx`     | Client wrapper for search/filter UI                            |
| `src/app/(app)/admin/departments/_components/ToggleStatusButton.tsx`  | Row action with confirm dialog                                 |

---

## 4. Access control — defense in depth

Same three-layer model as Entities and User Management:

1. **Middleware:** redirects unauthenticated requests.
2. **Page:** `await requireRole(['admin'])` at the top of every department page. Finance and Employee redirect to `/dashboard`.
3. **Server Actions:** every action calls `requireRole(['admin'])` server-side.

The sidebar hides the entire Admin section for non-admins. Departments link sits alongside Entities, Classes, and User Management under the Admin nav group.

---

## 5. List page

Server component. Filters come from URL search params:

- `?q=text` — case-insensitive match against code or name
- `?status=active|inactive`

```tsx
// src/app/(app)/admin/departments/page.tsx
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { department } from "@/db/schema";
import { and, eq, or, ilike } from "drizzle-orm";
import { DepartmentTable } from "./_components/DepartmentTable";

type Search = { q?: string; status?: string };

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRole(["admin"]);
  const { q, status } = await searchParams;

  const conditions = [
    q ? or(ilike(department.code, `%${q}%`), ilike(department.name, `%${q}%`)) : undefined,
    status ? eq(department.status, status as "active" | "inactive") : undefined,
  ].filter(Boolean);

  const rows = await db.query.department.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: (d, { asc }) => [asc(d.code)],
    with: {
      createdByUser: true,
      updatedByUser: true,
    },
  });

  return <DepartmentTable departments={rows} filters={{ q, status }} />;
}
```

**Columns** (matches the Entities table pattern):

| Column           | Source / format                                                                                              |
|------------------|--------------------------------------------------------------------------------------------------------------|
| Code             | Chip, monospace, brand colors (matches the entity chip styling)                                              |
| Name             | Plain text, medium weight                                                                                    |
| Status           | Badge (green Active / grey Inactive)                                                                         |
| Date Added       | Formatted `createdAt`                                                                                        |
| Created By       | Resolved user name; "System" if `createdBy` is null (forward-compatibility only).                            |
| Last Updated By  | Resolved user name with `updatedAt` shown as supporting text ("Sarah Chen · 2 days ago"). "—" if never edited. |
| Actions          | Two row buttons: Edit (pencil icon → modal) and Toggle Status (with confirm dialog).                          |

**Empty state:** "No departments yet" with "Add your first department" CTA. This is the first-deploy experience.

---

## 6. Add Department form

**Route:** `/admin/departments/new`
**Pattern:** Per UI spec section 10, full-page inline form with "← Back to Departments" link. No modal.

| Field | Type        | Validation                                                                                         |
|-------|-------------|----------------------------------------------------------------------------------------------------|
| Code  | Text (mono) | Required. Pattern `^[a-z0-9]+(-[a-z0-9]+)*$`. Min 2, max 32 chars. Unique. Cannot start/end with `-`. |
| Name  | Text        | Required. Max 200 chars. Trimmed.                                                                  |

**Helper text under Code:** *"Lowercase, hyphen-separated. Used in receipt records and dropdowns. Convention: short keyword (e.g. `eng`, `mkt-asia`)."*

Submit button stays disabled until both fields are populated. On success, the form redirects to `/admin/departments` and the new department appears in the table.

---

## 7. Edit Department form

**Route:** `/admin/departments/[id]/edit`

Same component as Add, with these differences:

| Field  | Editable?              | Notes                                                                                                       |
|--------|------------------------|-------------------------------------------------------------------------------------------------------------|
| Code   | **Yes**, with confirm  | Editable. On Save, if the code has changed, show a confirm dialog: *"Rename `eng` to `engineering`? This code is displayed everywhere receipts use it — existing receipts will show the new code immediately. Continue?"* |
| Name   | Yes                    | Free text edit. No confirm.                                                                                 |

**What's NOT here:** status. Toggling happens via the row-action button on the list page, with its own confirm dialog. Matches the Entities pattern.

**Server-side checks on code change:**
- Pattern validation (Zod regex).
- Uniqueness check against the `department` table — friendly error if conflict: *"Code `eng` is already in use. To reuse this code, first edit the existing department that holds it."*
- DB CHECK constraint catches any uppercase bypass.

---

## 8. Server Actions

```ts
// src/app/(app)/admin/departments/_actions.ts
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
  .max(32)
  .regex(CODE_PATTERN, "Code must be lowercase letters, digits, and hyphens only.");

const NameSchema = z.string().trim().min(1).max(200);

const CreateInput = z.object({ code: CodeSchema, name: NameSchema });

export async function createDepartment(_prev: unknown, formData: FormData) {
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

export async function updateDepartment(_prev: unknown, formData: FormData) {
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

/**
 * Returns context the UI needs to render the deactivation confirm dialog
 * with informed warnings (receipt count, last-active check).
 */
export async function getDeactivationContext(departmentId: string) {
  await requireRole(["admin"]);
  const target = await db.query.department.findFirst({ where: eq(department.id, departmentId) });
  if (!target) return null;

  const otherActive = await db.query.department.findMany({
    where: and(eq(department.status, "active"), ne(department.id, departmentId)),
  });
  const isLastActive = target.status === "active" && otherActive.length === 0;

  // Receipt count — forward-looking. Until the Receipts workstream lands,
  // returns 0. When Receipts is implemented, replace with a real query.
  const receiptCount = 0; // TODO: Receipts workstream

  return {
    code: target.code,
    currentStatus: target.status,
    isLastActive,
    receiptCount,
  };
}

export async function toggleDepartmentStatus(_prev: unknown, formData: FormData) {
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
```

### 8.1 The deactivation confirm dialog (UI side)

Same pattern as Entities. The `ToggleStatusButton` component flow on deactivation:

1. User clicks the toggle button on an active row.
2. Component calls `getDeactivationContext(departmentId)` to fetch receipt count and last-active flag.
3. Confirm dialog assembles copy from the context:
   - **Linked receipts warning** (if `receiptCount > 0`): *"`eng` has 47 receipts using it. Deactivating means it won't appear in the dropdown for new receipts; existing receipts are unaffected."*
   - **Last-active warning** (if `isLastActive`): *"⚠️ This is the last active department. Deactivating means no new receipts can be created until another department is added or reactivated."*
   - **Neither**: simple *"Deactivate `eng`?"* prompt.
4. User confirms → component calls `toggleDepartmentStatus` Server Action → revalidate.

Reactivation (inactive → active) shows a simpler confirm without claim-count or last-active checks.

---

## 9. Validation summary

| Field       | Rule                                                                                       |
|-------------|--------------------------------------------------------------------------------------------|
| Code        | Required. Lowercase alphanumeric + hyphens. Min 2 chars, max 32. Unique. Cannot start or end with `-`. Pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`. Editable after creation, with confirm dialog. DB CHECK enforces lowercase. |
| Name        | Required. Trimmed. Max 200 chars.                                                          |
| Status      | One of `active` / `inactive`. Defaults to `active` on create.                              |
| createdBy   | Auto-set to the calling admin's user ID. Never accepted from the form.                     |
| updatedBy   | Auto-set on every mutation. Never accepted from the form.                                  |

---

## 10. Business rules / invariants

1. **Department code is editable, with a confirm dialog.** Same pattern as Entities — codes are not immutable.
2. **Codes are globally unique** (across active and inactive). Enforced by unique index; Server Action pre-checks for a friendly error.
3. **No hard deletes.** Only status toggle.
4. **`createdBy` and `updatedBy` are session-derived**, never from the form.
5. **Inactive departments don't appear in the Receipt creation dropdown.** Receipts workstream enforces.
6. **Deactivation surfaces a warning with linked-receipt count.** Not a hard block.
7. **Deactivating the last active department surfaces an additional warning** — *"This is the last active department. Deactivating means no new receipts can be created until another department is added or reactivated."* Allow if confirmed (same philosophy as Entities — workflow problem, not recovery problem).
8. **Case insensitivity at the DB level** via `CHECK (code = lower(code))`.

---

## 11. Integration with Receipts (forward-looking)

When the Receipt workstream lands:

- The Receipt creation form's Department dropdown sources from `department` where `status = 'active'`, ordered by code.
- The Receipt record stores `departmentId` (UUID), not the code, as the foreign key.
- The Receipts table joins to `department` and displays the department code as a chip.
- Deactivating a department has no effect on existing receipts.
- If a receipt's currently-assigned department has been deactivated, the Edit Receipt form's Department dropdown shows it labeled `eng (inactive)` plus active departments — same pattern as Entities + Claimants on the Claim Edit form. Server validates: the current departmentId is accepted even if inactive; a *different* inactive department is rejected.

---

## 12. Testing checklist

Manual end-to-end:

1. ✅ Admin opens `/admin/departments` on a fresh deploy → sees empty state with "Add your first department" CTA.
2. ❌ Finance user navigates to `/admin/departments` → redirected to `/dashboard`.
3. ❌ Employee → does not see Admin section in nav.
4. ✅ Admin clicks Add → form opens → submits with valid code/name → new row appears.
5. ❌ Add with code `ENG` (uppercase) → inline error.
6. ❌ Add with code `e` (one char) → inline error: min 2.
7. ❌ Add with duplicate code → inline error suggesting edit existing.
8. ❌ Add with `eng--asia` (double hyphen) → inline error.
9. ✅ Admin clicks Edit on `eng` → form pre-fills with Code and Name both editable.
10. ✅ Edit name only → save → no confirm, table reflects new name.
11. ✅ Edit code from `eng` to `engineering` → confirm dialog appears → confirm → table shows new code.
12. ❌ Edit code to one already in use → inline error.
13. ✅ Toggle `eng` from Active to Inactive via row button → confirm dialog → toggle status.
14. ✅ Deactivate the last active department → additional warning in dialog → can still confirm.
15. ❌ Raw SQL `INSERT INTO department (code, ...) VALUES ('ENG', ...)` → rejected by CHECK constraint.
16. ✅ Search by `en` → matching departments show.
17. ✅ Filter by status = Inactive → only inactive show.

Unit / integration:

- `createDepartment`: valid input persists; non-admin throws; bad code format / duplicates / unsupported errors all return proper errors; `createdBy` set; `updatedBy` null.
- `updateDepartment`: code + name update; `updatedBy`/`updatedAt` set; uniqueness check excludes self.
- `toggleDepartmentStatus`: flips status; sets `updatedBy`/`updatedAt`.
- `getDeactivationContext`: returns `isLastActive: true` when target is the only active one.

---

## 13. Decisions (locked — inherited from Entities patterns)

| # | Decision                    | Value                                                                                             |
|---|-----------------------------|---------------------------------------------------------------------------------------------------|
| 1 | Code editability            | Editable with confirm dialog (same as Entities).                                                  |
| 2 | Deactivation safeguard      | Warning with receipt count. Not a hard block. Receipts workstream owns the count source.           |
| 3 | Last-active deactivation    | Strong warning, allow if confirmed. Asymmetric vs User Management's hard block — workflow problem, not recovery problem. |
| 4 | Seed strategy               | No seed. First Admin creates departments through the UI.                                          |
| 5 | Toggle status UX            | Row action button with confirm. Edit form contains only code + name.                              |
| 6 | DB-level case enforcement   | `CHECK (code = lower(code))` constraint.                                                          |

---

## 14. Out of scope

- **Audit log** of every change made. The `createdBy` / `updatedBy` columns capture "who last touched this." A full history table is deferred.
- **Bulk import** (CSV). Hand-editable territory.
- **Department-level permissions.** All admins manage all departments. No "Admin for eng only."
- **Hierarchy / sub-departments.** Flat list only. No "Engineering > Platform > Infra" tree.
- **Receipt creation, listing, file upload** — owned by `receipt-cr.md`. This spec only sets up the FK contract.
