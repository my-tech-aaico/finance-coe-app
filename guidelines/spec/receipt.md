# Implementation Spec — Claims > Receipts

**Project:** COE Finance Claims Portal
**Scope:** The `/claims/receipts` page — create, list, edit, and search claim line items, with auto-provisioned Google Drive folders per claim. Receipt files themselves are uploaded *outside* the portal (directly to Drive); the portal only manages claim records and the Drive folder structure.
**Stack:** Next.js App Router · TypeScript · Better Auth · Drizzle ORM · PostgreSQL · Google Drive API via `googleapis`.

This spec assumes the **auth foundation**, **app shell**, **User Management**, and **Entities Management** specs are complete. The patterns here mirror those — Server Actions, the `(app)/...` route group, role-based access via `requireRole`, no hard deletes, full-page inline forms (no modal dialogs per UI spec section 10), `createdBy` / `updatedBy` audit columns.

---

## 1. What Receipts is and isn't

A **claim** is a line item the Finance team opens to track an expense submission for a given month + entity. From the UI spec sections 5 and 7:

- A claim has a **period** (Month + Year), an owning **entity**, a free-text description, and an **optional** claimant.
- The Claim ID is auto-generated using the format **`YYMM-CLM-XXX`** — where `YYMM` is derived from the claim period (NOT from `createdAt`) and `XXX` is a global running sequence number allocated by a Postgres SEQUENCE. The sequence does **not** reset per period — see section 9.
- On submit, the portal automatically provisions a Google Drive folder for the claim with three subfolders (`receipts`, `statements`, `netsuite`).
- Receipt files are uploaded directly in Google Drive — the portal does not handle file uploads for receipts. It only owns the folder structure and surfaces the link.
- Claim status is one of two values: `Awaiting Statement` or `Statement Attached`. (Verification statuses live on the statement record, not the claim — out of scope for this spec.)

**What this spec doesn't cover** (separate workstreams):
- Statement upload, the `Statement Attached` status transition, the one-to-one claim-statement link.
- Verification queue, Opus integration, scheduler jobs.
- NetSuite integration — the `netsuite` subfolder is provisioned now so it's ready when that workstream lands.

**Admin-only delete capability** (added late in the design process): Admin users can soft-delete claims. Soft-deleted claims disappear from the default list view but remain in the database (recoverable). The Drive folder is left untouched. If a statement is attached to the claim, the statement is cascade-soft-deleted alongside the claim, and restoration is symmetric. See sections 6.2, 11.3, and 13 for details. Finance users cannot delete.

---

## 2. Prerequisites

### 2.1 Google Cloud Console (one-time, by an Admin)

A **service account** is the technical actor that creates Drive folders and grants permissions. Setup:

1. In the Google Cloud Console for the project's GCP account, enable the **Google Drive API**.
2. Create a **service account** — give it a descriptive name like `coe-finance-claims-drive`.
3. Generate a **JSON key** for the service account; capture the `client_email` and `private_key` fields.
4. Decide where the parent Drive folder lives:
   - **Recommended: Shared Drive.** Create a Shared Drive owned by the Finance team. The service account is added as a Manager. Folders inside are owned by the Shared Drive, not by individuals → no quota or single-owner risk.
   - **Alternative: My Drive folder shared with the service account.** Simpler but the service account effectively "owns" what it creates, which limits quota and creates a single point of failure if the account is rotated.
5. Note the **parent folder ID** (the part after `/folders/` in the Drive URL).
6. Share the parent folder with the service account email, giving it **Content manager** (Shared Drive) or **Editor** (My Drive) permissions.

### 2.2 Environment variables

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=coe-finance-claims-drive@<project>.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
GOOGLE_DRIVE_PARENT_FOLDER_ID=1aBcDeFgHiJkLmNoPqRsTuVwXyZ
AUTHORIZED_USERS=finance-lead@growthops.asia,finance-ops@growthops.asia,gurbhinder.singh@growthops.asia
```

Notes:
- **`GOOGLE_PRIVATE_KEY`** must preserve literal `\n` escapes when stored in `.env` files; the loader needs to convert them to real newlines (`process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n')`).
- **`AUTHORIZED_USERS`** is a comma-separated list of company Google Workspace emails. These users get **Editor** permissions on every claim folder created (parent + three subfolders). They're the people who need direct Drive-web access for day-to-day work — typically Finance + Admins.
- The list is **static** — it lives in env, not in the database. See section 13.1 for the rationale and the limitation.
- The claimant (assigned via the Claim form) does **not** automatically get folder permissions added through the portal. The folder link is shared with them out-of-band (Slack, email, etc.) by Finance.

### 2.3 npm packages

Add to the project:

```
googleapis
```

The package is the official Google API Node.js client. We use only the Drive v3 endpoints.

---

## 3. Data model

### 3.1 New table: `claim`

**File:** `src/db/schema/claim.ts`

| Column                    | Type                                                          | Notes                                                                                              |
|---------------------------|---------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| `id`                      | `text` (uuid), primary key                                    | Internal identifier. Will be the foreign key from `statement` when that workstream lands.            |
| `sequenceNumber`          | `bigint`, unique, not null, `default nextval('claim_seq')`    | Global running number allocated by the Postgres sequence `claim_seq`. Belongs to the claim for life — does **not** change when Month/Year is edited. Two claims can never share a sequence number. **Stored as `bigint`** (8-byte signed integer, max ~9.2 quintillion) so the column can comfortably outlive the company; an `integer` would cap at ~2.1 billion which is enough but tight to future-proof against. |
| `displayId`               | `text`, unique, not null                                      | Human-readable claim ID: `YYMM-CLM-XXX` (e.g. `2605-CLM-001`). Computed at insert/update time from `claimMonth + claimYear + sequenceNumber` (see section 9). Used as the Drive parent folder name. Both unique because the underlying sequence is unique. |
| `claimMonth`              | `smallint`, not null                                          | 1–12. Combined with `claimYear` to form the `YYMM` prefix.                                          |
| `claimYear`               | `smallint`, not null                                          | 4-digit year (e.g. 2026).                                                                          |
| `entityId`                | `text`, FK → `entity.id`, not null                            | The owning legal entity. Sourced from the Entities admin page.                                      |
| `description`             | `text`, not null                                              | Free-text description.                                                                              |
| `claimantId`              | `text`, FK → `user.id`, nullable                              | The assigned claimant. Nullable — Finance can leave Unassigned at creation and assign later.        |
| `status`                  | enum `('awaiting_statement','statement_attached')`, default `'awaiting_statement'` | Set automatically. Flips to `statement_attached` when the Statements workstream links a statement. |
| `driveFolderId`           | `text`, not null                                              | The parent Drive folder ID (the `YYMM-CLM-XXX` folder).                                             |
| `driveReceiptsFolderId`   | `text`, not null                                              | The `/receipts` subfolder ID. The "Drive Link" button opens this folder directly (see section 6.1). |
| `driveStatementsFolderId` | `text`, not null                                              | The `/statements` subfolder ID. Consumed by the Statements workstream.                              |
| `driveNetsuiteFolderId`   | `text`, not null                                              | The `/netsuite` subfolder ID. Consumed by the NetSuite integration when that workstream lands.       |
| `driveReceiptsUrl`        | `text`, not null                                              | The full `https://drive.google.com/drive/folders/...` URL for the receipts subfolder. Stored to avoid re-querying Drive on every page render. |
| `createdBy`               | `text`, FK → `user.id`, not null                              | The Finance/Admin user who created the claim.                                                       |
| `createdAt`               | `timestamp`, default `now()`                                  |                                                                                                     |
| `updatedBy`               | `text`, FK → `user.id`, nullable                              | The last user to edit (description or claimant). Null until first edit.                              |
| `updatedAt`               | `timestamp`, default `now()`                                  | Updated alongside `updatedBy`.                                                                       |
| `deletedAt`               | `timestamp`, nullable                                          | Set when the claim is soft-deleted by an Admin. Null on active claims. The list page filters out non-null by default; Admin can toggle "Show deleted" to surface them. See section 6.2 and 11.3. |
| `deletedBy`               | `text`, FK → `user.id`, nullable                              | The Admin who soft-deleted the claim. Null on active claims. Set/cleared in lockstep with `deletedAt`. |

**Sequence:**
- `CREATE SEQUENCE claim_seq AS bigint START 1 INCREMENT 1` — owned by the `claim` table, used as the default for `sequenceNumber`. Atomic and concurrency-safe by virtue of being a Postgres sequence; no application-level locking required. The `bigint` declaration on the sequence matches the column type and allows the sequence to issue values up to ~9.2 quintillion, far beyond any realistic claim volume.

