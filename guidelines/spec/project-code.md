# v2 Implementation Guide — Code & Database

> **Purpose:** step-by-step guideline for updating the application code and database to the **v2** design.
> **Source of truth for behaviour:** [`guidelines/ui/COE_Finance_Claims_Portal_UI_Spec_v2.md`](./ui/COE_Finance_Claims_Portal_UI_Spec_v2.md) and the mock [`guidelines/ui/COE_Finance_Claims_Portal_UI_Mock_v2.html`](./ui/COE_Finance_Claims_Portal_UI_Mock_v2.html).
> **Scope:** the whole v2 migration — new **Credit Card Holder** role, **Project Code** list, **Team Split** list, **receipt amount/FX/date removal**, and the **role/scoping** changes.
>
> **Decisions locked for this work (from review):**
> 1. **Whole-v2 scope.** After the code is built and verified, update the older docs (`COE_Finance_Claims_Portal_UI_Spec.md`, and the v2 spec's "retained but unused FX" wording) to remove no-longer-valid content and point here — see §14.
> 2. **Drop the receipt amount/FX/date columns** (not keep-nullable). ⚠️ This is **irreversible and discards historical amount/FX values** — take a backup/export first (see §3.0).
> 3. **Existing data must be preserved.** All migrations are additive or column-drops only; no table drops, no row deletion. New receipt FK columns are added **nullable** and backfilled where possible.
> 4. **Fix the two scoping deviations** so runtime matches the spec (employees scoped to their own claims; within a claim, Admin/Finance/CCH see all receipts while **employees see only receipts they uploaded**).

---

## 0. Current architecture (for context)

| Area | Where | Notes |
|------|-------|-------|
| Framework | Next.js 15 App Router, React 19 | Server Components + Server Actions (`_actions.ts`). |
| DB / ORM | Postgres + **Drizzle** (`drizzle-orm`, `drizzle-kit`) | Schema in `src/db/schema/*`, migrations in `drizzle/`. |
| Auth | **better-auth** (Google SSO) | `src/lib/auth.ts`; role/status enforced in DB hooks + `src/lib/session.ts`. |
| Roles (today) | `admin \| finance \| employee` | Hardcoded in **many** places — see §2. |
| Files | Google Drive (`src/lib/drive.ts`) | Per-claim folders on the `claim` row. |
| FX | `src/lib/fx.ts`, `src/db/schema/fxRate.ts`, `src/scripts/fx-scheduler.ts` | Used by receipt create/update today; **becomes unused** in v2 (see §9.4). |

Feature folders follow one pattern (mirror it for new features):
`page.tsx` (server) · `_actions.ts` (server actions) · `_components/*` · sometimes `_lib/*`.
Reference implementation for an admin config list: **`src/app/(app)/admin/classes/`**.

---

## 1. Change map (what v2 touches)

| # | v2 change | DB | Code |
|---|-----------|----|------|
| A | New role **Credit Card Holder** | `role` enum add value | `session.ts`, `permissions.ts`, `Sidebar.tsx`, every `requireRole([...])`, role union types |
| B | **Project Code** read-only admin list | new `project_code` table | new `admin/project-code` page (list only), receipt-form dropdown |
| C | **Team Split** managed **inside the Class edit page** (not a standalone menu) | new `team_split` table **with its own `status`** | Team Splits panel in `admin/classes/[id]/edit` (list + Add + Edit-name + Deactivate/Activate); receipt-form class-dependent dropdown |
| D | Receipt drops **amount/currency/USD/fx/receipt_date** | drop 6 columns + constraints | receipt form, table, summary card, `_actions.ts`, FX calls removed |
| E | Receipt gains **project_code + team_split** | 2 new FK columns on `receipt` | receipt form/table, actions, relations |
| F | **Statements**: CCH in, Employee out; relax claimant rule; CCH sees own uploads | — | statements pages, actions, list scoping |
| G | **Scoping fixes**: employees → own claims; within a claim, all viewers see all receipts **except employees → only receipts they uploaded** | — | `receipts/page.tsx`, `receipts/[id]/_lib/access.ts` |
| H | **Dashboard**: CCH dashboard; Employee redirects to Receipts | — | `dashboard/page.tsx` |
| I | **New Claim** button hidden for CCH/Employee | — | already role-gated at route; hide the button too |

---

## 2. Roles — add "Credit Card Holder"

The role string is **`credit_card_holder`** (DB enum value + internal), label **"Credit Card Holder"** in UI.

### 2.1 Every place roles are declared (grep before you start)

```bash
# Run these — expect hits in each file below:
rg -n '"admin"\s*\|\s*"finance"\s*\|\s*"employee"' src        # union types
rg -n 'requireRole\(' src                                      # action/page guards
rg -n 'roleEnum|"role"' src/db/schema/auth.ts                  # DB enum
```

Known locations to update:

- `src/db/schema/auth.ts` → `roleEnum = pgEnum("role", ["admin","finance","employee","credit_card_holder"])`
- `src/lib/session.ts` → widen the `requireRole` param union type to include `"credit_card_holder"`.
- `src/lib/permissions.ts` → `type Role` union + `ACCESS_MAP` (see §2.3).
- `src/app/(app)/_components/Sidebar.tsx` → `type Role` union + new nav items (§5, §6).
- All `_actions.ts` / `page.tsx` calling `requireRole([...])` — set the correct allow-list per the v2 function matrix (spec §3.1.1). **Do not blanket-add CCH everywhere** — e.g. Create/Edit Claim stays `["admin","finance"]`.

> Consider centralising the role union as one exported type (e.g. `export type Role = "admin" | "finance" | "employee" | "credit_card_holder"` in `permissions.ts`) and importing it everywhere, to avoid drift next time.

### 2.2 Enum migration caveat (Postgres)

Adding a value to a PG enum **cannot be used in the same transaction** it's created in, and older PG rejects `ALTER TYPE ... ADD VALUE` inside a transaction. Drizzle wraps migrations in a transaction. Therefore:

- Put the enum change in its **own migration**, applied **before** any migration/seed that references `credit_card_holder`.
- Generated SQL should be: `ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'credit_card_holder';`
- If `drizzle-kit migrate` fails on the transaction, run that one statement manually (psql) or mark the migration to run non-transactionally.

No existing users are auto-reassigned — admins set the CCH role via User Management (§7 add "Credit Card Holder" to the role dropdown; it's already in the spec §7.2).

### 2.3 Target `ACCESS_MAP` (`src/lib/permissions.ts`)

```
/dashboard          → admin, finance, credit_card_holder, employee
/claims/receipts    → admin, finance, credit_card_holder, employee
/claims/statements  → admin, finance, credit_card_holder          (employee removed)
/admin/users        → admin
/admin/entities     → admin
/admin/project-code → admin, finance                              (new)
/admin/departments  → admin
/admin/classes      → admin, finance                              (finance added — spec §11)
```

> Note: today `classes` is `["admin"]`; v2 gives **Finance** access to Classes and Project Code (spec §3.1). Update `classes` too. `requireRole` guards inside those pages/actions must match.
> **There is no `/admin/team-split` route** — Team Splits are managed inside the Class edit page, so their access rides on `/admin/classes` (§6).

---

## 3. Database migrations

Generate with `pnpm db:generate` (drizzle-kit) after editing schema files, then apply with `pnpm db:migrate`. Split into ordered migrations so the enum caveat (§2.2) holds.

### 3.0 ⚠️ Back up first (column drop is destructive)

Dropping the receipt amount/FX columns permanently deletes those values. Before migrating:

```bash
pg_dump "$DATABASE_URL" -t receipt --data-only > backup_receipt_$(date +%Y%m%d).sql
# or archive the soon-to-drop columns into a side table:
# CREATE TABLE receipt_amount_archive AS
#   SELECT id, receipt_date, amount_local, currency_code, amount_usd, fx_rate, fx_rate_fetched_at FROM receipt;
```

### 3.1 Migration order

1. **`role` enum** add value (own migration — §2.2).
2. **`project_code`** table (§3.2).
3. **`team_split`** table **incl. its `status` column** + `team_split_status` enum (§3.3).
4. **`receipt`** add `project_code_id`, `team_split_id` (nullable) (§3.4).
5. *(optional)* **Backfill** existing receipts (§3.4).
6. **`receipt`** drop `receipt_date`, `amount_local`, `currency_code`, `amount_usd`, `fx_rate`, `fx_rate_fetched_at` + their check constraints and the `receipt_date_idx` index (§3.5).

> ⚠️ **`0009` is already applied** (the `team_split`/`project_code` tables exist and were seeded). It creates `team_split` **without** a status column. Do **NOT** edit `0009` — an already-recorded migration won't re-run, so the column would silently never be created. Add a **new follow-up migration `drizzle/0010_team_split_status.sql`**:
>
> ```sql
> CREATE TYPE "public"."team_split_status" AS ENUM('active','inactive');--> statement-breakpoint
> ALTER TABLE "team_split" ADD COLUMN "status" "team_split_status" DEFAULT 'active' NOT NULL;
> ```
>
> Existing seeded rows become `active` via the default. (If `0009` had **not** been applied yet, amending it in place would be fine — but here it has.)

### 3.2 `project_code` table — new schema file `src/db/schema/projectCode.ts`

- Columns: `id` (text PK, uuid default), `code` (text, unique, not null), `name` (text, not null), `createdAt`, `updatedAt` (timestamps).
- **No status column** (spec §9: only Code + Name). Read-only in the portal; the sync job that fills it is **out of scope** — the table may start empty or be seeded manually (§10).
- Mirror the `department`/`class` file style, **but do NOT add a lowercase-code check** — project codes are **uppercase** (e.g. `PRJ-100`). Unlike `class`/`department`, allow uppercase letters/digits/hyphens.
- Register in `src/db/schema/index.ts` and add relations in `relations.ts` (`many(receipt)`).

### 3.3 `team_split` table — new schema file `src/db/schema/teamSplit.ts`

- Columns: `id` (text PK), `code` (text, not null), `name` (text, not null), `classId` (text, not null, FK → `class.id`), **`status`** (new — see below), `createdBy`, `createdAt`, `updatedBy`, `updatedAt`.
- **Own `status` column** (`team_split_status` enum: `active` | `inactive`, default `active`) — toggled per row via a Deactivate/Activate action (spec §12.1/§12.3). *This reverses the earlier "status derived from the parent Class, never store" design.*
- **Effective availability** on the receipt form = the Team Split's **own** status is Active **AND** its parent Class is Active. (A class going inactive doesn't flip each row's own flag, but its splits are unselectable because the class isn't selectable.)
- Constraint: **unique `(class_id, code)`** (code unique *within* a class, not globally — spec §12.1). Add `index` on `class_id`.
- Relations: `team_split.class → class` (one), `class.teamSplits → team_split` (many), `team_split.receipts → receipt` (many).

### 3.4 `receipt` — add the two FK columns (nullable)

Add to `src/db/schema/receipt.ts`:

- `projectCodeId` text, FK → `project_code.id`. **Nullable at DB** (legacy rows have none); **required at app level** for new receipts (§8).
- `projectCode` text, **snapshot** of the code string, copied from the linked `project_code` row at write time (decided §13). Keeps display/history stable if the synced list later renames/removes the code. Nullable for legacy rows.
- `teamSplitId` text, FK → `team_split.id`, **nullable** (class may have no splits; legacy rows have none).
- Add indexes on `projectCodeId` and `teamSplitId`.
- **Write both** `projectCodeId` **and** `projectCode` on create/update. On display, prefer the live join but fall back to the snapshot if the FK row is gone.

**Legacy receipts (decided):** existing receipts predate these fields — **leave `project_code_id` and `team_split_id` NULL** (no backfill). Do **not** add a NOT NULL constraint on either column. Legacy receipts render an em-dash in those columns; the app enforces Project Code only for **new** receipts.

### 3.5 `receipt` — drop the amount/FX/date columns

Remove from the schema file and let drizzle generate the drop, or hand-write:

```sql
ALTER TABLE receipt
  DROP CONSTRAINT IF EXISTS receipt_amount_local_positive,
  DROP CONSTRAINT IF EXISTS receipt_amount_usd_non_negative,
  DROP CONSTRAINT IF EXISTS receipt_currency_code_format;
DROP INDEX IF EXISTS receipt_date_idx;
ALTER TABLE receipt
  DROP COLUMN IF EXISTS receipt_date,
  DROP COLUMN IF EXISTS amount_local,
  DROP COLUMN IF EXISTS currency_code,
  DROP COLUMN IF EXISTS amount_usd,
  DROP COLUMN IF EXISTS fx_rate,
  DROP COLUMN IF EXISTS fx_rate_fetched_at;
```

Sorting now uses `uploaded_at` (already exists, indexed via `receipt_uploaded_by_idx`? add `receipt_uploaded_at_idx` if you want an explicit sort index).

> **Keep** `entity.currency` (spec §8 — retained but unused) and the `fx_rate` **table** + fx-scheduler (harmless; see §9.4). Only the receipt-level amount/FX **columns** are dropped.

---

## 4. Drizzle schema/relations checklist

- [ ] `src/db/schema/auth.ts` — role enum value.
- [ ] `src/db/schema/projectCode.ts` — new.
- [ ] `src/db/schema/teamSplit.ts` — new, **with its own `status` column + `team_split_status` enum**.
- [ ] `src/db/schema/receipt.ts` — add `projectCodeId`, `teamSplitId`; remove amount/FX/date columns + their `check`s + `receipt_date_idx`.
- [ ] `src/db/schema/index.ts` — export the two new tables.
- [ ] `src/db/schema/relations.ts` — add `projectCode`/`teamSplit` relations; extend `receiptRelations` with `projectCode` + `teamSplit`; add `classRelations.teamSplits`.

---

## 5. Feature — Project Code (read-only admin list)

Route: **`/admin/project-code`** (nav placed after Entities — spec §2.1). Visible to Admin + Finance.

- `src/app/(app)/admin/project-code/page.tsx` — `requireRole(["admin","finance"])`; query `project_code` ordered by code; render a **list-only** table (columns **Code, Name**), a search box, and a read-only info banner. **No Add/Edit/Delete, no `_actions.ts`.**
- Add the nav `<Link>` in `Sidebar.tsx` inside the Admin group, gated by `canAccess(role, "/admin/project-code")`.
- Empty state: message only, **no create CTA** (spec §13).

---

## 6. Feature — Team Splits (managed inside the Class edit page)

**There is no `/admin/team-split` route.** Team Splits live under the **Class edit page** `/admin/classes/[classId]/edit` (spec §11.5, §12). Visible to whoever can open a Class (Admin + Finance).

> ⚠️ **Rework required — the standalone version was already built and is now wrong.** Delete `src/app/(app)/admin/team-split/**` (page, `_actions.ts`, `_components/*`, `new/`, `[id]/edit/`), remove the Team Split `<Link>` from `Sidebar.tsx`, and remove `/admin/team-split` from `ACCESS_MAP`. The pieces below move into the Class edit page.

### 6.1 Class edit page hosts the Team Splits panel

`src/app/(app)/admin/classes/[id]/edit/page.tsx` is currently just a name-edit form. Extend it to render, below the class fields, a **Team Splits panel**:
- Header + **"Add Team Split"** button.
- Table columns: **Code, Name, Status, Date Added, Created By, Actions** — **no Class column** (scoped to this class).
- Per-row actions: **Edit** and **Deactivate / Activate**.
- Load the class's team splits (`where teamSplit.classId = <classId>`), plus created-by names.

**Interaction model (decided):** the class-name form and the Team Splits panel are **independent** operations on one page.
- **`updateClass` must stop redirecting to `/admin/classes`** — instead `revalidatePath` the edit page so the user stays on it (so they can then manage team splits). This changes the current behaviour.
- Each team-split action (`createTeamSplit` / `updateTeamSplit` / `toggleTeamSplitStatus`) is its own server action that `revalidatePath`s the edit page (updates the panel in place — no redirect).
- Accepted trade-off: an **unsaved class-name edit is discarded** if a team-split action fires first (the server re-render resets the name field to the DB value). Fine in practice; admins rarely edit the name and manage splits in the same unsaved moment.

### 6.2 Actions (`src/app/(app)/admin/classes/[id]/_actions.ts` or a `team-split` sub-module)

- `createTeamSplit(classId, code, name)` — **classId comes from the page/URL, not a dropdown.** Validate code format; enforce **unique `(classId, code)`**; parent class must be **Active** (see inactive-class rule below); new rows are `status = 'active'`.
- `updateTeamSplit(teamSplitId, name)` — **Name only.** Code and `classId` immutable (spec §12.3).
- `toggleTeamSplitStatus(teamSplitId)` — **new.** Flips the team split's own `status`. The **confirmation popup** ("Are you sure you want to deactivate/activate this team split from the class?") is a client-side confirm before calling the action. **No Remove/hard-delete** (spec §12.3, §14).

**Inactive class (decided):** on an **inactive** class's edit page, still show the panel and allow **Edit-name** and **Deactivate/Activate** on existing splits, but **disable the "Add Team Split" button** with a hint ("Reactivate the class to add team splits"). This surfaces the `createTeamSplit` active-class requirement gracefully instead of letting it error.

### 6.3 Components
- A `TeamSplitsPanel` (list) + an inline `TeamSplitForm` (Add/Edit, no modal) rendered within the class edit page. The Add/Edit form has **Code + Name only** (no Class field). Mirror the mock's Class-edit Team Splits panel.

### 6.4 Receipt-form dependency
- The receipt Team Split dropdown must offer only team splits that are **own-status Active AND under an Active class** (§7). Update the query that feeds it accordingly.

### 6.5 Team Split edge cases (grill outcomes)

- **Editing a receipt whose team split was deactivated (decided):** the receipt-form loader must **inject the receipt's current team split into the dropdown even if inactive**, labelled "(inactive)" — mirroring the existing inactive dept/class injection in `receipts/[id]/page.tsx` (which today has no team-split injection). **Server counterpart:** in `resolveTeamSplit`, if the submitted `teamSplitId === existing.teamSplitId`, **accept it regardless of status**; otherwise validate membership among **active** splits only. Without this, editing such a receipt errors or silently drops the tag.
- **"Required" now means active:** the receipt-form rule "class has ≥1 team split → required" becomes "class has ≥1 **active** team split → required". The query feeding the dropdown **and** the create/update validation must filter `team_split.status = 'active'` (today they query all splits for the class, because status didn't exist).
- **No code snapshot on the receipt** (unlike Project Code): team-split code is **immutable** and there's **no hard delete**, so the FK stays valid and the code is stable — same as department/class. Only Project Code snapshots, because its source list is externally synced/volatile.
- **Code reuse after deactivation:** `unique(class_id, code)` means a deactivated `team-a` still occupies its code — **reactivate** rather than recreate. A typo'd code can only ever be deactivated (never removed or corrected), lingering as an inactive row. Consistent with classes/departments; accepted.
- **Confirm wording:** the Deactivate/Activate confirm is the plain spec text (no "used by N receipts" count). Usage-count is a future enhancement, not v2.

---

## 7. Feature — Receipt form / table / summary (§ big one)

Files: `src/app/(app)/claims/receipts/[id]/`
`_components/ReceiptForm.tsx`, `_components/ReceiptsTable.tsx`, `_components/ReceiptsSummaryCard.tsx`, `_actions.ts`.

### 7.1 Receipt form (`ReceiptForm.tsx`)
- **Remove** the **Amount** and **Receipt Date** fields.
- Field set becomes: **File, Department, Class, Team Split, Project Code** (spec §5.6.2).
- **Team Split** dropdown: disabled until a Class is chosen; populated with that class's **active** team splits (**active = the team split's own `status` is Active AND the class is Active**); **required when the class has ≥1 active team split, optional when it has none**; **resets when Class changes**. (Mirror `updateTeamSplitOptions()` in the mock.)
- **Project Code** dropdown: **required**, lists all project codes.
- Server needs to pass in: active departments, active classes, **team splits grouped by class** (for the dependent dropdown), and project codes.

### 7.2 Receipt actions (`_actions.ts`)
- `createReceipt` / `updateReceipt`:
  - Update Zod schemas: **drop** `receiptDate`, `amountLocal`; **add** `projectCodeId` (required) and `teamSplitId` (optional).
  - **Remove all FX logic** — delete `getCurrentRate` import/usage, `amountUsd`, `fxRate`, `fxRateFetchedAt`, `currencyCode` writes.
  - **Validate Team Split conditionally:** load the selected class's active team splits (own `status` Active); if any exist, `teamSplitId` is required and must belong to that class **and** be active; if none exist, `teamSplitId` must be empty.
  - **Validate Project Code:** must exist.
  - `requireRole` stays `["admin","finance","credit_card_holder","employee"]` (anyone who can see the claim can add; edit/delete still owner-or-admin — keep that check, it already exists).
- `deleteReceipt` — unchanged except role list (add `credit_card_holder`).

### 7.3 Receipts table (`ReceiptsTable.tsx`)
- **Remove** the Amount column. Columns: **Uploaded (uploaded_at), Department, Class, Team Split, Project Code, File, Uploaded By, Actions** (spec §5.6.1).
- Team Split / Project Code render as chips; **em-dash** when null (legacy or class-without-splits).
- Default sort **Uploaded desc**.

### 7.4 Summary card (`ReceiptsSummaryCard.tsx`)
- Reduce to a **single "Total Receipts" (count)** tile. Remove the MYR/USD tiles (spec §5.5).

---

## 8. Scoping fixes (bring runtime in line with the spec)

### 8.1 Employee → only their own claims
`src/app/(app)/claims/receipts/page.tsx` currently returns **all** claims to everyone. Add a condition:
- If `actor.role === "employee"`: `eq(claim.claimantId, actor.id)`.
- Admin/Finance/CCH: all claims (unchanged).

### 8.2 Receipt visibility within a claim is role-dependent
Admin/Finance/CCH see **all** receipts on a claim they can view; an **Employee sees only receipts they uploaded** (`receipt.uploadedBy = actor.id`). Per spec §5.5.1.
- Collapse the view-mode `DetailViewMode` to two concerns: **can edit claim metadata / see Drive** (admin/finance) vs **not** (cch/employee). *(This flag is only about Drive/edit affordances — it does not decide receipt visibility.)*
- `loadReceipts(claimId, actor)` returns **all** receipts on the claim for Admin/Finance/CCH; for **Employee, filter `and(eq(claimId), eq(receipt.uploadedBy, actor.id))`** — an own-uploaded-only filter. (Because an employee can only upload to a claim they are the claimant of (§7.2), this never hides a receipt they uploaded; it only hides receipts uploaded by *other* users on that claim.)
- Keep **row-level** edit/delete gating (owner, or admin/finance) — that lives in the table/actions, not the query.
- Claim **detail page access:** an Employee may only open a claim where they are the claimant (they can't reach others). CCH/Admin/Finance may open any claim. Enforce in `[id]/page.tsx` (add an ownership check for employees → `notFound()` if not claimant). *(An employee opening their own claim now sees only their own uploaded receipts; a claim where others uploaded shows an empty/short list — intended.)*
- **Also fix the receipt file paths** (stricter, receipt-level model): `[id]/receipts/[receiptId]/view/page.tsx` and `src/app/api/receipts/[receiptId]/file/route.ts` must gate via a **`canViewReceipt(actor, receipt, claim)`** helper: Admin/Finance/CCH → any receipt on a non-deleted, viewable claim; **Employee → only if `receipt.uploadedBy === actor.id`**. This is stricter than the claim-level claimant check so an employee can't open another user's receipt file directly by URL, even on a claim they own. Add `credit_card_holder` to their `requireRole`.

> **Build-breakers to fix at the same time (dropped columns):** `[id]/page.tsx` sums `amountLocal`/`amountUsd` (remove — summary is count-only); `loadReceipts` orders by `receiptDate` → change to `uploadedAt`; the receipt **view page** renders Date/Amount → replace with Uploaded + the new chips; `ReceiptsTable`'s `Receipt` type + Amount column → replace with Team Split / Project Code columns.

### 8.3 "New Claim" button
Route `/claims/receipts/new` already guards with `requireRole(["admin","finance"])` (good). Also **hide the button** on the list + empty state for CCH/Employee (mock uses `isAdminOrFinance`). Pass `isAdminOrFinance` into `ClaimsTable`/empty state and conditionally render.

---

## 9. Statements

Files: `src/app/(app)/claims/statements/*`.

### 9.1 Access
- Remove **Employee** from statements everywhere; add **Credit Card Holder**. `requireRole(["admin","finance","credit_card_holder"])` on statements pages/actions.
- Nav: statements link already gated by `canAccess(role,"/claims/statements")` — the `ACCESS_MAP` change (§2.3) handles hiding it for Employee.

### 9.2 Upload form eligibility (`statements/new/page.tsx`)
Current query requires `claimantId IS NOT NULL` and, for employees, `claimantId = actor.id`. For v2:
- **Drop** the `isNotNull(claim.claimantId)` condition — a claim no longer needs a claimant to receive a statement (spec §6.1, Appendix A #2).
- **Drop** the employee branch (employees can't upload).
- CCH/Finance/Admin see **all** `awaiting_statement`, non-deleted claims.

### 9.3 Statements list scoping (`statements/page.tsx`)
- Admin/Finance: all statements.
- **CCH: only `uploadedBy = actor.id`** (spec §6.2). Add the filter for the CCH role.

### 9.4 Start/Retry verification, Edit, Delete
- Start/Retry/Edit: CCH (own uploads), Finance, Admin. Update role checks in the statement detail/edit actions.
- **Remove the `claim.claimantId === actor.id` clause** from `isVisibleToActor` and `canEdit` (statements `_actions.ts`) — under v2 the claimant is an Employee with **no** statement access. Statement access = Admin/Finance **or the uploader (CCH)**.
- **Statement delete (decided):** the existing `deleteStatement` (Admin/Finance only) **stays as-is** — it is already implemented and working. Only the *new CCH* delete raised in v2 is deferred. **Reconcile the spec:** update §3.1.1 (Statements: Delete → ✅ Admin, ✅ Finance, deferred for CCH) and §6.8 (delete is Admin/Finance only; CCH delete deferred), rather than "omitted".
- **FX note (decided):** with receipt FX removed, the receipt flow no longer calls `src/lib/fx.ts`/`getCurrentRate`. The `fx_rate` table + `fx-scheduler` script are now **unused by the app** — **keep them in place** (do not remove). Just stop calling `getCurrentRate` from the receipt actions.

---

## 10. Dashboard  *(scope reduced — see decision)*

**Reality check:** `src/app/(app)/dashboard/page.tsx` is currently a **"Coming soon" stub** for everyone — the rich dashboards in the mock/spec §4 are **not** built, and were intentionally deferred to "a later phase".

**Decision for v2:** keep the stub for Admin/Finance/CCH (dashboards stay deferred). The **only** dashboard change is:
- **Employee:** `redirect("/claims/receipts")` when `role === "employee"` (spec §4.3).

Building the Admin/Finance and CCH dashboards from the mock is **out of scope** for this v2 pass.

---

## 11. Seeds

- `scripts/seed-admin.ts` — no change needed, but you may add sample **Credit Card Holder** / **Employee** users for local testing.
- Add a seed for **project_code** (since the sync job is out of scope) — **including one explicit "default" row** so a receipt can always be linked even before the sync job runs (decided §13). Match the mock's sample data (`PRJ-100…`).
- Add a few **team_split** rows under existing classes so the class-dependent dropdown is testable (`team-a`, `team-b`, `ops`, …). New rows default `status = 'active'`; seed **at least one `inactive`** to exercise the Deactivate/Activate toggle and the "inactive splits hidden on the receipt form" rule.
- **Leave at least one class with no team splits** so the "Team Split optional" path is exercised.

> The existing `scripts/seed-v2.ts` inserts team splits without a status value — fine once the column defaults to `active`, but add one explicitly-inactive row for coverage.

---

## 12. Test checklist (per role)

For each of **Admin, Finance, Credit Card Holder, Employee**, verify against the mock:

- [ ] Nav shows exactly the menus in spec §3.1 (Employee: no Statements, no Admin; CCH: no Admin; Finance: Admin shows only Project Code/Classes). **No Team Split nav item for anyone.**
- [ ] Dashboard variant correct (Employee redirects to Receipts).
- [ ] Receipts list scoping (Employee sees only own-claimant claims; others see all). Drive column + New Claim button hidden for CCH/Employee.
- [ ] Claim detail: Admin/Finance/CCH see all receipts, **Employee sees only receipts they uploaded** (not other users' receipts on the same claim); Edit/Drive only Admin/Finance; row edit/delete owner-or-admin; Employee can't open a claim they don't own, nor open another user's receipt view/file URL.
- [ ] Receipt form: no Amount/Date; Team Split disabled-until-class + conditional-required + resets on class change; Project Code required.
- [ ] Receipts table columns + count-only summary.
- [ ] Statements: Employee blocked; CCH sees only own uploads; upload lists all awaiting-statement claims (even without claimant); Start/Retry/Edit work for CCH.
- [ ] Project Code page read-only (no add/edit).
- [ ] Team Splits managed **inside the Class edit page**: Add (Code + Name, no class field), Edit (name only), **Deactivate/Activate with a confirm popup**; own status; unique code within class; **no Remove**. Deactivating a split (or its class) removes it from the receipt-form dropdown.
- [ ] Class-name Save **stays on the edit page** (no redirect to list); team-split actions update the panel in place.
- [ ] On an **inactive** class's edit page: Add Team Split is disabled (hint shown); Edit/Toggle still work.
- [ ] **Edit a receipt whose team split was deactivated:** the inactive split is shown "(inactive)" and preserved on save (not dropped/errored).
- [ ] Migration **`0010`** applied (adds `team_split.status`); pre-existing seeded splits are `active`; toggling reflects in the receipt-form dropdown.
- [ ] `pnpm build` + `pnpm lint` clean; migrations apply on a copy of prod data.

---

## 13. Resolved decisions

- **Project Code format:** codes are **uppercase** (e.g. `PRJ-100`) — **no lowercase check** on the `project_code` table (§3.2), unlike `class`/`department`.
- **Legacy receipts (existence):** leave `project_code_id` / `team_split_id` **NULL** for pre-v2 rows (no bulk backfill); columns stay nullable.
- **FX cleanup:** **keep** the `fx_rate` table + `fx-scheduler`; just stop calling `getCurrentRate` from the receipt actions (§9.4).

### 13.1 Design-review (grill) outcomes

1. **Empty Project Code list:** seed initial project codes **including one explicit default row** so receipts can always link; field stays **required** (§5, §11).
2. **Statement delete:** keep the existing **Admin/Finance** delete (already built); only the **CCH** delete is deferred. Reconcile spec §3.1.1 + §6.8 (§9.4).
3. **Editing a legacy receipt:** apply v2 required-field rules on save — user must set Project Code (and Team Split if the class has active splits). Backfills over time (§7.2).
4. **Project Code on receipt:** store **FK + snapshot** of the code string; write both, display prefers live join with snapshot fallback (§3.4).
5. **Dashboard:** keep the "Coming soon" stub for Admin/Finance/CCH; only add the **Employee → Receipts redirect** (§10). Full dashboards remain a later phase.
6. **Employee receipt access:** claimant-of-claim to reach the claim; within it, view/download/edit/delete **only receipts they uploaded** (`receipt.uploadedBy = actor.id`) — **not** other users' receipts on the same claim. Applies to claim detail (`loadReceipts` filter), receipt view page, and file API via `canViewReceipt` (§8.2). *(Updated: earlier this said employees see **all** receipts on their claim — reverted so employees see only their own uploads.)* Accepted consequence: a claim where an employee is claimant but others uploaded the receipts shows an empty/short receipt list.
7. **Team Split relocation (supersedes earlier design):** Team Split is **not** a standalone menu/route — it is managed inside the **Class edit page** (`/admin/classes/[id]/edit`) with a list + Add + Edit-name + **Deactivate/Activate** (confirm popup). Team Splits now have their **own** `status` column (this reverses the earlier "status derived from class, never store" decision — §3.3). No Remove/hard-delete. Effective availability on the receipt form = split Active **and** class Active. **The standalone `/admin/team-split` code already built must be reworked** (§6).

### 13.2 Bugs found in existing code (fold into the sections above)

- `receipts/[id]/page.tsx` sums dropped `amountLocal`/`amountUsd`; `loadReceipts` orders by dropped `receiptDate` → count-only summary + order by `uploadedAt` (§8.2).
- Receipt **view page** + **file API** render dropped columns and gate via `employee_other` → rewrite per §8.2.
- Statement `isVisibleToActor` / `canEdit` include `claim.claimantId === actor.id` → remove (§9.4).
- `uploadStatement`/`updateStatement` require a claimant + have employee-claimant branches → relax claimant, swap Employee→CCH (§9.2).
- Statements list `employeeScope` (uploader OR claimant) → CCH = uploader only (§9.3).
- Many `requireRole([...,"employee"])` in receipts/statements/file-API → add CCH / remove Employee per the function matrix. **Centralise the `Role` type** to avoid missing a spot.
- Class deactivation warning (`getDeactivationContext`) should note that an inactive class's Team Splits become **unselectable on the receipt form** (their own status is unchanged, but the class isn't offered) (minor UX).

---

## 14. Follow-up after build & verification

Once the code is built and the test checklist passes:

1. **Update the older docs.** In `COE_Finance_Claims_Portal_UI_Spec.md` (v1) mark it superseded and point to the v2 spec. In `COE_Finance_Claims_Portal_UI_Spec_v2.md`, correct the "FX machinery **retained** in the data model" wording (§5.6.2, §5.6.4, §14, §8) to say the **receipt-level amount/FX columns were dropped** (only `entity.currency` and the standalone `fx_rate` table remain) — per the decision in this guide.
2. Delete completed TODOs from this guide.

---

## 15. Project Code enhancement (post-v2) — status, activation & Google-Sheet sync

> **Source spec:** [`guidelines/spec/new-impl-projectcode.md`](./new-impl-projectcode.md).
> **What this adds on top of §5:** Project Code stops being a static read-only list. It gains an **active/inactive status**, an **admin Activate/Deactivate** control, an **active-only + searchable** receipt dropdown, and a **public sync API** that reconciles the list from a Google Sheet.
>
> **This section supersedes two earlier statements in this guide:**
> - §3.2 "**No status column** … the sync job that fills it is out of scope" — the `project_code` table now **has** a `status` column, and the sync job is **in scope** (§15.5 below).
> - §5 "list-only … **No Add/Edit/Delete, no `_actions.ts`**" — the admin page now has a `_actions.ts` with a **Deactivate/Activate** toggle (still **no** manual Add/Edit/Delete — the sheet sync owns the list).

> **Progress (2026-07-20):**
> - **Step 1 — DB `status` + admin toggle (§15.1, §15.2): ✅ done.** Migration `0011` applied; admin page shows Status + Activate/Deactivate.
> - **Step 2 — receipt dropdown active-only + search + inactive injection (§15.3): ✅ done.** Searchable combobox live; server validation is status-aware.
> - **Step 3 — Google-Sheet sync API (§15.4, §15.5): ✅ code done, ⚠️ not yet runnable.** `sheets.ts` + `runProjectCodeSync` + `/api/cron/project-code-sync` + CLI built and building clean. **Blocked on ops (§15.4):** (1) **enable the Google Sheets API** in Cloud project `662685061523`, (2) share the sheet with the service account, (3) set `PROJECT_CODE_SHEET_ID` / `PROJECT_CODE_SHEET_TAB` / header env vars in the real `.env`.

### 15.0 Decisions locked (from review, 2026-07-20)

1. **Status storage:** a new `project_code_status` pgEnum (`active` | `inactive`), column `status` `DEFAULT 'active' NOT NULL` — **mirrors `team_split_status`** (§3.3), not a boolean, for house-style consistency.
2. **`created_at` already exists** on `project_code` — the enhancement spec's "created_at" ask is **already satisfied**; no column work for it.
3. **New rows from the sync take `created_at` = the sheet's parsed timestamp** (fallback to `now()` when the cell is blank/unparseable). Existing rows' `created_at` is **never** touched.
4. **Column mapping is by header name** (row 1), header labels **configurable via env**; a missing required header **fails the run loudly** (no silent column drift).
5. **Admin page: status + toggle only.** Status column + per-row Activate/Deactivate (with a client confirm). **No** manual Add/Edit/Delete.
6. **The sync never deactivates or deletes.** It only **inserts** new codes (as `active`) and **renames** existing codes whose name changed. A code that exists in the table but is **absent from the sheet is left untouched** (spec: "project code will not be removed … active/inactive status will remain"). Deactivation is **manual (admin) only**.
7. **Receipt dropdown = active-only**, but an **edit** of a receipt whose linked code is now inactive **injects that code labelled "(inactive)"** and the server accepts it — mirroring the Team Split rule (§6.5).

### 15.1 Database — `status` column + migration `0011`

`drizzle/0010_team_split_status.sql` is the latest migration. Add a **new** follow-up (do **not** edit `0009`, which already created & seeded `project_code` without a status — same rule as team_split §3.1):

`drizzle/0011_project_code_status.sql`
```sql
CREATE TYPE "public"."project_code_status" AS ENUM('active','inactive');--> statement-breakpoint
ALTER TABLE "project_code" ADD COLUMN "status" "project_code_status" DEFAULT 'active' NOT NULL;
```
Existing seeded rows become `active` via the default. Creating the type **and** using it in the same migration is fine — the enum-in-transaction caveat (§2.2) applies only to `ALTER TYPE … ADD VALUE` on an existing enum, not to a brand-new `CREATE TYPE` (this is exactly what `0010` did for team_split).

**Edit `src/db/schema/projectCode.ts`:**
- Add `export const projectCodeStatus = pgEnum("project_code_status", ["active","inactive"]);`
- Add column `status: projectCodeStatus("status").notNull().default("active"),`
- Update the header comment: the list is no longer "maintained by an out-of-scope sync" — the sync now exists (§15.5) and the portal can toggle status.

> **Migration is hand-written, not generated.** `drizzle/meta/` is **gitignored** in this repo, so `pnpm db:generate` has no baseline snapshot to diff against and instead dumps the *entire* schema as a fresh `0000_*` migration. Do **not** commit that. Instead **hand-write** `drizzle/0011_project_code_status.sql` with exactly the two statements above (this is how `0009`/`0010` were actually authored too), then `pnpm db:migrate`. If you do run `db:generate` to sanity-check the SQL, delete the generated dump afterward and, if needed, fix the local `drizzle/meta/_journal.json` tag back to `0011_project_code_status`.

### 15.2 Admin page — Status column + Activate/Deactivate

- `src/app/(app)/admin/project-code/page.tsx` — also select `status`; keep the `?q` `ilike` search and `order by code`. Pass `status` into the table rows.
- `src/app/(app)/admin/project-code/_components/ProjectCodeTable.tsx` — add a **Status** column (Active/Inactive badge) and an **Actions** column with a per-row **Deactivate/Activate** button → client-side `confirm(...)` → calls the new action. Update the info banner ("This list is synced from the master Google Sheet; you can activate/deactivate codes here").
- **New `src/app/(app)/admin/project-code/_actions.ts`** — `toggleProjectCodeStatus(projectCodeId)`, `requireRole(["admin","finance"])`, flip `status`, set `updatedAt`, `revalidatePath("/admin/project-code")`. **Mirror `toggleTeamSplitStatus`** in `admin/classes/[id]/_actions.ts`. No Add/Edit/Delete actions.

### 15.3 Receipt dropdown — active-only + search + inactive injection

Files: `src/app/(app)/claims/receipts/[id]/page.tsx`, `_components/ReceiptForm.tsx`, `_actions.ts`.

- **Active-only query:** `[id]/page.tsx` today loads **all** project codes (`db.query.projectCode.findMany`). Filter to `where eq(projectCode.status, "active")` for the dropdown.
- **Inactive injection on edit** (mirror Team Split §6.5): when the `edit-receipt` action loads a receipt whose linked `projectCode.status = 'inactive'`, **inject that one code** into the options, labelled `… (inactive)`. Server counterpart in `_actions.ts`: in `createReceipt`/`updateReceipt`, if the submitted `projectCodeId === existing.projectCodeId`, **accept it regardless of status**; otherwise require the code to **exist and be active**. (Today it only checks existence — make the check status-aware for *new* selections.)
- **Search (spec requirement):** with **1000+** codes a native `<select>` is unusable. Replace the Project Code `<select>` in `ReceiptForm.tsx` with a **searchable combobox** client component that filters by **code OR name**. Keep the submitted field name **`projectCodeId`** (write it to a hidden input) so the server-action contract and the `projectCode` snapshot write are **unchanged**.
- The `projectCode` **snapshot** column (§3.4) already keeps history stable when the sync renames a code — no change needed there; still write both `projectCodeId` and `projectCode` on create/update.

### 15.4 Environment (`.env.example`)

Reuse the existing **`CRON_SECRET`** (already present). Add:
```
# Project Code sync (reads a master Google Sheet; POST /api/cron/project-code-sync, x-cron-secret)
PROJECT_CODE_SHEET_ID=1XTmPcuGPPiiBbC_71lx7BGnY5xWrYJ-O5gL57Aqtnf8
PROJECT_CODE_SHEET_TAB=<tab/sheet name>          # A1 ranges need the tab NAME, not a gid
PROJECT_CODE_HEADER_CODE=<header text for the code column>
PROJECT_CODE_HEADER_TIMESTAMP=<header text for the timestamp column>
PROJECT_CODE_HEADER_NAME=<header text for the project-name column>
```
> **Ops prerequisites (both required before the sync can run):**
> 1. **Enable the Google Sheets API** in the service account's Cloud project (`662685061523`) — visit `https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=662685061523`. Only the Drive API is enabled today; a sync run currently fails with *"Google Sheets API has not been used in project 662685061523 before or it is disabled"* (verified 2026-07-20).
> 2. **Share the sheet (read) with `GOOGLE_SERVICE_ACCOUNT_EMAIL`** — the service account can't read a sheet it isn't granted on.
>
> The Sheets API addresses ranges by **tab name**, not a gid; store the tab name in `PROJECT_CODE_SHEET_TAB` (or resolve it once via `spreadsheets.get`).

### 15.5 Sync API (public, `x-cron-secret`) — mirrors `verification-submit`

- **New route `src/app/api/cron/project-code-sync/route.ts`** — `POST`, `export const dynamic = "force-dynamic"`, guarded by `isAuthorizedCronRequest(req)` (401 otherwise), delegates to the lib below, returns `{ ok, inserted, renamed, unchanged, ms }`. Copy the shape of `api/cron/verification-submit/route.ts`.
- **New Sheets client `src/lib/sheets.ts`** — `src/lib/drive.ts` is intentionally **Drive-scope only**; keep it that way. Add a small module using `google.sheets({ version: "v4", auth })` with scope **`https://www.googleapis.com/auth/spreadsheets.readonly`** and the same `google.auth.JWT` service-account credentials pattern as `drive.ts`. Expose e.g. `readSheetRows(sheetId, tab): Promise<string[][]>`.
- **New lib `src/lib/projectCodeSync.ts`** — `runProjectCodeSync()` (no `process.exit`; callable from the route **and** an optional CLI, exactly like `verificationJobs.ts`). Algorithm:
  1. **Read the sheet** → rows. Take row 1 as headers; resolve the code/timestamp/name **column indexes by header name** (env, §15.4); **throw if any required header is missing.** Build a temp array of `{ code, timestamp, name }`: `trim()`, **uppercase the code**, skip rows with a blank code, and **dedupe by code** (first occurrence wins; log later duplicates).
  2. **Load all `project_code`** (`id, code, name`) into a `Map` keyed by code.
  3. **Diff:**
     - code **in sheet, not in table** → **INSERT** `{ code, name, status:'active', createdAt: parseTimestamp(row.timestamp) ?? now() }`.
     - code **in both, name differs** → **UPDATE** `name` (+ `updatedAt = now()`). **Do not touch `status` or `createdAt`.**
     - code **in table, not in sheet** → **leave untouched** (never deactivate/delete — decision §15.0.6).
  4. Apply as a batch insert + per-changed-row name updates (1000+ rows is small; a single transaction is fine). Return the counts.
- **Optional CLI** `src/scripts/project-code-sync.ts` + npm script `"project-code-sync": "tsx src/scripts/project-code-sync.ts"` (mirrors `fx-scheduler.ts`) so it can also run from Windows Task Scheduler / Linux cron. Cadence is the external caller's choice (daily is ample — the list changes rarely).

### 15.6 Seeds

`scripts/seed-v2.ts` already inserts project codes without a status → **fine** (defaults to `active`). Optionally seed **one `inactive`** code to exercise the toggle and the "inactive hidden from the receipt dropdown / injected on edit" paths.

### 15.7 Files touched

| File | Action | Purpose |
|------|--------|---------|
| `src/db/schema/projectCode.ts` | Edit | `project_code_status` enum + `status` column. |
| `drizzle/0011_project_code_status.sql` | Generate | `CREATE TYPE` + `ADD COLUMN status`. |
| `src/app/(app)/admin/project-code/page.tsx` | Edit | Select + pass `status`. |
| `src/app/(app)/admin/project-code/_components/ProjectCodeTable.tsx` | Edit | Status column + Activate/Deactivate button + banner. |
| `src/app/(app)/admin/project-code/_actions.ts` | **New** | `toggleProjectCodeStatus` (mirror `toggleTeamSplitStatus`). |
| `src/app/(app)/claims/receipts/[id]/page.tsx` | Edit | Active-only dropdown query + inactive injection on edit. |
| `src/app/(app)/claims/receipts/[id]/_components/ReceiptForm.tsx` | Edit | Searchable combobox (code/name), hidden `projectCodeId`. |
| `src/app/(app)/claims/receipts/[id]/_actions.ts` | Edit | Status-aware project-code validation (accept existing inactive on edit). |
| `src/lib/sheets.ts` | **New** | Read-only Sheets v4 client (service-account JWT). |
| `src/lib/projectCodeSync.ts` | **New** | `runProjectCodeSync()` diff/insert/rename engine. |
| `src/app/api/cron/project-code-sync/route.ts` | **New** | Public POST, `x-cron-secret`, → `runProjectCodeSync`. |
| `src/scripts/project-code-sync.ts` + `package.json` | **New** (optional) | CLI trigger, mirrors `fx-scheduler`. |
| `.env.example` | Edit | Sheet id/tab + header-name keys (§15.4). |
| `scripts/seed-v2.ts` | Edit (optional) | One inactive code for coverage. |

### 15.8 Test checklist

- [ ] Migration `0011` applies; pre-existing seeded codes are `active`.
- [ ] Admin page shows a **Status** column and a working **Activate/Deactivate** toggle (confirm popup); no Add/Edit/Delete.
- [ ] Receipt **add** dropdown lists **only active** codes; typing filters by **code or name**; Project Code still **required**.
- [ ] Receipt **edit** of a receipt whose code went inactive: the code shows `… (inactive)`, and saving **succeeds** (not dropped/errored); picking a *different* inactive code is rejected.
- [ ] Sync API: **401** without `x-cron-secret`; with it, **inserts** new sheet codes as `active` with `created_at` = the sheet timestamp; **renames** codes whose name changed; **leaves** `status`/`created_at` of existing codes; a code missing from the sheet is **not** deactivated; duplicate sheet rows are de-duped; a missing required header **fails loudly**.
- [ ] Deactivating a code in admin removes it from the receipt **add** dropdown on the next load.
- [ ] `pnpm build` + `pnpm lint` clean; migration applies on a copy of prod data.
