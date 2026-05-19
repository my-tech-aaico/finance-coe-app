# Implementation Spec — Classes Management

**Project:** COE Finance Claims Portal
**Scope:** Admin CRUD UI for receipt classes (`/admin/classes`). Classes are expense categories (e.g. Travel, Meals, Supplies) referenced by the Receipt creation form alongside Department.
**Stack:** Next.js App Router · TypeScript · Better Auth · Drizzle ORM · PostgreSQL.

This spec is structurally near-identical to `departments-spec.md`. Both share the same schema shape (code + name + status + audit), the same admin-only access model, the same row-action toggle pattern, and the same forward-looking integration with Receipts. **Read `departments-spec.md` first** — this spec only documents what's different.

---

## 1. What classes are and what they do

A **class** is an expense category that a receipt is attributed to (e.g. Travel, Meals, Supplies, Software Subscription, Training). Receipts pick a class from a dropdown at creation time. The class list is small (typically 8–20 entries) and managed only by Admins.

- Classes have a short code (`travel`, `meals`, `supplies`) displayed as a chip in the receipts table.
- Classes have a full name ("Travel & Transport", "Meals & Entertainment", "Office Supplies").
- Classes can be Active or Inactive. Inactive classes don't appear in the Receipt dropdown but historical receipts still reference them.
- Classes are managed only by Admins.

There is no seed list — the first Admin creates the classes their org uses, same pattern as Departments and Entities.

**Relationship to Department:** Classes and Departments are orthogonal — every receipt picks one of each. A receipt is "Engineering / Travel" or "Marketing / Meals." There is no link or constraint between the two tables.

---

## 2. Data model

### 2.1 New table: `class`

**File:** `src/db/schema/class.ts`

The schema is identical in shape to `department`:

| Column      | Type                                              | Notes                                                                                          |
|-------------|---------------------------------------------------|------------------------------------------------------------------------------------------------|
| `id`        | `text` (uuid), primary key                        | Internal identifier. Used as foreign key from `receipt`.                                        |
| `code`      | `text`, unique, not null                          | The chip value, e.g. `travel`. Lowercase + hyphens only. Editable with confirm.                |
| `name`      | `text`, not null                                  | Full name, e.g. "Travel & Transport".                                                          |
| `status`    | enum `('active','inactive')`, default `'active'`  | Toggle. No hard deletes.                                                                       |
| `createdBy` | `text`, FK → `user.id`, nullable                  |                                                                                                |
| `createdAt` | `timestamp`, default `now()`                       |                                                                                                |
| `updatedBy` | `text`, FK → `user.id`, nullable                  | Set on every mutation. Null until first edit.                                                  |
| `updatedAt` | `timestamp`, default `now()`                       |                                                                                                |

**Important note on the table name:** `class` is a reserved word in many SQL dialects. Drizzle handles quoting automatically, but in raw SQL contexts (manual queries, migration scripts) the table name must be quoted as `"class"`. If this turns out to be a frequent footgun for tooling integration, rename to `expense_class` — the rest of this spec uses `class` for brevity.

**Indexes:**
- Unique index on `code`.
- Plain index on `status`.

**Database CHECK constraints:**
- `CHECK (code = lower(code))`.

### 2.2 Forward-looking: `receipt` table reference

```
receipt.classId  text NOT NULL REFERENCES class(id)
```

---

## 3. Routes and files

Mirrors `departments-spec.md` section 3 with paths under `/admin/classes/`:

| File                                                            | Purpose                          |
|-----------------------------------------------------------------|----------------------------------|
| `src/db/schema/class.ts`                                        | Drizzle table definition          |
| `src/app/(app)/admin/classes/page.tsx`                          | List page                         |
| `src/app/(app)/admin/classes/new/page.tsx`                      | Add Class form                    |
| `src/app/(app)/admin/classes/[id]/edit/page.tsx`                | Edit Class form                   |
| `src/app/(app)/admin/classes/_actions.ts`                       | Server Actions                    |
| `src/app/(app)/admin/classes/_components/ClassTable.tsx`        | List wrapper                      |
| `src/app/(app)/admin/classes/_components/ToggleStatusButton.tsx`| Row toggle action                 |