**Indexes:**
- Unique on `sequenceNumber` (DB constraint).
- Unique on `displayId` (DB constraint — defensive safety net; can't actually be violated as long as `sequenceNumber` is unique).
- Plain on `entityId` (for entity-filtered queries).
- Plain on `status` (for status filter on the list page).
- Plain on `(createdAt DESC)` (the default sort order for the list page).
- Partial index on `deletedAt WHERE deletedAt IS NULL` (the default list query filters by `deletedAt IS NULL`; a partial index keeps the index small and the query fast).

**CHECK constraints:**
- `CHECK (claimMonth BETWEEN 1 AND 12)` — defensive.
- `CHECK (claimYear BETWEEN 2020 AND 2100)` — arbitrary but reasonable bounds.

### 3.2 Why store the Drive IDs *and* the URL

Three options were considered:

1. **Store only the parent folder ID, query Drive on every render.** Too slow — a list of 20 claims would mean 20 Drive API calls per page load. Rejected.
2. **Store the parent folder ID, construct subfolder URLs at render time.** Doesn't work — Drive folder URLs include the *subfolder's* ID, not the parent's. You'd still need to know each subfolder's ID.
3. **Store all four folder IDs + the receipts URL.** What we do. The IDs are referenced by future workstreams (Statements writes to `driveStatementsFolderId`, NetSuite writes to `driveNetsuiteFolderId`). The URL is a denormalization for fast rendering.

The `driveReceiptsUrl` is the only URL stored because it's the only one surfaced in the receipts list table. Statements and NetSuite workstreams construct their URLs the same way when they need them.

### 3.3 Migration plan

1. Implement `entity` (Entities spec) first — `claim.entityId` references it.
2. `drizzle-kit generate` from the new `claim` schema. The generated migration should include `CREATE SEQUENCE claim_seq AS bigint START 1 INCREMENT 1` before the `CREATE TABLE claim` statement (Drizzle's `pgSequence` helper handles this declaratively; verify the output before applying — specifically that the sequence is declared as `bigint` and that `sequenceNumber` is a `bigint` column referencing it).
3. `drizzle-kit migrate`.
4. No seed — claims are created by Finance through the UI.

---

## 4. Routes and files

| File                                                                  | Purpose                                                       |
|-----------------------------------------------------------------------|---------------------------------------------------------------|
| `src/db/schema/claim.ts`                                              | Drizzle table definition + CHECK constraints                  |
| `src/lib/drive.ts`                                                    | Google Drive integration helper (see section 10)              |
| `src/lib/claim-id.ts`                                                 | `YYMM-CLM-XXX` generator with retry-on-collision (section 9)  |
| `src/app/(app)/claims/receipts/page.tsx`                              | List page with filters from URL search params                  |
| `src/app/(app)/claims/receipts/new/page.tsx`                          | Inline Create Claim form                                       |
| `src/app/(app)/claims/receipts/[id]/edit/page.tsx`                    | Inline Edit Claim form                                         |
| `src/app/(app)/claims/receipts/_actions.ts`                           | Server Actions: create / update                                |
| `src/app/(app)/claims/receipts/_components/ClaimsTable.tsx`           | Client wrapper for search/filter UI + sortable columns         |
| `src/app/(app)/claims/receipts/_components/ClaimFormFields.tsx`       | Shared form fields between Create and Edit (DRY)                |
| `src/app/(app)/claims/receipts/_components/StatusBadge.tsx`           | Awaiting Statement / Statement Attached badge                  |
| `src/app/(app)/claims/receipts/_components/DriveLinkButton.tsx`       | Opens `driveReceiptsUrl` in a new tab                          |

---

## 5. Access control — defense in depth

Three layers, matching the User Management and Entities patterns:

1. **Middleware** (already in place from the auth plan): redirects unauthenticated requests.
2. **Page**: `await requireRole(['admin', 'finance'])` at the top of each page. Employees redirect to `/dashboard`. (Employees only access Statements, not Receipts — UI spec section 3.1 truth table.)
3. **Server Actions**: every action also calls `requireRole(...)` server-side. Most actions accept Admin and Finance; **delete and restore are `requireRole(['admin'])` — admin-only**.

The sidebar hides the Receipts link entirely for Employees. The trash icon and "Show deleted" toggle are hidden from Finance — they only render when the current user's role is `admin`.

---

## 6. List page (`/claims/receipts`)

Server component. Filters and pagination come from URL search params:

- `?q=text` — case-insensitive match against `displayId`, `description`, or claimant name
- `?status=awaiting_statement|statement_attached`
- `?claimant=unassigned` (only filter value supported per UI spec section 7.4 — "All Claimants" is default)
- `?from=YYYY-MM-DD&to=YYYY-MM-DD` — date range on `createdAt`, capped to a 12-month span (the server clamps `to` if the span exceeds 12 months)
- `?sort=col&dir=asc|desc` — sortable on all data columns (default: `createdAt desc`)
- `?page=N` — pagination, 20 rows per page
- `?showDeleted=true` — **admin-only**. When absent or false, the query adds `WHERE deletedAt IS NULL`. When true (and the current user is Admin), deleted claims are included in the result set with visual distinction (see section 6.4). Finance users requesting this param are treated as if it were false — defense in depth.

### 6.1 Default visibility rule

By default, all queries against the `claim` table — list, search, edit-form data loads — filter out soft-deleted rows (`WHERE deletedAt IS NULL`). The only places that intentionally include deleted rows are: (a) the list page when an Admin has toggled "Show deleted," (b) the Admin's restore action, and (c) Server Actions on a specific deleted claim ID for restoration purposes. Statements/Verification workstreams should observe the same rule.

### 6.2 Columns (per UI spec section 7.2 + new admin actions)

| Column            | Source / format                                                                                              |
|-------------------|--------------------------------------------------------------------------------------------------------------|
| Claim ID          | `displayId`, rendered as a brand-colored chip. On a deleted row: chip text is struck-through.                |
| Description       | `description`, truncated to ~60 chars in the cell with full text on hover                                    |
| Period            | `claimMonth` + `claimYear` formatted as "May 2026"                                                            |
| Entity            | Joined from `entity` table — chip with the entity's current `code` (renames are retroactively visible)        |
| Claimant          | Joined from `user` table on `claimantId`. Displays "Unassigned" (grey badge) when null.                      |
| Status            | Badge: green "Awaiting Statement" / blue "Statement Attached" (matching the mock). On a deleted row: greyed.  |
| Created Date      | Formatted `createdAt`                                                                                         |
| Google Drive Link | Icon button (Drive icon). Opens `driveReceiptsUrl` in a new tab via `target="_blank" rel="noopener"`. Visible on deleted rows too — Admin may still need to inspect the folder. |
| Edit              | Pencil icon — navigates to `/claims/receipts/[id]/edit`. **Not rendered on deleted rows.**                    |
| Delete            | **Admin only.** Trash icon — opens a confirm dialog (section 11.3) and calls `deleteClaim` Server Action. Not rendered on deleted rows. Not rendered for Finance users. |
| Restore           | **Admin only.** Renders only on deleted rows (i.e., when "Show deleted" is on). Calls `restoreClaim` Server Action. |
| View Statement    | Conditional — only renders when status is `statement_attached`. Navigates to the linked statement (out of scope for this spec; the column placeholder is wired now so the Statements workstream can attach behavior). |

### 6.3 Visual treatment of deleted rows

When "Show deleted" is on, deleted rows appear inline with the active rows in the same table. They are visually distinct so Admin can scan and identify them quickly:

- **Row background:** light grey tint.
- **Claim ID chip:** strikethrough on the text.
- **Status badge:** desaturated colors (greyed).
- **Inline metadata strip:** small text under the row showing "Deleted on 2026-05-14 by Sarah Chen" (resolved from `deletedAt` + `deletedBy` join).
- **Actions:** Edit and Delete are hidden; Restore + Drive Link remain.

### 6.4 The "Show deleted" toggle

- Rendered only when the current user's role is `admin`. Finance and others never see it.
- Lives in the filter bar alongside the existing Status/Claimant/Date filters.
- Default off; flipping it adds `?showDeleted=true` to the URL.
- Server-side: when this param is true AND the user is Admin, the query drops the `deletedAt IS NULL` predicate. For any other combination, the predicate stays (Finance can't bypass even by URL manipulation — section 5 layer 3 catches it).

### 6.5 Empty state

When no claims exist, show the empty state from the mock: Drive icon, *"No claims yet"*, subtext *"Create your first claim to generate a receipt folder and start the verification process,"* and a primary "Create First Claim" button that navigates to `/claims/receipts/new`.

### 6.6 Server-side query

```ts
// src/app/(app)/claims/receipts/page.tsx
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, entity, user } from "@/db/schema";
import { and, eq, or, ilike, gte, lte, desc, asc, sql, isNull } from "drizzle-orm";
import { ClaimsTable } from "./_components/ClaimsTable";

const PAGE_SIZE = 20;

type Search = {
  q?: string; status?: string; claimant?: string;
  from?: string; to?: string;
  sort?: string; dir?: "asc" | "desc";
  page?: string;
  showDeleted?: string;
};

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRole(["admin", "finance"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));

  // Clamp the date range to a 12-month maximum (UI spec section 7.4).
  const { from, to } = clampDateRange(sp.from, sp.to);

  // Defense in depth: only Admin can see deleted claims, even if Finance crafts the URL.
  const includeDeleted = actor.role === "admin" && sp.showDeleted === "true";

  const conditions = [
    // Default: hide soft-deleted rows. Admin can override via the toggle.
    includeDeleted ? undefined : isNull(claim.deletedAt),
    sp.q ? or(
      ilike(claim.displayId, `%${sp.q}%`),
      ilike(claim.description, `%${sp.q}%`),
      // claimant name match handled via a sub-select; see implementation notes
    ) : undefined,
    sp.status ? eq(claim.status, sp.status as any) : undefined,
    sp.claimant === "unassigned" ? sql`${claim.claimantId} IS NULL` : undefined,
    from ? gte(claim.createdAt, from) : undefined,
    to ? lte(claim.createdAt, to) : undefined,
  ].filter(Boolean);

  const orderBy = resolveSort(sp.sort, sp.dir);   // defaults to createdAt desc

  const rows = await db.query.claim.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    with: { entity: true, claimant: true, createdByUser: true, updatedByUser: true, deletedByUser: true },
  });

  const total = await db.select({ count: sql<number>`count(*)::int` }).from(claim)
    .where(conditions.length ? and(...conditions) : undefined);

  return (
    <ClaimsTable
      rows={rows}
      total={total[0].count}
      page={page}
      filters={sp}
      isAdmin={actor.role === "admin"}
      showDeleted={includeDeleted}
    />
  );
}
```

The claimant-name search is implemented as a sub-select against `user.name` joined to `claim.claimantId`. Implementation detail; the spec leaves the exact SQL to the developer but the search must cover claimant name per UI spec section 7.4.

---

## 7. Create Claim form (inline, full-page)

**Route:** `/claims/receipts/new`
**Pattern:** Per UI spec section 10, **no modal**. This is a full-page inline form with a "← Back to Claims" link in the header.

### 7.1 Fields (per UI spec section 7.1)

| Field        | Type                                | Required | Notes                                                                                                  |
|--------------|-------------------------------------|----------|--------------------------------------------------------------------------------------------------------|
| Claim Month  | Dropdown (Jan–Dec)                  | Yes      | Determines the `MM` half of `YYMM`.                                                                    |
| Claim Year   | Dropdown (year list)                | Yes      | Suggest range `currentYear - 1` through `currentYear + 1`. Default to current year.                     |
| Entity       | Dropdown                            | Yes      | Sourced from `entity` WHERE `status = 'active'`, ordered by code. Shows entity code + name.             |
| Description  | Text input                          | Yes      | Default placeholder: "Claim for the month of..."                                                       |
| Claimant     | Dropdown (active users, all roles)  | No       | Default option: "Leave unassigned for now." Finance assigns later (UI spec section 7.5).                |

**Submit button:** "Create Claim" — disabled until all required fields are populated.

### 7.2 Submission flow

1. Client validates required fields are filled.
2. Client calls `createClaim` Server Action (section 11.1).
3. Server runs validation, generates Claim ID, creates Drive folders, inserts DB row in that order (see section 11.1 for the rationale of the ordering).
4. On success: redirect to `/claims/receipts` with the new claim visible at the top of the list (default sort is `createdAt desc`).
5. On failure: stay on the form, show the error message at the top, leave fields populated so the user can adjust and retry.

### 7.3 Loading state during submission

The Drive folder creation involves four sequential API calls (parent + three subfolders) plus N permission grants. Worst-case latency is 2–4 seconds. The submit button must show a spinner and disable during the call, and the form should make clear that "Creating claim and provisioning Drive folder…" is in progress so users don't double-click.

---

## 8. Edit Claim form (inline, full-page)

**Route:** `/claims/receipts/[id]/edit`

The form uses the **same component** as Create (`ClaimFormFields`) with two differences from the Create flow:

### 8.1 Field mutability

| Field        | Editable? | Notes                                                                                                  |
|--------------|-----------|--------------------------------------------------------------------------------------------------------|
| Claim Month  | **Yes**, with confirm | Editing triggers a re-derivation of the Claim ID and a rename of the Drive folder.            |
| Claim Year   | **Yes**, with confirm | Same as Month — any change to Month or Year triggers the re-derivation flow.                   |
| Entity       | **Yes**, with confirm | Single column update — no cascade, no Drive rename. The confirm dialog covers the audit consequence (historical reports run before this change will still show the old entity). |
| Description  | Yes       | Free-text. No confirm needed.                                                                          |
| Claimant     | Yes       | Free assignment. No confirm needed.                                                                    |

**Dropdown behavior for inactive references** (entity or claimant deactivated after this claim was created):

- The Entity dropdown shows the **current** entity at the top labeled `apd-my (inactive)` even if it's no longer active, followed by all active entities. The user can keep the current selection (no change persists to the DB) or pick an active entity to switch.
- The Claimant dropdown follows the same pattern — the currently-assigned claimant shows as `Jane Lim (inactive)` even if deactivated, plus the list of active users below.
- This preserves historical accuracy (claims can legitimately stay attributed to a now-retired entity) while making the inactive status visible. Same UX pattern applies symmetrically to both fields.

### 8.2 The re-derivation flow

When the user changes Month and/or Year and clicks Save:

1. The server computes the **new** displayId using `formatDisplayId(newMonth, newYear, existing.sequenceNumber)`. The claim's existing sequence number is preserved — only the YYMM prefix changes. (Example: `2601-CLM-003` → change to February 2026 → `2602-CLM-003`. The sequence stays at 3 because that number belongs to this specific claim.)
2. A confirm dialog appears summarizing the impact:

   > *"This claim will be renumbered from **2601-CLM-003** to **2602-CLM-003**, and its Drive folder will be renamed. Receipt and statement files inside the folder are preserved. Anyone who has the previous Claim ID in emails or chat will see it no longer matches — let claimants know if needed. Continue?"*

3. On confirm, the server runs the update (section 11.2): rename Drive folder → update DB row.
4. On cancel, the user returns to the form with their changes intact (modal closes, form remains).

The displayId can never collide with another claim's displayId because the sequence number is globally unique — no other claim in February (or any other month) shares this sequence.

### 8.3 Info banner

The edit form shows an info banner at the top:

> *"Changing the Claim Month or Year will renumber this claim and rename its Drive folder. Changing the Entity updates the claim's attribution but doesn't affect the Drive folder. Description and Claimant can be edited freely."*

### 8.4 Confirm dialog logic

A single confirm dialog appears on Save if any of Month, Year, or Entity changed. Description and Claimant changes alone don't trigger a confirm. The dialog lists each significant change with its impact:

- **Period change:** *"This claim will be renumbered from `2601-CLM-003` to `2602-CLM-003`, and its Drive folder will be renamed."*
- **Entity change:** *"The entity will change from `apd-my` to `apd-sg`. Existing receipts and the Drive folder are preserved — only the entity association changes. Historical reports run before this change will still show `apd-my`."*

If both Period and Entity changed in the same save, both lines appear together in the dialog. Confirm proceeds with one server roundtrip that applies all changes.

### 8.5 Submission

On success: redirect back to `/claims/receipts`. The row reflects the new Claim ID immediately (revalidated). The Drive Link button continues to work — it points at the receipts subfolder by its stable Drive ID, which doesn't change on rename.

---

## 9. Claim ID generation (`YYMM-CLM-XXX`)

### 9.1 The format

- `YY` — last two digits of `claimYear`. (Example: 2026 → `26`.)
- `MM` — `claimMonth` zero-padded. (Example: 5 → `05`.)
- `CLM` — literal.
- `XXX` — the claim's `sequenceNumber`, zero-padded to a minimum of 3 digits. The sequence is **global**, allocated by the Postgres `claim_seq` sequence at insert time. It does **not** reset per period.

Worked examples (assuming a fresh database):
- First-ever claim, period = January 2026 → `2601-CLM-001`
- Second claim, period = January 2026 → `2601-CLM-002`
- Third claim, period = February 2026 → `2602-CLM-003` (not `2602-CLM-001` — sequence does not reset)
- Edit the claim with sequence 1 to be in February 2026 → its displayId becomes `2602-CLM-001`. The sequence number stays at 1; only the YYMM prefix changes.

### 9.1.1 Capacity and format growth

Beyond 999 claims, the format auto-extends past 3 digits. The sequence column (`bigint`) and the Postgres sequence both support values up to ~9.2 quintillion (2^63 − 1), so the format is effectively uncapped for any realistic operational horizon. JavaScript's `Number.MAX_SAFE_INTEGER` is 2^53 ≈ 9 quadrillion, which is also vastly larger than any volume the portal will ever see — regular `Number` arithmetic stays safe throughout; no `BigInt` handling is needed in application code.

Format examples at scale:

| Sequence  | displayId             | Notes                                                            |
|-----------|-----------------------|------------------------------------------------------------------|
| 1         | `2605-CLM-001`        | Minimum padding of 3 digits.                                      |
| 999       | `2605-CLM-999`        | Last 3-digit ID.                                                  |
| 1,000     | `2605-CLM-1000`       | Format extends to 4 digits.                                       |
| 10,000    | `2605-CLM-10000`      | 5 digits.                                                         |
| 1,000,000 | `2605-CLM-1000000`    | 7 digits. Still readable, still unique.                           |
| 1,000,000,000 | `2605-CLM-1000000000` | 10 digits. Storage and JS arithmetic both still safe. |

**One operational note:** with mixed-length sequence parts in the same Drive folder listing, the Drive web UI uses natural sort (treats embedded numbers as numbers) so `999` correctly appears before `1000`. Pure lexicographic sort (e.g., a `SELECT ... ORDER BY displayId` query) does not — `2605-CLM-1000` would lexicographically sort before `2605-CLM-999`. Any SQL that needs an ordered listing should `ORDER BY sequenceNumber` (integer comparison) rather than `displayId` (string comparison).

### 9.2 The generator

```ts
// src/lib/claim-id.ts
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Formats a claim's display ID from its period and sequence number.
 * Pure function — no I/O. Use this anywhere we need to compute or recompute
 * a displayId (e.g., after a period edit).
 */
export function formatDisplayId(month: number, year: number, sequence: number): string {
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, "0");
  const xxx = String(sequence).padStart(3, "0");
  return `${yy}${mm}-CLM-${xxx}`;
}

/**
 * Reserves the next value from the global claim sequence. Atomic — two
 * concurrent calls always get distinct numbers. Use during claim creation
 * to get the sequenceNumber that will be persisted on the new row.
 */
export async function reserveNextSequence(): Promise<number> {
  const result = await db.execute(sql`SELECT nextval('claim_seq')::int AS seq`);
  // Drizzle returns rows differently per driver; adjust the access pattern
  // (e.g., result.rows[0].seq or result[0].seq) to match the project's setup.
  return Number((result as any).rows?.[0]?.seq ?? (result as any)[0]?.seq);
}
```

Alternative implementation (not chosen but worth noting): make `displayId` a Postgres `GENERATED ALWAYS AS` column that computes itself from `claimMonth + claimYear + sequenceNumber`. This would mean the displayId updates automatically on any UPDATE to those three columns, removing the need to explicitly set `displayId` in `updateClaim`. Rejected because Drizzle's support for generated columns varies by version, and the explicit set is easy to read in the Server Action. If the project pins to a Drizzle version with solid `generatedAlwaysAs` support, this is a small refactor worth considering.

### 9.3 No race conditions

The Postgres sequence is atomic — concurrent transactions calling `nextval('claim_seq')` always get distinct values, with no application-level locking required. As a result:

- **Create flow:** no retry loop needed. `reserveNextSequence()` returns a unique number; `formatDisplayId` builds the unique displayId from it; the DB insert can never collide.
- **Edit flow:** no retry loop needed. The existing claim already owns its sequence number; recomputing the displayId for a new period preserves that sequence and therefore can never clash with another claim's displayId.

This is the main payoff of moving to a DB sequence: the create and update paths simplify substantially compared to a `SELECT MAX + retry` approach.

---

## 10. Google Drive integration

### 10.1 The drive client module

**File:** `src/lib/drive.ts`

A single module wraps `googleapis`, exposing the four operations the rest of the codebase needs. The Server Action never touches `googleapis` directly — it calls into this module.

```ts
// src/lib/drive.ts
import { google, drive_v3 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

function getDriveClient(): drive_v3.Drive {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
  return google.drive({ version: "v3", auth });
}

async function createFolder(drive: drive_v3.Drive, name: string, parentId: string): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!res.data.id) throw new Error(`Drive folder "${name}" was created but no ID returned.`);
  return res.data.id;
}

async function grantEditorPermission(drive: drive_v3.Drive, fileId: string, email: string): Promise<void> {
  // Note: the Drive API role string "writer" maps differently depending on the
  // parent's location:
  //   - On a Shared Drive (recommended setup, decision 1): writer = Contributor.
  //     Can upload, edit, and share files. CANNOT move or delete them.
  //   - On My Drive: writer = Editor. Can upload, edit, share, AND delete.
  // We standardize on "writer" because it's the least-privilege role available
  // in both setups. On Shared Drive (the recommended path) it gives us the
  // deletion-free permission we want for AUTHORIZED_USERS. On My Drive there
  // is no less-privileged write role available.
  await drive.permissions.create({
    fileId,
    requestBody: { type: "user", role: "writer", emailAddress: email },
    sendNotificationEmail: false,
    supportsAllDrives: true,
  });
}

/**
 * Renames an existing folder. Used when a claim's Month/Year is edited
 * and its displayId changes — see section 11.2.
 */
export async function renameFolder(folderId: string, newName: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId: folderId,
    requestBody: { name: newName },
    supportsAllDrives: true,
  });
}

function getFolderWebUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export type ClaimFolderHandles = {
  parentId: string;
  receiptsId: string;
  statementsId: string;
  netsuiteId: string;
  receiptsUrl: string;
};

/**
 * Creates the four folders for a claim and grants editor permission to
 * everyone in AUTHORIZED_USERS on the parent (Drive inherits permissions
 * to subfolders automatically — single grant covers all four).
 *
 * On any failure, attempts to delete the parent folder so partial state
 * doesn't accumulate. Cleanup is best-effort — if it fails the orphan
 * is logged for manual handling.
 */
export async function createClaimFolders(displayId: string): Promise<ClaimFolderHandles> {
  const drive = getDriveClient();
  const root = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID!;
  const authorizedUsers = (process.env.AUTHORIZED_USERS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  let parentId: string | null = null;
  try {
    parentId = await createFolder(drive, displayId, root);
    const [receiptsId, statementsId, netsuiteId] = await Promise.all([
      createFolder(drive, "receipts", parentId),
      createFolder(drive, "statements", parentId),
      createFolder(drive, "netsuite", parentId),
    ]);

    // Inherited permissions — grant on the parent only.
    await Promise.all(authorizedUsers.map((email) =>
      grantEditorPermission(drive, parentId!, email).catch((err) => {
        // Don't fail the whole claim creation if one permission grant fails —
        // log and continue. Authorized user can be added manually later.
        console.warn(`Failed to grant Drive access to ${email}:`, err);
      })
    ));

    return {
      parentId,
      receiptsId,
      statementsId,
      netsuiteId,
      receiptsUrl: getFolderWebUrl(receiptsId),
    };
  } catch (err) {
    if (parentId) {
      try {
        await drive.files.delete({ fileId: parentId, supportsAllDrives: true });
      } catch (cleanupErr) {
        console.error(`Orphan Drive folder ${parentId} for claim ${displayId} — manual cleanup needed.`, cleanupErr);
      }
    }
    throw err;
  }
}
```

### 10.2 Folder creation flow

For a new claim with `displayId = 2605-CLM-001`:

1. Create folder `2605-CLM-001` inside `GOOGLE_DRIVE_PARENT_FOLDER_ID`. Capture its ID.
2. In parallel: create `receipts`, `statements`, `netsuite` inside the parent. Capture their IDs.
3. In parallel: grant `writer` (Editor) permission to each `AUTHORIZED_USERS` email **on the parent folder only**. Drive's default permission inheritance means subfolders inherit access automatically.
4. Return the four IDs and the receipts URL to the caller.

The whole flow takes 4 sequential creates + N parallel permission grants. With AUTHORIZED_USERS of 3 people, that's 5 Drive API calls. Typical end-to-end latency is 1.5–3 seconds.

**Resulting Drive layout** for a claim with month=January, year=2026, sequence=003 → `displayId = 2601-CLM-003`:

```
<GOOGLE_DRIVE_PARENT_FOLDER_ID>/
  2601-CLM-003/                  ← parent (driveFolderId)
    receipts/                    ← driveReceiptsFolderId (Drive Link button opens here)
    statements/                  ← driveStatementsFolderId (consumed by Statements workstream)
    netsuite/                    ← driveNetsuiteFolderId (consumed by NetSuite workstream)
```

The parent folder name is **always** the full claim displayId, including the `YYMM` prefix and the `CLM` literal. There is no separate `<YYMM>` prefix outside the displayId — `YYMM` is part of the displayId itself.

### 10.3 Why grant permission only on the parent

Drive folders inherit permissions from their parent by default. Granting on the parent is one API call per user; granting on all four folders would be four calls per user, with no UX benefit. The exception: if Finance needs to scope a user to *just* the receipts subfolder (e.g., to give a contractor receipts-only access without seeing statements), they'd do that manually via the Drive web UI, granting a more restrictive permission that overrides the inherited one.

### 10.4 The receipts URL

`driveReceiptsUrl` is `https://drive.google.com/drive/folders/{receiptsId}`. When the user clicks the Drive Link button in the claims table, the button opens this URL in a new tab via `target="_blank" rel="noopener"`. The user lands directly inside the `receipts` subfolder, ready to drag-and-drop files.

---

## 11. Server Actions

### 11.1 createClaim

The ordering — reserve sequence → create Drive folders → insert DB row — is deliberate:

- **Sequence reservation** is atomic via Postgres and cheap. Once obtained, the sequence number belongs to this claim regardless of whether we ever commit a row for it (worst case: a hole in the sequence numbers, which is harmless).
- **Drive creation** is expensive and creates real-world side effects. We do it before the DB write so that if it fails, we have no DB row to clean up.
- **DB insert** comes last. With the sequence already reserved, the insert can't fail due to displayId uniqueness; the only realistic failure modes are DB connectivity or constraint violations on other columns.

```ts
// src/app/(app)/claims/receipts/_actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, entity, user } from "@/db/schema";
import { formatDisplayId, reserveNextSequence } from "@/lib/claim-id";
import { createClaimFolders } from "@/lib/drive";

const CreateInput = z.object({
  claimMonth: z.coerce.number().int().min(1).max(12),
  claimYear: z.coerce.number().int().min(2020).max(2100),
  entityId: z.string().min(1, "Entity is required."),
  description: z.string().trim().min(1, "Description is required.").max(1000),
  claimantId: z.string().optional().transform((v) => v && v.length ? v : null),
});

export async function createClaim(_prev: unknown, formData: FormData) {
  const actor = await requireRole(["admin", "finance"]);
  const parsed = CreateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };
  const data = parsed.data;

  // Sanity: confirm the entity exists and is active.
  const ent = await db.query.entity.findFirst({ where: eq(entity.id, data.entityId) });
  if (!ent) return { error: "Entity not found." };
  if (ent.status !== "active") return { error: "Entity is inactive — pick another." };

  // Sanity: if a claimant was selected, confirm they exist and are active.
  if (data.claimantId) {
    const claimant = await db.query.user.findFirst({ where: eq(user.id, data.claimantId) });
    if (!claimant) return { error: "Claimant not found." };
    if (claimant.status !== "active") return { error: "Claimant is inactive — pick another." };
  }

  // Reserve the sequence number. Atomic — no collision possible.
  const sequenceNumber = await reserveNextSequence();
  const displayId = formatDisplayId(data.claimMonth, data.claimYear, sequenceNumber);

  // Create Drive folders before the DB row. If Drive fails, the sequence number
  // we reserved becomes a harmless gap.
  let folders;
  try {
    folders = await createClaimFolders(displayId);
  } catch (err) {
    return { error: "Could not provision Google Drive folders. Please try again." };
  }

  try {
    await db.insert(claim).values({
      sequenceNumber,
      displayId,
      claimMonth: data.claimMonth,
      claimYear: data.claimYear,
      entityId: data.entityId,
      description: data.description,
      claimantId: data.claimantId,
      status: "awaiting_statement",
      driveFolderId: folders.parentId,
      driveReceiptsFolderId: folders.receiptsId,
      driveStatementsFolderId: folders.statementsId,
      driveNetsuiteFolderId: folders.netsuiteId,
      driveReceiptsUrl: folders.receiptsUrl,
      createdBy: actor.id,
    });
    revalidatePath("/claims/receipts");
    redirect("/claims/receipts");
  } catch (err) {
    // DB insert failed after Drive creation — leaves an orphan folder.
    console.error(`Orphan Drive folder ${folders.parentId} for claim ${displayId} — DB insert failed.`, err);
    return { error: "Database error while creating claim. Drive folders were created and need manual cleanup." };
  }
}
```

### 11.2 updateClaim

The update flow has two paths. Description, Claimant, and Entity changes that don't touch the period are cheap (single DB write). Month or Year changes are expensive — they require recomputing the displayId from the **existing** sequence number (preserved) and the new period, renaming the Drive parent folder, and updating the DB row, with rollback on failure.

Crucially, **no retry loop is needed on the period-change path**, because the claim already owns its sequence number. The new displayId is `formatDisplayId(newMonth, newYear, existing.sequenceNumber)` and that string can never collide with another claim's displayId — no other claim has the same sequence number.

```ts
const UpdateInput = z.object({
  claimId: z.string(),
  claimMonth: z.coerce.number().int().min(1).max(12),
  claimYear: z.coerce.number().int().min(2020).max(2100),
  entityId: z.string().min(1, "Entity is required."),
  description: z.string().trim().min(1).max(1000),
  claimantId: z.string().optional().transform((v) => v && v.length ? v : null),
});

export async function updateClaim(_prev: unknown, formData: FormData) {
  const actor = await requireRole(["admin", "finance"]);
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };
  const data = parsed.data;

  const existing = await db.query.claim.findFirst({ where: eq(claim.id, data.claimId) });
  if (!existing) return { error: "Claim not found." };

  // Entity validation: must exist. Status must be active UNLESS it's the same
  // entity already on the claim (preserves the inactive-current-value rule from
  // section 8.1 — user is keeping the existing assignment, not picking a new
  // inactive entity).
  const ent = await db.query.entity.findFirst({ where: eq(entity.id, data.entityId) });
  if (!ent) return { error: "Entity not found." };
  if (ent.status !== "active" && ent.id !== existing.entityId) {
    return { error: "Selected entity is inactive — pick an active one." };
  }

  // Claimant validation: same rule. Active, or unchanged-from-current.
  if (data.claimantId) {
    const claimant = await db.query.user.findFirst({ where: eq(user.id, data.claimantId) });
    if (!claimant) return { error: "Claimant not found." };
    if (claimant.status !== "active" && claimant.id !== existing.claimantId) {
      return { error: "Selected claimant is inactive — pick an active one." };
    }
  }

  const periodChanged =
    data.claimMonth !== existing.claimMonth ||
    data.claimYear  !== existing.claimYear;

  // --- Cheap path: no period change. Update editable fields (including entity). ---
  if (!periodChanged) {
    await db.update(claim).set({
      entityId: data.entityId,
      description: data.description,
      claimantId: data.claimantId,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(eq(claim.id, data.claimId));

    revalidatePath("/claims/receipts");
    redirect("/claims/receipts");
  }

  // --- Period changed: regenerate displayId from the existing sequenceNumber. ---
  const newDisplayId = formatDisplayId(data.claimMonth, data.claimYear, existing.sequenceNumber);

  // Rename Drive folder first.
  try {
    await renameFolder(existing.driveFolderId, newDisplayId);
  } catch (err) {
    console.error(`Drive folder rename failed for claim ${existing.displayId} → ${newDisplayId}.`, err);
    return { error: "Could not rename Google Drive folder. Claim not updated. Please try again." };
  }

  // Then update DB — entity, description, claimant all updated in the same write.
  try {
    await db.update(claim).set({
      displayId: newDisplayId,
      claimMonth: data.claimMonth,
      claimYear: data.claimYear,
      entityId: data.entityId,
      description: data.description,
      claimantId: data.claimantId,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(eq(claim.id, data.claimId));

    revalidatePath("/claims/receipts");
    redirect("/claims/receipts");
  } catch (err) {
    // DB update failed after Drive rename. Try to rename Drive back to the original.
    console.error(`DB update failed for claim ${existing.displayId} → ${newDisplayId}. Attempting Drive rollback.`, err);
    try {
      await renameFolder(existing.driveFolderId, existing.displayId);
    } catch (rollbackErr) {
      console.error(`Drive rollback also failed. Folder is now named "${newDisplayId}" but DB still shows "${existing.displayId}" — manual reconciliation needed.`, rollbackErr);
    }
    return { error: "Database error while updating claim. Please try again." };
  }
}
```

### 11.2.1 Why rename Drive first, then update DB

Same logic as create: the expensive irreversible-ish operation goes first. If Drive rename fails, we abort without touching the DB — clean state. If DB update fails after Drive rename, we attempt to rename the Drive folder back. The double-failure case (Drive rename succeeds, DB update fails, Drive rollback also fails) is logged loudly for manual reconciliation. It should be vanishingly rare.

### 11.2.2 What does NOT change on a period edit

- The Drive folder's **ID** (only its name changes). All four IDs in the `claim` row stay the same — only `displayId` updates.
- The `driveReceiptsUrl` stored in the DB stays valid because it's keyed off the receipts folder's ID, which is unchanged.
- Anything inside the folders (receipt files, future statement files) is preserved.
- The claim's `createdAt` — historical truth about when the row was inserted.

### 11.2.3 What DOES change

- `displayId`
- `claimMonth`, `claimYear`
- The Drive parent folder's display name (visible in the Drive web UI)
- `updatedAt`, `updatedBy`

### 11.3 deleteClaim (Admin only)

Soft delete. Sets `deletedAt = now()` and `deletedBy = actor.id`. Does NOT touch the Drive folder. Cascade-soft-deletes the linked statement (when the Statements workstream exists).

```ts
const DeleteInput = z.object({ claimId: z.string() });

export async function deleteClaim(_prev: unknown, formData: FormData) {
  const actor = await requireRole(["admin"]);   // admin only
  const { claimId } = DeleteInput.parse(Object.fromEntries(formData));

  const existing = await db.query.claim.findFirst({ where: eq(claim.id, claimId) });
  if (!existing) return { error: "Claim not found." };
  if (existing.deletedAt) return { error: "Claim is already deleted." };

  const deletedAt = new Date();

  // Single transaction: cascade-soft-delete the linked statement (if any),
  // then soft-delete the claim. The statement-side update is a TODO until
  // the Statements workstream lands — the column reference will not exist
  // yet. The transaction shape and the matching `deletedAt` timestamp are
  // what the Statements spec will inherit.
  await db.transaction(async (tx) => {
    // TODO (Statements workstream): cascade-soft-delete the linked statement.
    // await tx.update(statement)
    //   .set({ deletedAt, deletedBy: actor.id })
    //   .where(and(eq(statement.claimId, claimId), isNull(statement.deletedAt)));

    await tx.update(claim).set({
      deletedAt,
      deletedBy: actor.id,
      // Note: we deliberately do NOT bump updatedAt/updatedBy. Delete is its
      // own lifecycle event, separate from regular edits. The audit trail is
      // (createdBy/createdAt) → (updatedBy/updatedAt — most recent edit) →
      // (deletedBy/deletedAt — terminal). Keeping them separate keeps the
      // story readable.
    }).where(eq(claim.id, claimId));
  });

  revalidatePath("/claims/receipts");
  return { ok: true };
}
```

### 11.4 restoreClaim (Admin only)

Symmetric undo. Clears `deletedAt` and `deletedBy` on the claim and on any statement that was cascade-deleted at the same instant.

```ts
export async function restoreClaim(_prev: unknown, formData: FormData) {
  const actor = await requireRole(["admin"]);   // admin only
  const { claimId } = DeleteInput.parse(Object.fromEntries(formData));

  const existing = await db.query.claim.findFirst({ where: eq(claim.id, claimId) });
  if (!existing) return { error: "Claim not found." };
  if (!existing.deletedAt) return { error: "Claim is not deleted." };

  await db.transaction(async (tx) => {
    // TODO (Statements workstream): restore the linked statement that was
    // cascade-deleted with this claim. Match by deletedAt timestamp equality
    // to avoid resurrecting statements that were deleted independently.
    // await tx.update(statement)
    //   .set({ deletedAt: null, deletedBy: null })
    //   .where(and(
    //     eq(statement.claimId, claimId),
    //     eq(statement.deletedAt, existing.deletedAt),
    //   ));

    await tx.update(claim).set({
      deletedAt: null,
      deletedBy: null,
    }).where(eq(claim.id, claimId));
  });

  revalidatePath("/claims/receipts");
  return { ok: true };
}
```

### 11.5 The delete confirm dialog (UI side)

When Admin clicks the trash icon on a row, the client component opens a confirm dialog with copy that depends on the claim's status:

- **If `status = awaiting_statement`** (no statement linked):
  > *"Delete claim `2605-CLM-003`? It will be hidden from the list. You can restore it later from the 'Show deleted' view. The Drive folder is unaffected."*
- **If `status = statement_attached`**:
  > *"Delete claim `2605-CLM-003`? **The linked statement will also be soft-deleted.** Both can be restored together later from the 'Show deleted' view. The Drive folder is unaffected."*

Confirm proceeds via `deleteClaim` Server Action. Cancel closes the dialog with no action.

The Restore flow uses a simpler confirm:

> *"Restore claim `2605-CLM-003`? It will reappear in the active list, along with any statement that was cascade-deleted with it."*

### 11.6 No hard delete

There is no hard-delete Server Action in this spec. The DB row and Drive folder persist even after soft-delete, allowing recovery. If business requires permanent destruction (e.g., GDPR-style purge), that's a separate workstream that would walk the soft-deleted rows older than X days, hard-delete them, and remove the Drive folders. Out of scope here.

---

## 12. Validation summary

| Field          | Rule                                                                                                |
|----------------|-----------------------------------------------------------------------------------------------------|
| Claim Month    | Required. Integer 1–12. DB CHECK constraint enforces.                                                |
| Claim Year     | Required. Integer 2020–2100. DB CHECK constraint enforces.                                            |
| Entity         | Required. Must reference an existing `entity`. Must be `status = 'active'` on create. On edit, the *current* (already-assigned) entity is accepted even if inactive — but switching to a *different* inactive entity is rejected. |
| Description    | Required. Trimmed. 1–1000 chars.                                                                     |
| Claimant       | Optional. If provided, must reference an existing `user`. Must be active on create. On edit, the *current* claimant is accepted even if inactive — but switching to a *different* inactive user is rejected. Any role. |
| sequenceNumber | Auto-allocated server-side from the `claim_seq` Postgres sequence. Unique. Never accepted from the form. Belongs to the claim for life — preserved across period edits. |
| displayId      | Auto-computed server-side from `formatDisplayId(claimMonth, claimYear, sequenceNumber)`. Unique. Never accepted from the form. Recomputed on period edit. |
| Drive IDs/URL  | Auto-generated server-side from the Drive API. Never accepted from the form.                         |
| createdBy      | Auto-set from the session. Never accepted from the form.                                              |
| updatedBy      | Auto-set on every edit. Never accepted from the form.                                                 |
| deletedAt      | Set by `deleteClaim` (admin-only). Cleared by `restoreClaim`. Never accepted from the form.            |
| deletedBy      | Set by `deleteClaim` (admin-only) from the session. Cleared by `restoreClaim`. Never accepted from the form. |

---

## 13. Business rules / invariants

1. **Claim ID is the unique human-readable identifier**, formed from claim period (not `createdAt`) and a global sequence number. The sequence is allocated from a Postgres SEQUENCE (`claim_seq`) and is **global** — it does not reset per period.
2. **Claim Month, Year, and Entity are editable after creation, each with a confirm dialog.** Month/Year edits cascade to a Drive folder rename and a displayId regeneration. Entity edits are a single column update — no Drive operation. The confirm dialog covers the audit consequence: historical reports run before the edit will not match the new entity attribution.
3. **Sequence number is preserved on period edit.** A claim with `sequenceNumber = 3` keeps that number for its entire lifetime. If its period changes from January to February, the displayId moves from `2601-CLM-003` to `2602-CLM-003`. The sequence is a property of the claim, not the period.
4. **Only active entities and active claimants can be selected for *new* claims**, and for *changes* on edit. The exception is the unchanged-current-value rule (rules 4a and 4b below).

   - **4a. Inactive current entity is preserved on edit.** If a claim's currently-assigned entity has been deactivated, the Edit form's Entity dropdown shows it labeled `(inactive)` along with the active entities. The user can keep the current selection (no change persists) or pick an active one. The server validates accordingly — a submitted entityId matching `existing.entityId` is accepted regardless of the entity's status.
   - **4b. Inactive current claimant is preserved on edit.** Same rule, applied to Claimant.

5. **Claimant is optional at creation.** Finance commonly creates a claim before knowing who the responsible person is — they collect receipts in the Drive folder first, then assign the claimant.
6. **Claim status is system-managed**, not user-editable. It flips from `awaiting_statement` to `statement_attached` when the Statements workstream links a statement, and (potentially) back if a statement is unlinked. The Receipts UI never exposes a status control.
7. **Drive folders are created up-front for all three intended uses** (receipts, statements, netsuite) at claim creation, even though only receipts is consumed today. This keeps the folder structure deterministic and avoids "Statements workstream now needs to retro-create folders for existing claims."
8. **Renaming a Drive folder does not change its ID.** When Month/Year edit triggers a folder rename, the folder's stable Drive ID (and therefore `driveReceiptsUrl`, the receipts/statements/netsuite subfolder IDs, and any file references) all remain valid. Only the displayed folder name changes.
9. **`createdBy` and `updatedBy` are session-derived**, never from the form. Same pattern as User Management and Entities.
10. **Drive permission grants are best-effort.** If granting access to one of the `AUTHORIZED_USERS` fails, the claim is still created and a warning is logged. The user can be added manually via the Drive UI later. (Rationale: a transient Drive API failure shouldn't block claim creation.)
11. **AUTHORIZED_USERS get `writer` role on the parent folder.** On the **Shared Drive** parent recommended in decision 1, this maps to **Contributor** — can upload, edit, and share files but cannot delete or move them. If the team chooses My Drive instead, `writer` maps to Editor (which CAN delete) and the deletion-risk surface increases. See section 10.1 for the clarifying comment.
12. **One Drive folder per Claim ID at any given time.** When a claim is renumbered (e.g., `2601-CLM-003` → `2602-CLM-003`), the *same* Drive folder is renamed in place. We don't keep both names alive simultaneously. Historical references to the old Claim ID are stale; the confirm dialog warns Finance to communicate the rename if needed.
13. **Edit access is open across Admin and Finance roles.** Any Admin or Finance user can edit any claim. Trust + audit (`updatedBy`/`updatedAt`) is the accountability model, not row-level access control. Suitable for a small Finance team; revisit if the team grows or formal separation of duties is required.
14. **Concurrent edits use last-write-wins** with no optimistic locking. If two users edit the same claim simultaneously, the later save silently overwrites the earlier one — the audit columns capture the most recent actor but not the lost intermediate change. Explicit team decision (not a default oversight); revisit if the team grows and collisions become observable.
15. **Admin can soft-delete claims; Finance cannot.** The trash icon and the "Show deleted" toggle are admin-only at every layer (UI hiding, page-level role check, Server Action role check). A soft-deleted claim is hidden from the default list view but remains in the database.
16. **Soft delete does NOT touch the Drive folder.** The folder and all its contents remain intact in Drive. Recovery via `restoreClaim` is a pure DB operation — no Drive API call. Storage cleanup of Drive folders for long-deleted claims is a separate (out-of-scope) operational task.
17. **Cascade soft-delete to linked statement.** When a claim with `status = statement_attached` is deleted, the linked statement is also soft-deleted in the same transaction. The two records share the same `deletedAt` timestamp, which is how `restoreClaim` finds them to restore together (matching by exact timestamp avoids resurrecting statements that were deleted independently). Implementation of the statement-side cascade lands with the Statements workstream; this spec defines the contract.
18. **Restoration is symmetric and admin-only.** `restoreClaim` clears `deletedAt`/`deletedBy` on both the claim and its cascaded statement (if any). The claim reappears in the active list immediately.
19. **`deletedAt` / `deletedBy` do not bump `updatedAt` / `updatedBy`.** The audit trail keeps three distinct stages: creation, last edit, and deletion. Mixing the deletion event into the edit columns would lose information.
20. **Default query rule:** every query against the `claim` table filters by `deletedAt IS NULL` unless explicitly opted out. This applies to the list page, the edit form load, all joins from future Statements/Verification workstreams, and any reports. The partial index on `deletedAt` (section 3.1) keeps these queries fast.

### 13.1 The AUTHORIZED_USERS limitation

The env-var approach is **static**. A new Finance hire added through User Management won't automatically get access to existing Drive folders — only to folders created *after* their email is added to the env var.

For the launch scope this is acceptable because (a) the AUTHORIZED_USERS list is small and changes rarely, and (b) Drive's web UI lets an existing AUTHORIZED_USER share access to specific folders ad hoc. If this limitation becomes painful, the future enhancement is to source the email list from `user` WHERE `role IN ('admin', 'finance') AND status = 'active'` dynamically at folder-creation time. That change is local to `src/lib/drive.ts` and doesn't ripple through the rest of the system.

---

## 14. Error handling

### 14.1 Drive API failures during folder creation

`createClaimFolders` wraps the four-folder flow in a try/catch. On any failure mid-flow:
- If the parent folder was already created, attempt to delete it (best-effort cleanup; subfolders cascade-delete).
- Re-throw the error to the Server Action.
- The Server Action returns a user-facing error: *"Could not provision Google Drive folders. Please try again."*
- No DB row is inserted.

The cleanup might itself fail (network blip, transient Drive error). In that case the orphan is logged for manual sweeping. No automated retry — orphans are rare enough that periodic manual review is fine for the scope.

### 14.2 DB insert failures after Drive folders are created

Rarer than the Drive-side failures, since uniqueness can no longer collide (the sequence handles that). Realistic causes are DB connectivity blips or constraint violations on other columns. The Server Action:

- Returns an error to the user.
- Logs an `Orphan Drive folder {id} for claim {displayId}` message at error level so a Finance admin can clean up the unused Drive folder.
- Does **not** retry — the sequence number has already been consumed and re-issuing the insert won't help.

### 14.3 Sequence collisions

With the Postgres `claim_seq` sequence as the source of truth, sequence collisions are **impossible by construction**. Concurrent `nextval('claim_seq')` calls always return distinct values, and the unique constraint on `sequenceNumber` is a defensive safety net that should never fire in practice. No retry logic is needed in either `createClaim` or `updateClaim` for this reason.

### 14.4 Drive rename failures during edit

When a user edits Month or Year and Save is clicked:

- **Drive rename fails** (network blip, transient Drive 5xx, etc.): The Server Action returns an error to the user. DB row is untouched. No state divergence — the next Save attempt will re-run the same flow.
- **DB update fails after Drive rename** (rare — would be a connectivity issue, since uniqueness is no longer a failure mode): The Server Action attempts to rename the Drive folder *back* to its original name. If rollback succeeds: clean state, the user retries. If rollback also fails: a loud error is logged with both the old and new folder names; the Drive folder is now misnamed relative to the DB. A Finance admin can manually rename it back via the Drive web UI using the log message.
- **Double failure** (rare but possible): Drive rename succeeds, DB write fails, Drive rollback also fails. Logged as `manual reconciliation needed` with all relevant IDs. This is the only failure mode that requires human intervention; everything else self-heals on retry.

### 14.5 Orphaned Drive folders

Two situations produce orphans:
1. **Cleanup failure after a Drive API error** — parent folder exists, no DB row.
2. **DB insert failure after Drive creation** — parent folder exists, no DB row.

Mitigation:
- Both cases log a clear `Orphan Drive folder {id} for claim {displayId}` message at error level.
- Periodic manual review: a Finance admin can list folders under `GOOGLE_DRIVE_PARENT_FOLDER_ID` and cross-reference against the `claim` table to find orphans.
- (Future) a cleanup script that does the comparison automatically and offers to delete orphans older than 24 hours.

---

## 15. Integration with Entities (contract recap)

The Entities spec (section 13) committed to:
- `entity.id` is the foreign key surface; `entity.code` is for display.
- The Entity dropdown sources from `entity` WHERE `status = 'active'` ORDER BY `code ASC`.

This spec consumes that contract:
- `claim.entityId text NOT NULL REFERENCES entity(id)`.
- The create form filters the dropdown to active entities.
- The list table joins to `entity` and displays the **current** entity code on every row.

**Consequence of editable entity codes** (Entities spec decision): when an entity is renamed (e.g. `apd-my` → `apdmy`), every existing claim row shows the new code on the next page render. The Claim ID (`2605-CLM-001`) and Drive folder name are unaffected because they don't embed the entity code. The Drive folder *contents* are unaffected.

---

## 16. Forward-looking dependencies

The following workstreams will read or write to claim records and Drive folders provisioned by this spec:

| Workstream      | What it consumes                                                            | What it writes                                                                |
|-----------------|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| **Statements**  | `driveStatementsFolderId` to upload the statement file; `claim.id` as FK target for the new `statement` table. Statement queries must filter by `deletedAt IS NULL` to respect the claim spec's default visibility rule (business rule 20). | `claim.status` flips from `awaiting_statement` to `statement_attached` when a statement is linked. The `statement` table needs its own `deletedAt`/`deletedBy` columns so that `deleteClaim` / `restoreClaim` can cascade (sections 11.3 and 11.4 — currently `TODO` markers; the Statements spec inherits this contract). |
| **Verification queue** | `claim.id` indirectly via the statement record. Verification queries must filter by `deletedAt IS NULL` on both claim and statement to avoid acting on soft-deleted records. | A `verification_queue` row referencing the statement. Does not modify the claim. |
| **NetSuite integration** | `driveNetsuiteFolderId` to drop NetSuite-related artifacts. | TBD; out of scope here. |

The fact that all three Drive subfolders are provisioned up-front means none of these workstreams need to retro-create folders for existing claims.

---

## 17. Testing checklist

Manual end-to-end:

1. ✅ Finance user opens `/claims/receipts` on a fresh deploy → sees the empty state with "Create First Claim" CTA.
2. ❌ Employee user navigates to `/claims/receipts` → redirected to `/dashboard`.
3. ❌ Employee → does not see Receipts link in the sidebar (UI spec section 3.1).
4. ✅ Finance clicks "Create First Claim" → navigates to inline form at `/claims/receipts/new` (NOT a modal).
5. ✅ Fills in Month=May, Year=2026, Entity=apd-my, Description, leaves Claimant unassigned → submits → claim appears in list with `displayId = 2605-CLM-001` (the very first claim on a fresh DB), status `Awaiting Statement`, Claimant "Unassigned".
6. ✅ Verifies the Drive folder structure in Google Drive: `2605-CLM-001/` exists with `receipts/`, `statements/`, `netsuite/` subfolders.
7. ✅ Each `AUTHORIZED_USERS` email is listed as Editor on the parent folder in Drive's web UI.
8. ✅ Click the Drive Link button on the row → opens a new tab directly inside `2605-CLM-001/receipts/`.
9. ✅ Creates a second claim for May 2026 → `displayId = 2605-CLM-002`. Sequence increments.
10. ✅ Creates a claim for June 2026 → `displayId = 2606-CLM-003`. Sequence does **not** reset for the new period — it continues from where it left off (global running number).
11. ✅ Edit a claim → form pre-fills with current values. **Month, Year, and Entity are all editable**; only `displayId` is read-only.
12. ✅ Changes Description only and assigns a Claimant → saves → table reflects the change, `updatedBy` updates, Claim ID unchanged, Drive folder name unchanged. No confirm dialog (low-impact change).
13. ✅ Changes Month from May to February (same year) on `2605-CLM-001` → confirm dialog appears showing the period-change line (`2605-CLM-001 → 2602-CLM-001`) → confirms → table shows new `displayId = 2602-CLM-001`, Drive parent folder renamed.
14. ✅ Same edit as test 13: verifies the Drive folder's **ID** is unchanged (Drive Link button still works and points at the same `receipts/` subfolder, files inside are untouched).
15. ✅ Changes Entity from `apd-my` to `apd-sg` only → confirm dialog appears showing the entity-change line → confirms → table reflects new entity chip. No Drive folder rename (entity isn't in the folder name).
16. ✅ Changes both Period (May→Feb) AND Entity (`apd-my`→`apd-sg`) in the same edit → single confirm dialog lists both changes → confirms → both changes apply in one Server Action call.
17. ✅ Confirm dialog cancelled → form remains open with the user's pending change visible, no Drive or DB writes happen.
18. ✅ Period edit where target period equals source (user toggles month and back to the same value) → server detects no change and skips the Drive call.
19. ✅ Entity is deactivated AFTER a claim references it. Finance opens the claim's Edit form → Entity dropdown shows `apd-my (inactive)` at the top, plus the active entities below. User saves without changing entity → claim's entity stays as `apd-my`, no error.
20. ❌ Same scenario as 19, but user switches to a *different* inactive entity → server rejects with "Selected entity is inactive — pick an active one."
21. ✅ Claimant deactivated after assignment → same dropdown pattern (`Jane Lim (inactive)` shown at top), same server validation: keeping current is OK, switching to a different inactive user is rejected.
22. ❌ Tries to create a claim with an inactive Entity selected → server-side validation rejects (the dropdown shouldn't offer it, but a direct form post should still be blocked).
23. ❌ Tries to create a claim with an inactive user as Claimant → server-side validation rejects.
24. ✅ Searches "2605" → only May 2026 claims show.
25. ✅ Filter by status = "Awaiting Statement" → shows only those.
26. ✅ Filter by claimant = "Unassigned" → shows only claims without a claimant.
27. ✅ Sets a date range From=2026-05-01 To=2027-05-01 (12+ months) → the server clamps "To" to 2027-04-30 and displays a small notice.
28. ✅ Sorts by Period descending → newest periods first.
29. ✅ Pagination: with 25 claims, page 1 shows 20, page 2 shows 5.
30. ❌ Simulated Drive API failure on create (mock `createClaimFolders`) → user sees error message; no claim row in DB; the reserved sequence number becomes a harmless gap.
31. ❌ Simulated DB insert failure after Drive creation → orphan log message present; user sees error message.
32. ❌ Simulated Drive rename failure during a period edit → DB row unchanged, user sees error message, no state divergence.
33. ❌ Simulated DB update failure after a successful Drive rename → server attempts rename-back, then surfaces error. Verify the Drive folder name was restored.
34. ⚠️ **Concurrent edit scenario (informational, not failed):** two users edit the same claim. User A saves a description change. User B saves a claimant change 30 seconds later (without refreshing). B's save silently overwrites A's description back to the pre-edit value. `updatedBy` shows User B. This is the documented last-write-wins behavior (business rule 14).

Delete and restore (admin-only):

35. ✅ Admin sees the trash icon on each active row. Finance does not — the column or icon is hidden in the rendered table.
36. ✅ Admin sees the "Show deleted" toggle in the filter bar. Finance does not.
37. ✅ Admin clicks trash on a claim with `status = awaiting_statement` → confirm dialog appears with the no-statement copy → confirms → row disappears from the default list; `deletedAt` and `deletedBy` are set in DB; Drive folder still exists and is still browsable from the Drive web UI.
38. ✅ Admin clicks trash on a claim with `status = statement_attached` → confirm dialog appears with the cascade copy mentioning the statement → confirms → both claim and statement are soft-deleted with the same `deletedAt` timestamp (once Statements ships).
39. ✅ Admin toggles "Show deleted" → table re-renders to include deleted rows, visually distinct (grey background, strikethrough on Claim ID, greyed status badge, "Deleted on … by …" metadata strip).
40. ✅ Admin clicks Restore on a deleted row → row returns to the active list immediately; `deletedAt` and `deletedBy` are NULL in DB; linked statement (if any) is also restored with the same matching timestamp.
41. ❌ Finance tries to call `deleteClaim` directly via a crafted POST → Server Action rejects with `requireRole(['admin'])` error.
42. ❌ Finance tries to call `restoreClaim` directly via a crafted POST → same rejection.
43. ❌ Finance crafts URL `?showDeleted=true` → server treats it as false (defense in depth, section 6.6); deleted claims are not included in the response.
44. ❌ Admin calls `deleteClaim` on a claim that's already deleted → returns error: *"Claim is already deleted."*
45. ❌ Admin calls `restoreClaim` on a claim that's not deleted → returns error: *"Claim is not deleted."*
46. ✅ Default query for any other operation (edit form load, future Statements join) excludes deleted claims — verifying business rule 20.
47. ✅ Drive Link button on a deleted row (visible only when "Show deleted" is on) still opens the receipts folder in Drive — recovery scenarios may require this.

Unit / integration:

- `formatDisplayId(5, 2026, 1)` returns `"2605-CLM-001"`; `formatDisplayId(2, 2026, 1)` returns `"2602-CLM-001"` (sequence preserved across periods); `formatDisplayId(5, 2026, 1234)` returns `"2605-CLM-1234"` (auto-extends beyond 3 digits).
- `reserveNextSequence`: two concurrent calls return distinct values (integration test against a real DB).
- `createClaim` Server Action: full happy path; non-admin/non-finance caller throws; inactive entity rejected; inactive claimant rejected; sequence is allocated before Drive creation; Drive failure leaves no DB row.
- `updateClaim` no-period-change path: description, claimant, and entity update via single DB write; inactive entity rejected unless it matches `existing.entityId`; inactive claimant rejected unless it matches `existing.claimantId`.
- `updateClaim` period-change path: new displayId uses `existing.sequenceNumber` (verified by inspecting the persisted row); Drive folder is renamed; entity change applies in the same DB write as the displayId update; rollback on DB failure triggers a rename-back.
- `updateClaim` no-op corner case: when Month/Year are submitted unchanged, the period-change path is skipped (no Drive call).
- `deleteClaim`: non-admin caller throws; already-deleted claim returns error; happy path sets `deletedAt` + `deletedBy`, does NOT modify Drive (verify by mocking the Drive client and asserting no calls).
- `restoreClaim`: non-admin caller throws; not-deleted claim returns error; happy path clears `deletedAt` + `deletedBy`.
- List page query: default request includes `deletedAt IS NULL` predicate; admin + `showDeleted=true` drops it; finance + `showDeleted=true` keeps it (defense in depth).
- `createClaimFolders`: mock the Drive API; verify four `files.create` calls, N `permissions.create` calls; verify cleanup is triggered on failure.
- `renameFolder`: mock the Drive API; verify `files.update` is called with the correct fileId and new name.
- `getDriveClient`: verifies `GOOGLE_PRIVATE_KEY` newline conversion works.

---

## 18. Decisions

### 18.1 Locked (resolved during design grill)

| # | Decision                          | Value                                                                                                            |
|---|-----------------------------------|------------------------------------------------------------------------------------------------------------------|
| 1 | Per-period vs global sequence     | Global, via Postgres `claim_seq` SEQUENCE. Preserved across period edits (sections 3.1 and 9).                    |
| 2 | Month/Year editability            | Editable with confirm dialog. Triggers displayId regeneration + Drive folder rename (sections 8 and 11.2).        |
| 3 | Entity editability                | Editable with confirm dialog. Single-column update, no Drive operation. Confirm wording covers audit consequence. |
| 4 | Inactive current entity/claimant on edit | Preserve in dropdown with `(inactive)` label; user can keep current or pick an active one. Server validates accordingly. |
| 5 | AUTHORIZED_USERS Drive role       | `writer` (Contributor on Shared Drive; no folder deletion). Clarifying comment in `src/lib/drive.ts`.              |
| 6 | Edit access scope                 | Open across Admin and Finance — any can edit any claim. Audit columns provide accountability.                     |
| 7 | Concurrent-edit protection        | Last-write-wins, no optimistic locking. Explicitly accepted for the team size; revisit at scale.                  |
| 8 | Delete semantics                  | Soft delete via `deletedAt` / `deletedBy` columns. Admin-only. Recoverable via Restore.                            |
| 9 | Drive folder fate on delete       | Untouched. Soft delete is a pure DB operation; no Drive API call.                                                  |
| 10 | UI surfacing for delete           | Trash icon (admin-only) in row actions; "Show deleted" toggle (admin-only) in filter bar; single list page.        |
| 11 | Cascade behavior with statements  | When a claim with `status = statement_attached` is deleted, the linked statement is cascade-soft-deleted with the same `deletedAt` timestamp. Restoration is symmetric (matched by timestamp equality). Statements workstream implements the statement-side cascade. |

### 18.2 Still to confirm before deployment

1. **Shared Drive vs My Drive parent.** Strongly recommend Shared Drive for the parent folder — it removes the service-account-as-owner footgun *and* the `writer` role mapping (Contributor) gives us least-privilege automatically. Confirm with the team which option the org will use.
2. **AUTHORIZED_USERS membership.** Initial list to bake into the env var for staging and production. Suggest: Finance team + Admins. Worth listing real emails before deployment.
3. **Drive permission model for new Finance hires.** Currently the env-var approach means new hires don't automatically get access to existing folders (section 13.1). Acceptable for launch, or should we source from the User table dynamically?
4. **Description max length.** Set to 1000 chars in the schema. Confirm.
5. **Year range in the dropdown.** Spec suggests `currentYear - 1` to `currentYear + 1`. Confirm — or expand if back-claims for older periods are needed.

---

## 19. Out of scope (separate workstreams)

- **Statement upload, the `Statement Attached` transition, the verification queue, Opus integration, schedulers** — the Statements + Verification specs. The Statements spec also implements the cascade-soft-delete contract defined in sections 11.3 and 17.
- **NetSuite integration** — the `netsuite` subfolder is provisioned now so the future workstream has somewhere to write.
- **Hard delete / permanent purge of soft-deleted claims.** Soft delete is implemented in this spec (admin-only). A future hard-delete workstream could walk soft-deleted rows older than X days and permanently remove the DB row + Drive folder, for storage hygiene or compliance. Out of scope here.
- **Audit log of claim edits.** `createdBy` / `updatedBy` / `deletedBy` capture only the most recent action of each type. A full change history (old description vs new, claimant transitions, deletion + restoration cycles) is deferred to a future generic audit_log table that covers users, entities, and claims together.
- **Bulk operations** (CSV import, batch claimant assignment, bulk delete). Not in scope.
- **Dynamic AUTHORIZED_USERS** sourced from User Management. See section 13.1.
- **Drive folder cleanup automation.** Orphans from failed creates and folders from soft-deleted claims accumulate over time. A future cleanup script can handle this; out of scope for the receipts module.
- **Receipt-side file management within the portal.** Per UI spec section 7.5, receipts are uploaded directly in Drive, not via the portal. This spec doesn't change that.