---

## 4. Access control

Admin-only, defense in depth — same three layers as `departments-spec.md` section 4. Server Actions all use `requireRole(['admin'])`.

---

## 5. Differences vs. departments

These are the only meaningful differences between this spec and `departments-spec.md`:

| Aspect                       | Departments                                          | Classes                                              |
|------------------------------|------------------------------------------------------|------------------------------------------------------|
| Table name                   | `department`                                          | `class` (reserved word; quote in raw SQL)            |
| Route prefix                 | `/admin/departments`                                  | `/admin/classes`                                      |
| Conventional code examples   | `eng`, `mkt`, `ops`, `finance`                       | `travel`, `meals`, `supplies`, `software`, `training` |
| Helper text on Code field    | "Used in receipt records and dropdowns. Convention: short keyword (e.g. `eng`, `mkt-asia`)." | "Used in receipt records and dropdowns. Convention: short keyword (e.g. `travel`, `software`)." |
| Receipt FK column            | `receipt.departmentId`                                | `receipt.classId`                                     |

**Everything else is the same:** validation rules, Server Action shapes, toggle dialog behavior, last-active warning, audit columns, business rules, testing checklist structure.

---

## 6. Server Actions (concrete code)

Same code shape as `departments-spec.md` section 8, with the table swapped. Provided here for direct copy-paste convenience:

```ts
// src/app/(app)/admin/classes/_actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { class_ as klass } from "@/db/schema";  // `class` is reserved in TS too

const CODE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CodeSchema = z.string().trim().min(2).max(32).regex(CODE_PATTERN);
const NameSchema = z.string().trim().min(1).max(200);

const CreateInput = z.object({ code: CodeSchema, name: NameSchema });

export async function createClass(_prev: unknown, formData: FormData) {
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

export async function updateClass(_prev: unknown, formData: FormData) {
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

  const receiptCount = 0; // TODO: Receipts workstream

  return { code: target.code, currentStatus: target.status, isLastActive, receiptCount };
}

export async function toggleClassStatus(_prev: unknown, formData: FormData) {
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
```

**One subtle naming note:** `class` is a reserved word in both SQL and TypeScript. In the Drizzle schema file, export the table under a TypeScript-safe alias:

```ts
// src/db/schema/class.ts
export const class_ = pgTable("class", { ... });   // Drizzle table named "class" in SQL
```

Then import everywhere as `class_` to avoid the keyword clash.

---

## 7. Business rules / invariants

Identical to `departments-spec.md` section 10. Substitute "class" for "department" in every rule.

The one additional rule worth restating because it's easy to forget:

- **Classes and Departments are independent.** A receipt picks one of each. No "valid combinations" matrix, no constraints between the two dropdowns. Engineering / Travel is just as valid as Engineering / Meals.

---

## 8. Testing checklist

Mirror of `departments-spec.md` section 12. Substitute class examples (`travel`, `meals`, etc.) for department examples (`eng`, `mkt`).

Additionally:

- ✅ Verify raw SQL `INSERT INTO "class" (code, ...) VALUES ('TRAVEL', ...)` rejected by CHECK constraint (with the reserved-word quoting).
- ✅ Both Department and Class dropdowns on the receipt creation form are populated and independent (Receipts workstream tests this end-to-end).

---

## 9. Decisions (locked — inherited from Departments and Entities patterns)

Same set as `departments-spec.md` section 13. One additional spec-local decision:

| # | Decision                       | Value                                                                                              |
|---|--------------------------------|----------------------------------------------------------------------------------------------------|
| 7 | Table name                     | `class` (quoted in raw SQL). Acceptable footgun for the reduced surface area. Rename to `expense_class` if it causes friction with tooling. |

---

## 10. Out of scope

Same as `departments-spec.md` section 14:

- Audit log of every change.
- Bulk import.
- Per-class permissions.
- Hierarchy / sub-classes (flat list only).
- Receipt creation / file upload — owned by `receipt-cr.md`.
