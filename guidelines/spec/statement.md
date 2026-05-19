# Implementation Spec — Claims > Statements

**Project:** COE Finance Claims Portal
**Scope:** The `/claims/statements` page — upload, list, view, edit, and (manually) start verification for credit-card statements attached to claims. The statement file lives in Google Drive under the claim's `statements` subfolder; the portal owns the statement record, the file upload pipeline, and the one-to-one statement↔claim linkage.

**Stack:** Next.js App Router · TypeScript · Better Auth · Drizzle ORM · PostgreSQL · Google Drive (service account) via `googleapis`.

This spec assumes the **auth foundation**, **app shell**, **User Management**, **Entities Management**, **Classes**, **Departments**, **Claims** (claim table + Drive folder provisioning, see `receipt.md`), and **Receipts** (first-class receipt records, see `receipt-cr.md`) workstreams are complete. It builds directly on the structures those specs established — the `claim` table, the per-claim Drive folder (`<displayId>/statements/`), the three-role permission model (Admin/Finance/Employee), `requireRole` access gating, Server Actions with `useActionState`, full-page inline forms (no modals per UI spec section 12).

**Verification scope clarification:** This spec implements **everything in the statement domain EXCEPT the verification execution itself.** The full state machine, the verification-history table, the manual "Start Verification" gating, the Statement Detail page with its accordion, and the table actions that drive the state machine are all in scope. **Out of scope:** the scheduler that picks up `queued` rows and dispatches them to Opus, the second scheduler that polls `in_progress` rows for completion, and the actual writing of new history rows by either scheduler. Those land in a follow-up workstream. From this workstream's perspective, the verification-history table is **writable only at three moments** (statement upload with the checkbox checked, manual "Start Verification" click, and "Retry Verification" click) — see section 8 for the exact state-machine boundaries.

---

## 1. What Statements is and isn't

A **statement** is a credit-card statement document linked one-to-one with a claim. From the UI spec section 6:

- A statement has a **closing date**, an **upload date**, a **linked claim**, a **single file** (PDF / JPG / PNG), and a **verification status**.
- A statement is created by uploading a file through the portal — the file goes to Google Drive under `<claim.displayId>/statements/`, replacing any prior statement file in that folder (one file per claim folder at a time).
- Linking a statement to a claim flips that claim's status from `awaiting_statement` → `statement_attached` (the only valid transition driven by this workstream).
- Verification status starts at `pending_verification` and progresses through `queued` → `in_progress` → terminal (`success` / `failed`). The user gates the first transition manually; schedulers handle the rest (out of scope here — see section 8.6).
- Every status change generates a **verification-history row** so the audit trail survives across retries. The Statement Detail page surfaces the history as an accordion (UI spec section 6.5).

**What this spec doesn't cover** (separate workstreams):
- The scheduler that picks `queued` records and dispatches them to Opus.
- The scheduler that polls `in_progress` records for completion.
- The Opus API contract itself (job submission shape, response shape, retry semantics).
- NetSuite export of verified statements.

**Cascade soft-delete:** If a claim is soft-deleted (admin action, see `receipt.md` section 13), its linked statement is cascade-soft-deleted in lockstep. Restoring the claim restores the statement. The Drive file is untouched.

**Hard-delete (Admin / Finance only):** A statement can be permanently deleted from the Statement Detail page or the Statements list. Hard-delete removes the statement row, cascade-deletes its verification attempts (`statement_verification_attempt` rows via `ON DELETE CASCADE` on the FK), trashes the Drive file (recoverable in Drive trash for ~30 days), and reverts the parent claim's status to `awaiting_statement` so a new statement can be uploaded. Allowed **only** from `pending_verification`, `success`, or `failed` states — **not** from `queued` or `in_progress` (the scheduler workstream needs those rows intact). Cascade-soft-deleted statements (i.e. ones with `deletedAt` set) cannot be hard-deleted directly — the user must restore the parent claim first. See section 11.5 for the action, section 13.5 for the rationale.

---

## 2. Prerequisites

Everything the Receipts spec set up — Drive service account, `GOOGLE_*` env vars, the `claim.driveStatementsFolderId` column — is reused as-is. This workstream adds **nothing new** to the environment or to Google Cloud configuration.

### 2.1 Environment variables (re-used)

| Variable                       | Source                                                      |
|--------------------------------|-------------------------------------------------------------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Already set (receipts workstream)                            |
| `GOOGLE_PRIVATE_KEY`           | Already set                                                  |
| `GOOGLE_DRIVE_PARENT_FOLDER_ID`| Already set                                                  |
| `AUTHORIZED_USERS`             | Already set — these users automatically get Editor access on every claim folder, including the statements subfolder |

### 2.2 New environment variables

| Variable                         | Example                                              | Purpose                                                                 |
|----------------------------------|------------------------------------------------------|-------------------------------------------------------------------------|
| `STATEMENT_FILE_MAX_BYTES`       | `10485760`                                           | 10 MiB. Server-side limit on statement file uploads.                    |
| `STATEMENT_FILE_ALLOWED_TYPES`   | `application/pdf,image/jpeg,image/png`               | Comma-separated MIME types accepted by the upload Server Action. **Note:** narrower than `RECEIPT_FILE_ALLOWED_TYPES` — statements are PDF/JPG/PNG only per UI spec section 12. |

### 2.3 npm packages

No new packages. `googleapis` is already present from the Receipts workstream.

---

## 3. Data model

Two new tables: `statement` (the record itself) and `statement_verification_attempt` (the per-attempt audit log).

### 3.1 New table: `statement`

**File:** `src/db/schema/statement.ts`

| Column                        | Type                                                          | Notes                                                                                                |
|-------------------------------|---------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `id`                          | `text` (uuid), primary key                                    | Internal identifier. `crypto.randomUUID()` default, matching the existing tables.                    |
| `sequenceNumber`              | `bigint`, unique, not null, `default nextval('statement_seq')`| Global running number from a dedicated Postgres sequence. Independent of `claim_seq` — statements get their own series. Used to derive `displayId`. |
| `displayId`                   | `text`, unique, not null                                      | Human-readable ID: `STM-NNN` (e.g. `STM-001`, `STM-1000`). Computed once at insert time from `sequenceNumber`. Padded to a minimum of 3 digits; auto-extends beyond 999. **Does not change** if the statement is re-linked to another claim — the statement keeps its own identity. |
| `claimId`                     | `text`, FK → `claim.id`, **unique**, not null                 | One-to-one with claim. The `unique` constraint is what enforces "one statement per claim" at the DB level — the upload Server Action checks first, but the constraint is the last line of defense. |
| `statementDate`               | `date`, not null                                              | The closing date printed on the statement. User-provided.                                            |
| `uploadDate`                  | `timestamp`, not null, default `now()`                        | When the statement record was created. Distinct from `createdAt` only conceptually — kept as a separate column to match the UI spec column name and to remain stable if we later add audit columns. |
| `driveFileId`                 | `text`, not null                                              | The Drive file ID returned by the upload API call.                                                   |
| `fileUrl`                     | `text`, not null                                              | The `https://drive.google.com/file/d/<id>/view` URL. Stored to avoid re-querying Drive on every render. |
| `fileName`                    | `text`, not null                                              | Original filename as uploaded (e.g. `statement_april2026.pdf`). Shown in the Detail page Overview card. |
| `fileMimeType`                | `text`, not null                                              | MIME type as reported by the browser at upload. Used to render the right icon and validate on edit. |
| `fileSizeBytes`               | `bigint`, not null                                            | File size in bytes. Shown in the Detail page as "2.1 MB" etc.                                        |
| `verificationStatus`          | enum `('pending_verification','queued','in_progress','success','failed')`, default `'pending_verification'` | Current status. Mutated by exactly three call sites in this spec (see section 8.2). Schedulers will mutate it in a later workstream. |
| `lastDestructiveEditAt`       | `timestamp`, nullable                                          | Set by `updateStatement` **only** when the file is replaced or the linked claim is changed. NULL on insert and on date-only edits. Drives the "stale attempt" rendering on the Detail page accordion — see section 10.4. |
| `uploadedBy`                  | `text`, FK → `user.id`, not null                              | Who created the statement record. Does not change on edit, mirroring receipts.                        |
| `updatedBy`                   | `text`, FK → `user.id`, nullable                              | Last user to edit (file re-upload, date change, or claim re-link). Null until first edit.            |
| `updatedAt`                   | `timestamp`, not null, default `now()`                        | Updated alongside `updatedBy`.                                                                       |
| `deletedAt`                   | `timestamp`, nullable                                          | Set when the parent claim is cascade-soft-deleted. Null on active statements. See section 3.4.       |
| `deletedBy`                   | `text`, FK → `user.id`, nullable                              | Mirrors `claim.deletedBy` at cascade time.                                                            |

**Sequence:**
- `CREATE SEQUENCE statement_seq AS bigint START 1 INCREMENT 1` — owned by the `statement` table.

**Indexes:**
- Unique on `sequenceNumber` (DB constraint).
- Unique on `displayId` (DB constraint — defensive).
- **Unique on `claimId`** — enforces 1:1. The Server Action checks first for a friendly error, but the constraint is what guarantees integrity if two uploads race.
- Plain on `verificationStatus` (filter dropdown).
- Plain on `statementDate` (sort + date range filter).
- Plain on `uploadDate` (secondary sort).
- Partial index on `deletedAt WHERE deletedAt IS NULL` (matches receipts/claims pattern).

### 3.2 New table: `statement_verification_attempt`

**File:** `src/db/schema/statementVerificationAttempt.ts`

Each row records one attempt at verification — the moment a statement enters `queued`, plus any later transitions written by schedulers (out of scope here, but the table shape must support them).

| Column                  | Type                                                                 | Notes                                                                                  |
|-------------------------|----------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| `id`                    | `text` (uuid), primary key                                            |                                                                                        |
| `statementId`           | `text`, FK → `statement.id` **ON DELETE CASCADE**, not null            | The statement this attempt belongs to. The cascade clause is what makes `deleteStatement` (section 11.5) a single-statement DB op — Postgres deletes the attempt rows automatically when the parent statement is hard-deleted. Declared in Drizzle as `.references(() => statement.id, { onDelete: 'cascade' })`. |
| `status`                | enum `('queued','in_progress','success','failed')`, not null          | The status this attempt landed on. Note: `pending_verification` is **not** a valid value here — pending means "no attempt yet." |
| `opusJobId`             | `text`, nullable                                                      | The `JOB_EXECUTION_ID` returned by Opus. Null until the queue-dispatch scheduler writes it (out of scope here). Always null when this workstream creates a row. |
| `opusResponse`          | `jsonb`, nullable                                                     | The raw response payload from Opus. Null until the completion-poll scheduler writes it. The Detail page renders this generously — see section 7.3. |
| `triggeredBy`           | `text`, FK → `user.id`, nullable                                      | The user who initiated this attempt — set when a human clicked "Start Verification" or "Retry Verification" (or when the upload-time checkbox was checked). Null for system-triggered transitions, since schedulers run as the system actor. |
| `triggerSource`         | enum `('upload_checkbox','manual_start','manual_retry','scheduler')`  | Why this attempt exists. The first three are written by this workstream. `scheduler` is reserved for future scheduler writes. |
| `createdAt`             | `timestamp`, not null, default `now()`                                | When this attempt row was inserted. The Detail page sorts history by this column descending. |
| `updatedAt`             | `timestamp`, not null, default `now()`                                | Updated when a scheduler transitions this attempt's status (e.g. `queued` → `in_progress` → `success`). |

**Why one row per "attempt" vs. one row per "status change":** The Detail page shows the user one accordion item per verification *attempt* (per UI spec section 6.5 mock — each accordion is a Job ID with a final status). Modeling rows as attempts means: each Start/Retry button click inserts exactly one row, and the schedulers later mutate that same row's `status` / `opusJobId` / `opusResponse` columns as the attempt progresses. This matches what the user sees in the UI. A "status change log" approach would force the UI to collapse multiple rows back into a single attempt at render time — strictly more work for the same display.

**Indexes:**
- Plain on `statementId` (the Detail page joins on this).
- Plain on `(statementId, createdAt DESC)` — composite, the exact shape of the history query.
- Plain on `status` (for future scheduler polling: `WHERE status = 'queued'` / `WHERE status = 'in_progress'`).

### 3.3 Why a separate attempts table at all?

Three options were considered:

1. **No attempts table — just toggle `statement.verificationStatus`.** Loses the audit trail. Users need to see "this failed, then I retried, then it succeeded" with full Opus responses per attempt. Rejected on the Detail page requirements alone.
2. **Attempts table that also acts as the source of truth for current status.** Current status would be derived as `SELECT status FROM attempts WHERE statementId = ? ORDER BY createdAt DESC LIMIT 1`. Loses denormalized filter/sort speed on the list page (status is the primary filter — UI spec section 6.7) and creates an awkward "no attempts yet means pending_verification" sentinel. Rejected.
3. **`statement.verificationStatus` denormalized + separate attempts table** — what we do. The list page reads the denormalized column. The Detail page reads the attempts table for history. The two are kept in sync at the three write sites (section 8.2): every status mutation touches both.

The denormalization risk (the two getting out of sync) is mitigated by routing every status change through a single helper (`transitionVerificationStatus`, section 11.4) that updates both in the same transaction.

### 3.4 Cascade soft-delete from claim

When `claim.deletedAt` is set (by the admin soft-delete action in `receipt.md` section 13), the **same transaction** must update the linked statement, if one exists:

```sql
UPDATE statement
   SET deleted_at = $1, deleted_by = $2
 WHERE claim_id = $3 AND deleted_at IS NULL;
```

Restoration is symmetric: when `claim.deletedAt` is cleared, the statement's `deletedAt` is also cleared (only if its `deletedAt` matches the claim's prior `deletedAt`, to avoid restoring a row that was independently deleted — though this workstream never deletes statements standalone, so in practice the match always holds).

The statement file in Drive is **not** moved or deleted. Soft-delete is a DB-only concern.

This cascade is implemented inside the `deleteClaim` / `restoreClaim` Server Actions in `claims/receipts/_actions.ts` — those actions need to be updated as part of this workstream to add the statement update. See section 13.

### 3.5 Migration plan

1. `drizzle-kit generate` from the new `statement` and `statement_verification_attempt` schemas. Verify the generated migration includes `CREATE SEQUENCE statement_seq AS bigint START 1 INCREMENT 1` before the `CREATE TABLE statement`, and that both enums (`statement_verification_status` and `statement_verification_attempt_status` and `statement_verification_trigger_source`) are emitted.
2. `drizzle-kit migrate`.
3. No seed data — statements are created by users.

---

## 4. Routes and files

| File                                                                                            | Purpose                                                       |
|-------------------------------------------------------------------------------------------------|---------------------------------------------------------------|
| `src/db/schema/statement.ts`                                                                    | `statement` table + `statement_seq` sequence + enum            |
| `src/db/schema/statementVerificationAttempt.ts`                                                 | Attempts table + enums                                         |
| `src/db/schema/relations.ts`                                                                    | Add `statementRelations` and `statementVerificationAttemptRelations`; extend `claimRelations` with `statement: one(...)` |
| `src/db/schema/index.ts`                                                                        | Re-export the two new schema files                             |
| `src/lib/statement-id.ts`                                                                       | `formatStatementDisplayId(seq)` (pure, client-safe)            |
| `src/lib/statement-seq.server.ts`                                                               | `reserveNextStatementSequence()` (server-only)                 |
| `src/lib/drive.ts`                                                                              | **Extend** with `uploadStatementFile`, `moveStatementFile` (see section 12) |
| `src/app/(app)/claims/statements/page.tsx`                                                      | List page — replaces the current placeholder                   |
| `src/app/(app)/claims/statements/new/page.tsx`                                                  | Upload Statement form                                          |
| `src/app/(app)/claims/statements/[id]/page.tsx`                                                 | Statement Detail page (Overview card + Verification History)   |
| `src/app/(app)/claims/statements/[id]/edit/page.tsx`                                            | Inline Edit Statement form                                     |
| `src/app/(app)/claims/statements/_actions.ts`                                                   | Server Actions (see section 11)                                |
| `src/app/(app)/claims/statements/_lib/mutability.ts`                                            | `isStatementMutable(status)` predicate + the `StatementVerificationStatus` type. Pure helper, no DB imports — server-safe AND client-safe. Used by the Edit page server component (§9.0), the Detail page header (§10.3), the list-row trash icon (§6.2), and the Server Actions in `_actions.ts` (§11.2, §11.5). |
| `src/app/(app)/claims/statements/_components/StatementsTable.tsx`                               | List table — search / filters / sort / pagination              |
| `src/app/(app)/claims/statements/_components/StatementFormFields.tsx`                           | Shared form fields between Upload and Edit                     |
| `src/app/(app)/claims/statements/_components/VerificationStatusBadge.tsx`                       | Badge renderer for the 5 statuses                              |
| `src/app/(app)/claims/statements/_components/VerificationHistoryAccordion.tsx`                  | Accordion list of attempts on the Detail page                  |
| `src/app/(app)/claims/statements/_components/StartVerificationButton.tsx`                       | The play-icon button on the table row and the Detail page      |
| `src/app/(app)/claims/statements/_components/RetryVerificationButton.tsx`                       | The retry button on the Detail page                            |
| `src/app/(app)/claims/statements/_components/DeleteStatementButton.tsx`                         | The Delete button (Detail page header) AND the trash icon variant (list row). One component with a `variant: 'button' \| 'icon'` prop. Admin/Finance-only at the render site. Internally uses `useActionState(deleteStatement, null)` + `useTransition()` + `window.confirm`. See section 11.5.3. |
| `src/app/(app)/claims/receipts/_actions.ts`                                                     | **Extend** `deleteClaim` / `restoreClaim` to cascade to statement (section 13) |

---

## 5. Access control — defense in depth

Three layers, matching the Receipts and Entities patterns:

1. **Middleware:** redirects unauthenticated requests (already in place).
2. **Page:** `await requireRole(['admin', 'finance', 'employee'])` at the top of each page. **All three roles** can access Statements — UI spec section 3.1 truth table.
3. **Server Actions:** every action also calls `requireRole(...)` server-side AND re-evaluates data scoping based on the actor's role.

### 5.1 Data scoping rules (UI spec sections 3.2 + 3.2.1, applied to statements)

| Role     | Can see                                                          | Can upload                                                                                  | Can edit / re-link                                                       | Can start / retry verification                              | Can hard-delete                                              |
|----------|------------------------------------------------------------------|---------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|-------------------------------------------------------------|--------------------------------------------------------------|
| Admin    | All statements                                                   | Yes, against any claim that is `awaiting_statement` and has a claimant assigned             | Any statement                                                            | Any statement                                                | **Yes** — any statement (subject to the status guard, section 11.5) |
| Finance  | All statements                                                   | Yes, against any claim that is `awaiting_statement` and has a claimant assigned             | Any statement                                                            | Any statement                                                | **Yes** — any statement (subject to the status guard, section 11.5) |
| Employee | **`uploadedBy === actor.id` OR `claim.claimantId === actor.id`** | Only against claims **where they are the claimant (current)** and which are `awaiting_statement` | **`uploadedBy === actor.id` OR `claim.claimantId === actor.id`** | **`uploadedBy === actor.id` OR `claim.claimantId === actor.id`** | **No** — the Delete button is not rendered for Employees; the Server Action rejects POSTs from Employee actors |

**Why OR (not AND) across all four Employee predicates:** The Employee visibility/edit/start-retry rule is **OR**, not AND. Decision recorded 2026-05-19 (see section 18 "Decisions log"). Rationale: the user expects to be able to act on a statement if they either uploaded it (they recognize their own work) OR they are the current claimant (the claim is theirs now). The AND was considered for tightness but rejected — it would leave statements un-editable by anyone other than Finance after a claim reassignment, which is overly restrictive for this internal tool.

**Reassignment behavior (clarification):** If a claim is reassigned to a different claimant after the statement is uploaded, the OR predicate has these consequences:

| State                                  | Old uploader              | New claimant              | Old claimant                          |
|----------------------------------------|---------------------------|---------------------------|---------------------------------------|
| Visibility                             | Yes (uploadedBy match)    | Yes (claimantId match)    | No (no longer claimant; not uploader) |
| Edit / re-link                         | Yes                       | Yes                       | No                                    |
| Start / retry verification             | Yes                       | Yes                       | No                                    |

Visibility tracks the claim's **current** claimant. The original-claimant-at-upload-time is not preserved as a separate column — if that audit need arises later, it can be derived from the statement's verification-attempt rows (the upload-time `triggeredBy`, when the checkbox was checked) or from a separate audit-log workstream. Out of scope here.

### 5.2 The Linked Claim dropdown on the Upload form

Per UI spec section 6.1: the dropdown shows only claims that are simultaneously:
- `status = 'awaiting_statement'`, AND
- have `claimantId` set (NOT NULL — unassigned claims never appear in any user's dropdown), AND
- for Employee actors, `claimantId = actor.id`. For Admin/Finance actors, all assigned-and-awaiting claims appear.

The dropdown query lives in the Upload page's server component. The Server Action re-validates the same conditions on submit (a malicious client can't bypass the dropdown filter).

### 5.3 Sidebar visibility

The sidebar already shows Statements to all three roles (UI spec section 2.1). No change here — this section exists only because some Receipts patterns hide whole pages from non-admin roles, and Statements is the opposite.

---

## 6. List page (`/claims/statements`)

Server component. Filters and pagination come from URL search params, matching the Receipts list-page pattern.

### 6.1 Search params

- `?q=text` — case-insensitive match against `statement.displayId`, the linked `claim.displayId`, or the linked `claim.description`. **Does not** match claimant name (deliberate scope choice; deviates from the receipts list's search behavior to keep the subquery cost down).
- `?status=pending_verification|queued|in_progress|success|failed` — single-value filter on `verificationStatus`. The dropdown shows all 5 statuses plus an "All Verification Statuses" default (matches UI mock line 1341–1347).
- `?dateField=statement|upload` — **deviation from UI mock.** Controls which date column the date range filter applies to. Default `statement`. Renders as a small dropdown to the left of the date-range pickers; the picker label updates dynamically to "Statement date range:" or "Upload date range:". Decision recorded 2026-05-19 (see section 18).
- `?from=YYYY-MM-DD&to=YYYY-MM-DD` — date range. The column being filtered is determined by `?dateField`. Capped at 12 months. The server clamps `to` if the span exceeds 12 months.
- `?sort=col&dir=asc|desc` — sortable on all data columns (Statement ID, Statement Date, Linked Claim, Upload Date, Verification). Default: `statementDate desc` with **tiebreaker `uploadDate desc, id desc`** for deterministic ordering when multiple statements share a closing date (common — many statements close on month-end).
- `?page=N` — pagination, 20 rows per page.

**Default ORDER BY** (the resolved-sort fallback):

```sql
ORDER BY statement_date DESC, upload_date DESC, id DESC
```

The `id DESC` final tiebreaker handles the (microseconds-rare) case where two statements share both `statement_date` and `upload_date` to-the-microsecond — pure determinism, never reached in practice.

There is **no** `showDeleted` toggle on the statements list. Cascade-deleted statements stay hidden, full stop — Admin manages soft-delete from the Claims page, and the statement follows.

### 6.2 Columns (UI spec section 6.2)

| Column              | Source / format                                                                                                                              |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| Statement ID        | `displayId`, rendered as `font-mono text-brand-700` matching the mock chip styling.                                                            |
| Statement Date      | `statementDate` formatted as "30 Apr 2026".                                                                                                   |
| Linked Claim        | Two-part cell: `claim.displayId` (mono brand chip) + " · " + `claim.description` (truncated ~40 chars, full text on hover).                  |
| Upload Date         | `uploadDate` formatted as "10 May 2026", muted text.                                                                                          |
| Verification        | `<VerificationStatusBadge status={...} />` — see section 7.4 for the color contract.                                                          |
| Actions             | "View Details" secondary button → navigates to `/claims/statements/[id]`. Always shown. **For Admin/Finance**: also renders a trash-icon `btn-icon` to the right of View Details — invokes `deleteStatement` (section 11.5) after a `window.confirm` prompt (copy in section 11.5.3). The trash icon is **hidden** when `verificationStatus IN ('queued', 'in_progress')` to mirror the Server Action's status guard (the user can still POST anyway and get a friendly error, but hiding the button matches the actual capability). The trash icon is **not rendered for Employee actors**, ever. |
| Start               | Play-icon `btn-icon`. **Only rendered when `verificationStatus === 'pending_verification'`** (matches mock — UI spec section 6.4). Calls `startVerification` Server Action; on success, the table refreshes and the row's status badge transitions to `Queued`. |

Per the mock, the "Start" column is **separate** from "Actions" and is conditionally rendered. When no row in the current page has `pending_verification` status, the column header still appears (so the table layout is stable) but the cells are empty. This avoids the table reflowing as rows transition between statuses.

### 6.3 Empty state

When no statements exist, show the empty state from UI spec section 6 mock: file-upload icon, "No statements uploaded", subtext "Upload your first credit card statement to begin the verification process.", and a primary button "Upload First Statement" that navigates to `/claims/statements/new`.

### 6.4 Server-side query

```ts
// src/app/(app)/claims/statements/page.tsx
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { statement, claim, user } from "@/db/schema";
import { and, eq, or, ilike, gte, lte, desc, asc, sql, isNull } from "drizzle-orm";
import { StatementsTable } from "./_components/StatementsTable";

const PAGE_SIZE = 20;

type Search = {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: string;
};

export default async function StatementsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));

  const { from, to } = clampDateRange(sp.from, sp.to);

  const conditions = [
    isNull(statement.deletedAt),
    actor.role === "employee"
      ? or(eq(statement.uploadedBy, actor.id), eq(claim.claimantId, actor.id))
      : undefined,
    sp.q ? or(
      ilike(statement.displayId, `%${sp.q}%`),
      ilike(claim.displayId, `%${sp.q}%`),
      ilike(claim.description, `%${sp.q}%`),
    ) : undefined,
    sp.status ? eq(statement.verificationStatus, sp.status as any) : undefined,
    from ? gte(statement.statementDate, from) : undefined,
    to ? lte(statement.statementDate, to) : undefined,
  ].filter(Boolean);

  const orderBy = resolveSort(sp.sort, sp.dir);  // default: desc(statement.statementDate)

  const rows = await db.query.statement.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    with: {
      claim: { with: { claimant: true } },
      uploadedByUser: true,
    },
  });

  const total = await db.select({ count: sql<number>`count(*)::int` })
    .from(statement)
    .leftJoin(claim, eq(statement.claimId, claim.id))
    .where(conditions.length ? and(...conditions) : undefined);

  return (
    <StatementsTable
      rows={rows}
      total={total[0].count}
      page={page}
      filters={sp}
      actor={actor}
    />
  );
}
```

The Drizzle `with` clause joins the claim and its claimant. For Employee actors, the `OR` in the conditions enforces scoping at the DB level; the page-component layer never receives statements the user shouldn't see.

---

## 7. Upload form (`/claims/statements/new`)

Full-page inline form, "← Back to Statements" link at the top. Mirrors the receipt and claim form patterns.

### 7.1 Fields (UI spec section 6.1)

| Field                            | Type                                | Required | Notes                                                                                                                 |
|----------------------------------|-------------------------------------|----------|-----------------------------------------------------------------------------------------------------------------------|
| Statement File                   | File input (PDF/JPG/PNG)            | Yes      | Single file. Client-side accept attribute matches `STATEMENT_FILE_ALLOWED_TYPES`. Max size hint shown in the drop zone. |
| Statement Closing Date           | Date picker                          | Yes      | The closing date printed on the statement.                                                                            |
| Link to Claim                    | Dropdown                            | Yes      | Filtered by section 5.2's rules. Shows "Select a claim..." placeholder. Help text: *"Only claims with 'Awaiting Statement' status are shown."* For Employee actors, only claims where they are the claimant appear. |
| Start verification immediately   | Checkbox, **unchecked by default**  | No       | Per UI spec section 6.1: when checked, the upload Server Action also inserts a `queued` attempt row and sets the statement's status to `queued`. When unchecked, the statement stays at `pending_verification`. The visible-only-in-upload-mode behavior is enforced by hiding this row entirely in Edit. |

All three fields above the checkbox are mandatory. **Submit button text:** "Upload Statement". Disabled until file + date + claim are all populated.

### 7.1.1 Empty-state gating: zero eligible claims

The Upload form is **server-side gated** on dropdown population. Before rendering the form, the server component runs the same Linked Claim query (per section 5.2) and counts the eligible rows. If the result is **zero**, the form is replaced by a role-aware empty state:

**Employee, zero eligible claims:**

```
[upload-icon]

No eligible claims yet

You don't have any claims that are awaiting a statement.
Ask Finance to assign you to a claim, then come back here
to upload.

  [Back to Statements]
```

**Admin/Finance, zero eligible claims system-wide** (no assigned-awaiting claims exist anywhere):

```
[upload-icon]

No claims awaiting a statement

There are no claims with "Awaiting Statement" status and a
claimant assigned. Either create a new claim or assign a
claimant to an existing one.

  [Create a Claim]  [Back to Statements]
```

The "Create a Claim" button (Admin/Finance variant only) deep-links to `/claims/receipts/new`. The Back link goes to `/claims/statements`.

This empty state is reached only when the dropdown would have been empty. The Server Action's eligibility check (section 11.1, steps 2–3) is independent and would still catch a malicious POST against an ineligible claim — the empty state is purely a UX improvement.

### 7.2 What `new-impl.md` calls out specifically

The user's `new-impl.md` is concise; here are the four specific requirements it captures, mapped to where they're implemented:

1. **"[Finance/Employee/Admin] are allowed to upload statements"** → section 5 access control allows all three roles. Server Action re-checks role.
2. **"The link to claim section should show only unassigned claims and claims tied to the user"** → this phrasing is **superseded by UI spec section 6.1**, which explicitly says *unassigned claims do not appear in any user's dropdown*. Unassigned means `claim.claimantId IS NULL`, and the UI spec makes clear that the dropdown filter is **assigned-to-current-user (Employee)** or **assigned-to-anyone (Admin/Finance)**, never unassigned. Per the user's confirmation that the UI spec is the source of truth (see this spec's header), we implement the UI spec's rule. The Server Action enforces: `claim.status = 'awaiting_statement' AND claim.claimantId IS NOT NULL AND (actor.role IN ('admin','finance') OR claim.claimantId = actor.id)`.
3. **"The uploaded file will be stored in our google drive under <claim-id>/statement folder"** → Drive upload targets `claim.driveStatementsFolderId` (already populated when the claim was created — see `receipt.md` section 10). The folder is named `statements` (plural, matching the existing Drive provisioning code); the file is uploaded with its original filename. If a file already exists in that folder, it must be deleted first — but in this workstream a claim can never have a prior statement file when upload runs (the claim's status is `awaiting_statement`), so this scenario is impossible at upload time. It is handled in the **Edit** flow (section 9), not here.
4. **"Start verification checkbox unchecked by default. If checked, included in verification history table. Two tables: claim statement + claim statement verification history."** → The checkbox default is unchecked (section 7.1). When checked, the upload Server Action calls `transitionVerificationStatus(statement, 'queued', { source: 'upload_checkbox', triggeredBy: actor.id })` (section 11.4), which both sets `statement.verificationStatus = 'queued'` AND inserts a `statement_verification_attempt` row. When unchecked, the statement starts at `pending_verification` and **no attempt row is inserted yet** — the first attempt row will be inserted when the user clicks "Start Verification" later (section 8.2).

### 7.3 Submission flow

1. Client validates required fields populated.
2. Client calls `uploadStatement` Server Action (section 11.1).
3. Server: `requireRole(['admin','finance','employee'])`, validates file size + MIME, validates the linked claim is eligible (per section 5.2), reserves a statement sequence number.
4. Server: uploads file to `claim.driveStatementsFolderId` via `uploadStatementFile` (section 12.1). On Drive failure: abort, return error, no DB writes.
5. Server: inserts the `statement` row inside a transaction. The transaction also: (a) flips the claim's `status` from `awaiting_statement` → `statement_attached`, and (b) if the checkbox is checked, inserts the first `statement_verification_attempt` row with status `queued` and source `upload_checkbox`. **Ordering inside the transaction:** insert statement → update claim → optionally insert attempt. If the optional attempt insert fails, the whole transaction rolls back (and the Drive file is cleaned up — see section 11.1 cleanup discussion).
6. On success: redirect to `/claims/statements` with the new row at the top.
7. On failure after Drive upload succeeded: the Drive file is orphaned. The Server Action **attempts** to delete the orphan (best-effort `deleteDriveFile(driveFileId)` from drive.ts). If that cleanup itself fails, log it and surface the error to the user; the orphan is acceptable collateral and a future cleanup script can sweep them.

### 7.4 Loading state during submission

File upload + Drive call + DB transaction can take 3–6 seconds on a typical statement PDF. The submit button must show a spinner and disable during the call. Form copy during submission: *"Uploading statement and linking to claim…"*.

---

## 8. Verification status state machine

This section is the source of truth for status transitions. Every place in the code that changes `statement.verificationStatus` must match what's documented here.

### 8.1 The five statuses (UI spec section 6.3)

| Status                | Meaning                                                                                              |
|-----------------------|------------------------------------------------------------------------------------------------------|
| `pending_verification`| Statement uploaded, awaiting the user to start verification. **No attempt rows exist yet.**           |
| `queued`              | User has clicked Start Verification (or checked the upload-time box). The scheduler will pick it up. An attempt row exists with status `queued`. |
| `in_progress`         | Scheduler has sent the statement to Opus. The latest attempt's `opusJobId` is set. (Written by scheduler — out of scope.) |
| `success`             | Opus returned success. The latest attempt's `opusResponse` is set. (Written by scheduler — out of scope.) |
| `failed`              | Opus returned failure. The latest attempt's `opusResponse` is set. (Written by scheduler — out of scope.) |

### 8.2 In-scope transitions (this workstream)

| From                  | To       | Trigger                                                  | Side effects                                                                                                          |
|-----------------------|----------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| (none — new row)      | `pending_verification` | Statement upload, checkbox unchecked                   | Insert statement row. No attempt row. Flip claim status to `statement_attached`.                                       |
| (none — new row)      | `queued`              | Statement upload, checkbox checked                      | Insert statement row. Insert attempt row (`status='queued'`, `triggerSource='upload_checkbox'`, `triggeredBy=actor`). Flip claim status. |
| `pending_verification`| `queued`              | "Start Verification" button (table row OR Detail page)  | Insert attempt row (`status='queued'`, `triggerSource='manual_start'`, `triggeredBy=actor`). Update `statement.verificationStatus`. |
| `success` / `failed`  | `queued`              | "Retry Verification" button (Detail page only)          | Insert **new** attempt row (`status='queued'`, `triggerSource='manual_retry'`, `triggeredBy=actor`). Update `statement.verificationStatus`. Prior attempts are preserved and shown in the accordion. |
| (any non-terminal)    | `pending_verification`| Edit form re-upload OR re-link (section 9)              | Reset `statement.verificationStatus` to `pending_verification`. **No new attempt row inserted.** Prior attempts are preserved in the history (so the accordion still shows the historical attempts on the re-uploaded/re-linked statement). |

### 8.3 Out-of-scope transitions (scheduler workstream)

| From      | To           | Trigger                                          |
|-----------|--------------|--------------------------------------------------|
| `queued`  | `in_progress`| Queue-dispatch scheduler picks up the row, sends to Opus, gets back `JOB_EXECUTION_ID`. Updates the **same** attempt row's `status` + `opusJobId`. |
| `in_progress` | `success` / `failed` | Completion-poll scheduler queries Opus for the job. Updates the **same** attempt row's `status` + `opusResponse`. |

The schedulers mutate the latest attempt row in place — they do **not** insert new rows. New rows are only inserted at the four in-scope trigger points above.

### 8.4 Why "Start Verification" doesn't appear when status is `queued` or `in_progress`

UI spec section 6.5: *"No action button is shown when status is `queued` or `in_progress` — the user waits for the scheduler."* The Detail page header conditionally renders either Start, Retry, or nothing based on the current status. The table row's Start button has the same conditional (section 6.2).

### 8.5 Statement mutability — the canonical rule

A **mutable** statement can be edited (re-upload file, change closing date, re-link claim) and hard-deleted (Admin/Finance). A **non-mutable** statement is frozen against portal-initiated mutations.

```
isStatementMutable(status: VerificationStatus): boolean
  = status === 'pending_verification'
  || status === 'success'
  || status === 'failed'

// Equivalent: non-mutable iff status IN ('queued', 'in_progress')
```

| Status                 | Mutable? | Why                                                          |
|------------------------|----------|--------------------------------------------------------------|
| `pending_verification` | Yes      | Never sent to Opus. Safe to edit or delete.                  |
| `queued`               | **No**   | Awaiting scheduler dispatch. Edit/delete would orphan the queued attempt and create a race against the scheduler. |
| `in_progress`          | **No**   | Opus is actively processing the file. Edit/delete would invalidate Opus's work and leave a running job pointing at a non-existent or changed statement. |
| `success`              | Yes      | Terminal. The Opus run is finished. Re-edits create a new attempt later.   |
| `failed`               | Yes      | Terminal. Same as success.                                                |

**Operations gated by `isStatementMutable`:**

| Operation                                  | Gated?  | Spec section |
|--------------------------------------------|---------|--------------|
| `updateStatement` (re-upload, date, claim) | **Yes** | §9.0, §11.2  |
| `deleteStatement` (hard-delete)            | **Yes** | §11.5        |
| Edit page render (`/claims/statements/[id]/edit`) | **Yes** | §9.0 |
| `startVerification` (`pending → queued`)   | n/a (already source-state-gated; never fires from queued/in_progress) | §11.3 |
| `retryVerification` (terminal → `queued`)  | n/a (already source-state-gated; never fires from queued/in_progress) | §11.3 |

**Exemptions:**

- **Schedulers** (out of scope here, future workstream) are exempt — they own the `queued → in_progress` and `in_progress → success/failed` transitions and the corresponding `statement_verification_attempt` row mutations. The lock is for portal-initiated user actions.
- **Cascade soft-delete from the parent claim** (`deleteClaim` per `receipt.md` §13) is exempt — it originates from the parent table, not from a statement-edit flow. A `queued` or `in_progress` statement is still cascade-soft-deleted with its claim. The scheduler workstream must tolerate finding statements in a soft-deleted state when its poll lands.

**Known boundary — out-of-band Drive edits:** The lock applies to **portal-initiated** mutations only. Users with direct Drive access (the `AUTHORIZED_USERS` list configured per `receipt.md` §2.1 — typically Finance + Admin) could still replace or delete the file directly in Google Drive while the statement is queued/in_progress. The portal cannot prevent this. Such direct edits will diverge from the portal's state (`statement.driveFileId` may point at a now-replaced-or-deleted Drive file), and the scheduler may fail to verify against an unexpected file. Finance team is self-policed on this.

Decision recorded 2026-05-19 (round 3) — see section 18.2.

### 8.6 What this workstream considers "done"

When this workstream lands:
- A statement can be uploaded with or without checking the "Start verification immediately" box.
- The list page and Detail page render every status correctly (including `in_progress`/`success`/`failed`, even though no code in *this* workstream produces those states yet — we render them defensively so the scheduler workstream doesn't need to touch the UI).
- The user can click Start Verification on a `pending_verification` row/detail and watch it transition to `queued`. Beyond that, the status stays `queued` until the scheduler workstream is built.
- Retry from `success` / `failed` is wired but won't be reachable until schedulers land.
- The accordion on the Detail page renders all attempts the user has created (which, in this workstream, will all be in `queued` status until schedulers run).

The user explicitly called this out in `new-impl.md`: *"We are only going to implement everything about the statement section except for the verification history which will be handled later by our scheduler implementation."* This spec interprets that as: **build the data structures and UI for verification history fully; do not build the scheduler.** The history table is populated by user actions in this workstream; the scheduler later mutates rows in place.

---

## 9. Edit Statement form

**Route:** `/claims/statements/[id]/edit`
**Entry point:** Edit button on the Detail page header (per UI spec section 6.4.1, edit lives on the Detail page, not the list row).

### 9.0 Pre-condition: the statement must be mutable

Per the mutability rule in §8.5, **no field on a statement** (file, closing date, linked claim) can be edited while `verificationStatus IN ('queued', 'in_progress')`. The lock applies to every role — Admin, Finance, Employee. There is no override.

**Layer 1 — page render guard (server component):**

The `/claims/statements/[id]/edit` page loads `existing` and checks `isStatementMutable(existing.verificationStatus)`. If non-mutable, the page **redirects** to the Detail page with a notice query param:

```ts
// src/app/(app)/claims/statements/[id]/edit/page.tsx
const existing = await db.query.statement.findFirst({ where: ... });
if (!existing) notFound();
if (!isStatementMutable(existing.verificationStatus)) {
  redirect(`/claims/statements/${id}?notice=locked`);
}
// ...render form
```

The Detail page reads `?notice=locked` and renders a one-time amber banner above the title:

```
⚠ Editing is locked while verification is queued or in progress.
  Wait for it to complete (or fail) before editing.            [×]
```

The `[×]` button clears the notice by navigating to the same URL without the query param. The banner is rendered only when the param is present, so a refresh of the bare URL hides it. No cookies, no local storage — pure URL state.

**Layer 2 — Server Action guard (`updateStatement`):**

`updateStatement` (§11.2) also checks status and rejects mid-flight transitions. The two layers cover different race windows: page redirect catches the user who clicked Edit when the status was already locked; Server Action catches the user who opened the form while mutable, then submitted after the status flipped. See §11.2.x for the conditional-UPDATE pattern that closes the read-then-write race.

The Edit button on the Detail header (§10.3) is **hidden entirely** when the statement is non-mutable. The page redirect and Server Action guard are belt-and-suspenders against URL-navigation and stale-tab cases.

### 9.1 Field mutability (UI spec section 6.4.1)

All three fields are editable. The fourth (the upload-time checkbox) is **not** rendered in Edit mode.

| Field                  | Editable? | Notes                                                                                                                       |
|------------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------|
| Statement File         | Yes       | File picker. The current file is shown above the picker as a card with filename, upload date, size, and a "View" link. **Leaving the picker empty keeps the existing file** — no Drive operation. **Uploading a new file deletes the old one from Drive** (one statement file per claim folder) and uploads the replacement. |
| Statement Closing Date | Yes       | Date picker, pre-filled. Free edit.                                                                                          |
| Link to Claim          | Yes       | Dropdown. Shows the current claim at the top (labeled as such, even if its status doesn't qualify for the normal filter), followed by other claims that match the section 5.2 eligibility rule. Selecting a different claim triggers the re-link side effects in section 9.3. |

The "Start verification immediately" checkbox does **not** appear here. After saving an edit, the user can click Start Verification afterward from the Detail page.

### 9.2 Edit-mode info banner

Per UI spec mock (`statements-form` section, edit-mode warning), the edit form shows an amber banner at the top:

> ⚠
> **Re-uploading a file** will permanently delete the existing statement file from Google Drive.
> **Changing the linked claim** will move the file from the previous claim's folder to the new claim's folder, and revert the old claim to "Awaiting Statement".
> Either change will reset the verification status to **Pending Verification**.

### 9.3 Side effects table

The two destructive change types behave differently in Drive:

| User change                          | DB effect                                                                                                                                  | Drive effect                                                                          | Verification effect                                |
|--------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|----------------------------------------------------|
| Date only changed                    | Update `statementDate`, `updatedBy`, `updatedAt`.                                                                                          | None.                                                                                  | None.                                              |
| New file uploaded (claim unchanged)  | Update `driveFileId`, `fileUrl`, `fileName`, `fileMimeType`, `fileSizeBytes`, `updatedBy`, `updatedAt`. **Reset `verificationStatus` to `pending_verification`.** | Delete old `driveFileId`, upload new file to same `statements` folder.                | Status resets to pending. Existing attempts in the history are **preserved** (so the audit trail shows all attempts on the prior file too — the file was replaced, not the statement). |
| Linked claim changed (no new file)   | Update `claimId`, `updatedBy`, `updatedAt`. **Reset `verificationStatus` to `pending_verification`.** Update old claim's `status` back to `awaiting_statement`. Update new claim's `status` to `statement_attached`. | **Move** file from old claim's `statements` folder to new claim's `statements` folder, via `moveStatementFile` (section 12.2). The file's `driveFileId` does NOT change; only its parent does. `fileUrl` and `fileName` don't change either. | Status resets. Attempts preserved. |
| Both file replaced AND claim changed | All of the above combined.                                                                                                                  | **Upload new file directly to NEW claim's `statements/` folder**, then trash old file from OLD claim's folder. Skips the move step entirely. | Status resets. Attempts preserved. |

**Ordering for the both-changed path** (decision recorded 2026-05-19):

1. Upload new file to the **new** claim's `driveStatementsFolderId`. Get back `newFileId`, `newWebViewLink`.
2. DB writes: update `statement` row (new `claimId`, new file metadata, reset `verificationStatus`, set `lastDestructiveEditAt = now()`), flip old claim's `status` back to `awaiting_statement`, flip new claim's `status` to `statement_attached`.
3. Trash old file from old claim's folder (best-effort `deleteDriveFile(oldFileId)`).

Step 3 is **not** required to succeed for the operation to be considered complete — if it fails, the new statement is correct and the old file lingers in old claim's `statements/` folder (recoverable via Drive trash). Log the cleanup failure for manual reconciliation.

No `moveStatementFile` call is needed in this combined path because we're uploading a fresh file at the destination — the move would be wasted I/O.

**Important invariant:** when the claim is re-linked, the OLD claim returns to `awaiting_statement`. This is part of the DB writes in step 2 above. If the old claim has already been deleted somehow (shouldn't happen — statements are cascade-deleted with claims), the re-link is blocked with an error.

### 9.3.1 `lastDestructiveEditAt` update rule

The `statement.lastDestructiveEditAt` column (section 3.1) is set to `now()` inside the `updateStatement` DB write **only** when `fileChanging || claimChanging`. It is **not** touched on date-only edits.

```ts
const isDestructive = fileChanging || claimChanging;
await db.update(statement).set({
  ...otherFields,
  lastDestructiveEditAt: isDestructive ? new Date() : existing.lastDestructiveEditAt,
});
```

This column drives stale-attempt detection on the Detail page accordion — see section 10.4.

### 9.4 Why attempts are preserved on edit but the status resets

The status reset to `pending_verification` ensures the new file / new claim is independently re-verified (Opus needs to look at the new file, or the same file against the new claim's receipts). But the prior attempts are valuable audit data — they show what happened to the *previous* state of this statement record. Preserving them in the accordion gives a complete history.

The alternative — wiping attempt rows on edit — was rejected because it would erase Opus responses that may be referenced later (e.g. "we know Opus already saw this file once and said X, but then we re-uploaded with a corrected page 2"). The accordion ordering by `createdAt` desc means new attempts appear at the top after the user clicks Start Verification again; the old attempts settle below.

### 9.5 Submission

On success: redirect back to `/claims/statements/[id]` (the Detail page). The new state is reflected immediately. Validation errors leave the user on the edit form with their entries preserved.

---

## 10. Statement Detail page (`/claims/statements/[id]`)

Server component. Loads the statement, the linked claim, the claimant, and the verification history in one query.

### 10.1 Access check

`requireRole(['admin', 'finance', 'employee'])` plus the same data-scoping rule from section 5.1: an Employee accessing a statement they don't own and that isn't on their claim → 404. (A 404, not a 403 — we don't reveal that the statement exists.)

**Soft-deleted statements also return 404 for all roles**, including Admin. The Detail page's query filters `WHERE deletedAt IS NULL`. Admin recovery of cascade-deleted statements is via the Claims page's restore flow (section 13.2), not via the Statement Detail URL. Decision recorded 2026-05-19 — keeps the visibility-vs-existence model consistent (soft-deleted = effectively doesn't exist for direct navigation).

### 10.2 Page structure (UI spec section 6.5)

1. **Back link** — "← Back to Statements" at the top.
2. **Header** — title "Statement Details", `displayId` in mono, current status badge. Right-aligned action buttons (see section 10.3).
3. **Overview card** — two-column grid showing:
   - Statement Date
   - Upload Date
   - Linked Claim (`claim.displayId` + " — " + `claim.description`, mono ID with brand color)
   - Claimant (resolved from `claim.claimantId`)
   - Claim Description (full, not truncated)
   - Statement File (clickable link to `fileUrl`, with file icon + filename)
   - Google Drive Folder (clickable link to the claim's statements subfolder URL, constructed from `claim.driveStatementsFolderId`)
4. **Verification History** — accordion list of attempts, newest first. See section 10.4.

### 10.3 Header action buttons (per UI spec section 6.5)

Four potential buttons, conditionally rendered:

| Button                | Visible when                                                                              | Action                                                                                          |
|-----------------------|-------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| **Edit**              | User has permission per 5.1 AND `isStatementMutable(verificationStatus)` per §8.5 AND `deletedAt IS NULL` | Navigates to `/claims/statements/[id]/edit`.                                                    |
| **Start Verification**| `verificationStatus === 'pending_verification'`                                            | Calls `startVerification` Server Action.                                                        |
| **Retry Verification**| `verificationStatus IN ('success','failed')`                                               | Calls `retryVerification` Server Action.                                                        |
| **Delete**            | `actor.role IN ('admin','finance')` AND `isStatementMutable(verificationStatus)` per §8.5 AND `deletedAt IS NULL` | Calls `deleteStatement` Server Action (section 11.5) after a `window.confirm` prompt. Rendered as a red-tinted secondary button with a trash icon: `[🗑 Delete]`. Positioned at the **right end** of the action button row to separate it visually from the safer Edit/Start/Retry buttons. |

When `verificationStatus IN ('queued', 'in_progress')`, **none** of the four action buttons render — no Edit, no Start, no Retry, no Delete. The Detail header shows only the status badge. The user waits for the scheduler. This reflects the mutability lock in §8.5 (Edit and Delete are gated on mutability; Start and Retry are naturally inapplicable to non-terminal/non-pending source states).

### 10.4 Verification History accordion (UI spec section 6.5)

A space-y-3 stack of accordion items, one per `statement_verification_attempt` row, ordered by `createdAt` DESC.

**Collapsed header** (always visible):
- Left side: status badge (matching the global badge contract), then `opusJobId` in mono — or "—" if null (which it always is when this workstream is the writer). After the Job ID, render a small **"Stale"** chip if the attempt is stale (see 10.4.1).
- Below the status row: a small sub-label rendering the trigger source — e.g. "Manually started by Ahmad Razak", "Auto-queued at upload by Sarah Chen", "Retry by Ahmad Razak". Resolved from `triggerSource` + `triggeredBy → user.name`.
- Right side: relative-formatted timestamp (e.g. "15 May 2026, 2:34 PM"), then chevron icon.

**Expanded content** (revealed on click — every attempt is expandable, even ones without payload):
- A panel with background color matched to the status: red-50 for `failed`, emerald-50 for `success`, indigo-50 for `queued`, blue-50 for `in_progress`.
- For `queued` attempts with no `opusJobId` (this workstream's typical output): the panel says *"Awaiting scheduler pickup. This attempt was queued at &lt;timestamp&gt;. Opus hasn't started processing it yet."*
- For attempts with `opusResponse`: "Opus Response" label, then the raw `opusResponse` JSONB pretty-formatted.
- If the attempt is marked stale (see 10.4.1), prepend a tinted banner: *"This response was generated against an earlier version of the statement. The current file/claim link was updated on &lt;lastDestructiveEditAt&gt;."*

### 10.4.1 Stale attempt detection

After a destructive edit (file replace or claim re-link), the prior verification attempts no longer describe the current statement — Opus's "verified Adobe Systems MYR 1,250" verdict from before the file was replaced is about a file that no longer exists.

The Detail page marks these attempts visually:

```
isStale(attempt, statement) =
  statement.lastDestructiveEditAt !== null
  AND attempt.createdAt < statement.lastDestructiveEditAt
```

The check is **derived at render time** from the two columns — no new column on the attempts table is needed. NULL `lastDestructiveEditAt` (the never-destructively-edited case) means no attempt is stale, which is correct.

A "Stale" chip in the collapsed header alerts the auditor at a glance; the expanded content includes the explanatory banner with the exact `lastDestructiveEditAt` timestamp so they know when the underlying change happened. Attempts created AFTER the destructive edit (the user clicked Start again after editing) are not stale and render uniformly.

**For this workstream specifically:** every accordion item this workstream writes will be a `queued` row with no `opusJobId` and no `opusResponse`. The accordion still works — sub-label, placeholder text, stale chip if applicable. When the scheduler workstream lands, those rows' columns get filled in and the same accordion renders the full Opus context with the stale chip rules already in place.

### 10.5 The "Mock Preview" status switcher (UI mock element)

The HTML mock includes a small amber "Mock Preview" panel above the Detail header with five buttons to swap the displayed status — this is a **mock-only** affordance for the designer's preview. It is NOT part of the production page. Do not implement.

---

## 11. Server Actions

**File:** `src/app/(app)/claims/statements/_actions.ts`

All actions: `"use server"`. All actions call `requireRole(...)` at the top. All actions return `ActionResult = { error: string } | { ok: true } | null` — the exact shape used by `claims/receipts/_actions.ts` and `claims/receipts/[id]/_actions.ts`. Forms consume it via `useActionState(action, null as ActionResult)` (see `CreateClaimForm.tsx`, `ReceiptForm.tsx`). Validation uses `zod` schemas with `safeParse(Object.fromEntries(formData))`, returning `{ error: parsed.error.errors[0].message }` on failure — mirror this pattern; do not introduce a new error shape.

**Shared mutability helper.** Per §8.5, the predicate `isStatementMutable(status)` is the single source of truth for "can this statement be edited or hard-deleted?" It lives next to the actions and is also exported for use by the Edit page server component (§9.0) and the Detail page header logic (§10.3):

```ts
// src/app/(app)/claims/statements/_lib/mutability.ts (or co-located helper in _actions.ts)
export type StatementVerificationStatus =
  | "pending_verification"
  | "queued"
  | "in_progress"
  | "success"
  | "failed";

export function isStatementMutable(status: StatementVerificationStatus): boolean {
  return status === "pending_verification" || status === "success" || status === "failed";
}
```

Putting this in a `_lib/` sibling (or near the actions) keeps it server+client safe — it's pure logic with no DB import. Components in `_components/` import it for conditional rendering (Edit button visibility, list-row trash icon visibility). Server actions import it for the mid-flight status guard.

### 11.1 `uploadStatement(formData)`

Matches the existing `createReceipt` shape in `src/app/(app)/claims/receipts/[id]/_actions.ts`: zod schema + `Object.fromEntries`, sequential ops with best-effort Drive cleanup (not a single DB transaction wrapping the Drive call — the Drive op happens outside the DB so it's by definition not transactional). The receipts module does **not** use `db.transaction()` for its create path; it relies on ordering + cleanup, and statements follow the same convention.

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, statement, statementVerificationAttempt } from "@/db/schema";
import { formatStatementDisplayId } from "@/lib/statement-id";
import { reserveNextStatementSequence } from "@/lib/statement-seq.server";
import { uploadStatementFile, deleteDriveFile } from "@/lib/drive";

type ActionResult = { error: string } | { ok: true } | null;

const FILE_MAX_BYTES = Number(process.env.STATEMENT_FILE_MAX_BYTES ?? 10 * 1024 * 1024);
const FILE_ALLOWED_TYPES = (
  process.env.STATEMENT_FILE_ALLOWED_TYPES ?? "application/pdf,image/jpeg,image/png"
).split(",");

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

const UploadInput = z.object({
  claimId: z.string().min(1, "Claim is required."),
  statementDate: z.string().min(1, "Statement date is required."),
  startVerification: z.preprocess((v) => v === "on" || v === "true", z.boolean()).optional(),
});

export async function uploadStatement(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const parsed = UploadInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please select a file." };
  if (file.size > FILE_MAX_BYTES) {
    return { error: `File too large. Max ${(FILE_MAX_BYTES / 1024 / 1024).toFixed(0)} MiB.` };
  }
  if (!FILE_ALLOWED_TYPES.includes(file.type)) {
    return { error: `Unsupported file type ${file.type}. Allowed: PDF, JPEG, PNG.` };
  }

  // Eligibility (section 5.2).
  const claimRow = await db.query.claim.findFirst({
    where: and(eq(claim.id, parsed.data.claimId), isNull(claim.deletedAt)),
  });
  if (!claimRow) return { error: "Claim not found." };
  if (claimRow.status !== "awaiting_statement") return { error: "Claim is not awaiting a statement." };
  if (!claimRow.claimantId) return { error: "Claim has no claimant assigned." };
  if (actor.role === "employee" && claimRow.claimantId !== actor.id) {
    return { error: "You can only upload statements for claims assigned to you." };
  }

  const sequenceNumber = await reserveNextStatementSequence();
  const displayId = formatStatementDisplayId(sequenceNumber);

  const statementId = crypto.randomUUID();
  const driveFilename = `${statementId}_${sanitizeFilename(file.name)}`;

  // 1) Drive upload (network, can't be rolled back).
  let uploaded: { fileId: string; webViewLink: string };
  try {
    uploaded = await uploadStatementFile(claimRow.driveStatementsFolderId, driveFilename, file);
  } catch (err) {
    console.error(`[uploadStatement] Drive upload failed for claim ${claimRow.displayId}:`, err);
    return { error: "Could not upload file to Google Drive. Please try again." };
  }

  // 2) DB writes — sequential, with best-effort Drive cleanup on failure.
  try {
    await db.insert(statement).values({
      id: statementId,
      sequenceNumber,
      displayId,
      claimId: claimRow.id,
      statementDate: parsed.data.statementDate,
      driveFileId: uploaded.fileId,
      fileUrl: uploaded.webViewLink,
      fileName: file.name,
      fileMimeType: file.type,
      fileSizeBytes: file.size,
      verificationStatus: parsed.data.startVerification ? "queued" : "pending_verification",
      uploadedBy: actor.id,
    });

    await db.update(claim)
      .set({ status: "statement_attached" })
      .where(eq(claim.id, claimRow.id));

    if (parsed.data.startVerification) {
      await db.insert(statementVerificationAttempt).values({
        statementId,
        status: "queued",
        triggerSource: "upload_checkbox",
        triggeredBy: actor.id,
      });
    }
  } catch (err) {
    console.error(`[uploadStatement] DB insert failed after Drive upload. Attempting cleanup:`, err);
    try {
      await deleteDriveFile(uploaded.fileId);
    } catch (cleanupErr) {
      console.error(`[uploadStatement] Cleanup also failed. Orphan in Drive (fileId=${uploaded.fileId}):`, cleanupErr);
    }
    if (isUniqueConstraintViolation(err, "statement_claim_id_unique")) {
      return {
        error: "This claim was just attached to a statement by another user. Please go back and pick a different claim.",
      };
    }
    return { error: "Database error while saving statement. Please try again." };
  }

  revalidatePath("/claims/statements");
  redirect("/claims/statements");
}

// Helper: detect a Postgres unique-constraint violation by name.
// pg / drizzle bubble these up as errors with .code === '23505' and
// .constraint === '<constraint_name>'. Concrete shape varies by driver
// version — implementation should be liberal in what it checks.
function isUniqueConstraintViolation(err: unknown, constraintName: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code !== "23505") return false;
  return e.constraint === constraintName || (e.message ?? "").includes(constraintName);
}
```

**Concurrent-upload race** (decision recorded 2026-05-19): two users may submit the upload form for the same eligible claim in the same millisecond window. Both validate eligibility (the claim is still `awaiting_statement` at validation time), both upload to Drive, but only one DB insert succeeds — the `unique (claim_id)` constraint catches the second one. The block above detects that specific violation by constraint name and returns a friendly error pointing at the actual cause. The losing user's Drive file is still cleaned up by the same catch block.

**Note on `uploadStatementFile` signature:** matches `uploadReceiptFile` — `(parentFolderId: string, filename: string, file: File) => Promise<{ fileId: string; webViewLink: string }>`. The return key is **`webViewLink`** (not `fileUrl`) because that's what Drive v3 calls it and `drive.ts` re-exports it as such. Map it onto the DB column `fileUrl` at the call site, matching how `createReceipt` does it.

### 11.2 `updateStatement(formData)`

Mirrors the `updateReceipt` pattern (`src/app/(app)/claims/receipts/[id]/_actions.ts`): zod input includes `statementId` as a hidden field, all DB writes are sequential (no `db.transaction()`), the new file is uploaded **before** the DB write so a Drive failure short-circuits cleanly, and the **old** Drive file is deleted only **after** the DB write succeeds (so a DB failure doesn't leave the user with neither the old nor the new file).

```ts
const UpdateInput = z.object({
  statementId: z.string(),
  statementDate: z.string().min(1, "Statement date is required."),
  claimId: z.string().min(1, "Claim is required."),
});

export async function updateStatement(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const parsed = UpdateInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const existing = await db.query.statement.findFirst({
    where: eq(statement.id, parsed.data.statementId),
    with: { claim: true },
  });
  if (!existing) return { error: "Statement not found." };

  // Permission gate (section 5.1).
  const canEdit =
    actor.role === "admin" ||
    actor.role === "finance" ||
    (existing.uploadedBy === actor.id && existing.claim.claimantId === actor.id);
  if (!canEdit) return { error: "You don't have permission to edit this statement." };

  // Mutability gate (§8.5). Same set as deleteStatement's status guard.
  // Even though the Edit page server component already redirects when locked,
  // a stale tab could submit after a status flip. This is Layer 2 of the
  // two-layer lock; the conditional UPDATE below (§11.2.x) is Layer 2.5,
  // closing the read-then-write race.
  if (!isStatementMutable(existing.verificationStatus)) {
    return {
      error:
        "Cannot edit — verification is queued or in progress. " +
        "Wait for it to complete (or fail) before editing.",
    };
  }

  // Soft-delete gate. Editing a cascade-soft-deleted statement is incoherent —
  // its parent claim is also deleted. UI shouldn't render the Edit button here
  // (Detail page 404s on soft-deleted), but the action defends against POSTs.
  if (existing.deletedAt) {
    return {
      error:
        "This statement is part of a deleted claim. Restore the claim first.",
    };
  }

  const claimChanging = parsed.data.claimId !== existing.claimId;
  let newClaimRow: typeof existing.claim | null = null;
  if (claimChanging) {
    const row = await db.query.claim.findFirst({
      where: and(eq(claim.id, parsed.data.claimId), isNull(claim.deletedAt)),
    });
    if (!row) return { error: "New linked claim not found." };
    if (row.status !== "awaiting_statement") return { error: "New claim is not awaiting a statement." };
    if (!row.claimantId) return { error: "New claim has no claimant assigned." };
    if (actor.role === "employee" && row.claimantId !== actor.id) {
      return { error: "You can only link to claims assigned to you." };
    }
    newClaimRow = row;
  }

  const file = formData.get("file");
  const fileChanging = file instanceof File && file.size > 0;

  // Drive ops first. On failure here, the DB is untouched.
  let newDriveFileId = existing.driveFileId;
  let newFileUrl = existing.fileUrl;
  let newFileName = existing.fileName;
  let newMime = existing.fileMimeType;
  let newSize = existing.fileSizeBytes;
  let oldFileToDeleteAfterCommit: string | null = null;

  if (fileChanging) {
    if (file.size > FILE_MAX_BYTES) return { error: "File too large." };
    if (!FILE_ALLOWED_TYPES.includes(file.type)) return { error: `Unsupported file type ${file.type}.` };

    const targetFolder = newClaimRow?.driveStatementsFolderId ?? existing.claim.driveStatementsFolderId;
    const driveFilename = `${existing.id}_${sanitizeFilename(file.name)}`;
    try {
      const uploaded = await uploadStatementFile(targetFolder, driveFilename, file);
      newDriveFileId = uploaded.fileId;
      newFileUrl = uploaded.webViewLink;
      newFileName = file.name;
      newMime = file.type;
      newSize = file.size;
      oldFileToDeleteAfterCommit = existing.driveFileId;
    } catch (err) {
      console.error(`[updateStatement] Drive upload failed:`, err);
      return { error: "Could not upload new file. Statement not updated." };
    }
  } else if (claimChanging) {
    try {
      await moveStatementFile(
        existing.driveFileId,
        existing.claim.driveStatementsFolderId,
        newClaimRow!.driveStatementsFolderId
      );
    } catch (err) {
      console.error(`[updateStatement] Drive move failed:`, err);
      return { error: "Could not move file to the new claim's folder. Statement not updated." };
    }
  }

  // DB writes (sequential; no transaction, matching updateReceipt + updateClaim).
  // The first UPDATE is CONDITIONAL on the statement still being mutable (§11.2.x).
  // If the scheduler flipped status to queued/in_progress between the read and
  // this write, the UPDATE affects zero rows and we roll back the Drive operations.
  const statusReset = fileChanging || claimChanging;
  const isDestructive = fileChanging || claimChanging;
  try {
    const updated = await db.update(statement).set({
      statementDate: parsed.data.statementDate,
      claimId: parsed.data.claimId,
      driveFileId: newDriveFileId,
      fileUrl: newFileUrl,
      fileName: newFileName,
      fileMimeType: newMime,
      fileSizeBytes: newSize,
      verificationStatus: statusReset ? "pending_verification" : existing.verificationStatus,
      lastDestructiveEditAt: isDestructive ? new Date() : existing.lastDestructiveEditAt,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(and(
      eq(statement.id, existing.id),
      // Closes the read-then-write race: scheduler can't sneak in between
      // the initial mutability check and this write.
      inArray(statement.verificationStatus, [
        "pending_verification",
        "success",
        "failed",
      ] as any),
    )).returning({ id: statement.id });

    if (updated.length === 0) {
      // Race: verification status changed under us (scheduler flipped to queued
      // or in_progress). Roll back the Drive ops we did.
      await rollbackDriveOps({
        fileChanging,
        claimChanging,
        newDriveFileId,
        existing,
        newClaimRow,
      });
      return {
        error:
          "Cannot edit — verification status changed while you were editing. " +
          "Reload to see the current state.",
      };
    }

    if (claimChanging) {
      await db.update(claim).set({ status: "awaiting_statement" }).where(eq(claim.id, existing.claimId));
      await db.update(claim).set({ status: "statement_attached" }).where(eq(claim.id, parsed.data.claimId));
    }
  } catch (err) {
    console.error(`[updateStatement] DB update failed:`, err);
    if (oldFileToDeleteAfterCommit !== null) {
      // We already uploaded the replacement. Roll it back so the user retains the original.
      try { await deleteDriveFile(newDriveFileId); } catch {}
    }
    return { error: "Database error while updating statement." };
  }

  // Now safe to delete the prior Drive file (we did this only on file replacement).
  if (oldFileToDeleteAfterCommit) {
    try {
      await deleteDriveFile(oldFileToDeleteAfterCommit);
    } catch (cleanupErr) {
      console.warn(`[updateStatement] Could not delete old Drive file (fileId=${oldFileToDeleteAfterCommit}). Manual cleanup needed:`, cleanupErr);
    }
  }

  revalidatePath("/claims/statements");
  revalidatePath(`/claims/statements/${existing.id}`);
  redirect(`/claims/statements/${existing.id}`);
}
```

The Drive operations run **outside** any DB transaction because they're network calls that can't be rolled back atomically. If the DB write fails after a successful Drive move (rare), the file is in the new claim's folder but the DB still says it's in the old claim — manually recoverable, and unlikely enough that the simpler control flow wins. (`deleteDriveFile` actually *trashes* via `trashed: true` rather than hard-deleting — see section 17 — so even worst-case the file is recoverable from Drive's trash.)

### 11.2.x Conditional UPDATE + Drive rollback (race-loser path)

The mutability check at the top of `updateStatement` reads `existing.verificationStatus` at one moment in time. A scheduler (or another fast-clicking user) can flip the status to `queued` or `in_progress` between that read and the final UPDATE. The conditional UPDATE — `WHERE id = ? AND verificationStatus IN ('pending_verification','success','failed')` — closes that race window: if the status flipped, zero rows match, and the action returns the same friendly error as the Layer 2 check.

By the time we know we're the race loser, however, the Drive operations have already happened. The `rollbackDriveOps` helper undoes them:

```ts
async function rollbackDriveOps(args: {
  fileChanging: boolean;
  claimChanging: boolean;
  newDriveFileId: string;
  existing: { driveFileId: string; claim: { driveStatementsFolderId: string } };
  newClaimRow: { driveStatementsFolderId: string } | null;
}): Promise<void> {
  if (args.fileChanging) {
    // We uploaded a NEW file (to whichever folder the edit was targeting).
    // Trash that new upload. The OLD file is still in its original folder,
    // untouched — we haven't run the cleanup of the old file yet (that
    // happens AFTER a successful DB commit; we never reach it on the race-loser path).
    try {
      await deleteDriveFile(args.newDriveFileId);
    } catch (err) {
      console.warn(
        `[updateStatement] Rollback: failed to trash new upload ${args.newDriveFileId}. Orphan in Drive.`,
        err
      );
    }
  } else if (args.claimChanging && args.newClaimRow) {
    // We moved the file from old claim's folder to new claim's folder.
    // Move it back. Best-effort: if this fails, the file is in the new
    // folder while the DB still points it at the old claim — manually
    // recoverable.
    try {
      await moveStatementFile(
        args.existing.driveFileId,
        args.newClaimRow.driveStatementsFolderId,
        args.existing.claim.driveStatementsFolderId
      );
    } catch (err) {
      console.warn(
        `[updateStatement] Rollback: failed to move file back to old claim's folder. ` +
          `Manual recovery needed (file is in new claim's folder but DB unchanged).`,
        err
      );
    }
  }
  // If neither fileChanging nor claimChanging: no Drive op happened, nothing to roll back.
}
```

**Failure modes after rollback:**

| Race-loser case          | Drive end-state if rollback succeeds      | Drive end-state if rollback ALSO fails (rare)                              |
|--------------------------|-------------------------------------------|-----------------------------------------------------------------------------|
| File replacement (`fileChanging`) | Old file in old folder; new file trashed. DB unchanged. Clean. | Old file in old folder; new file lingers in target folder. Recoverable via Drive trash for ~30 days, no data loss. |
| Claim re-link without new file (`claimChanging` only) | File moved back to old claim's folder. DB unchanged. Clean. | File stuck in new claim's folder; DB still references it correctly via `driveFileId` (Drive URLs are keyed off file ID, not parent). User-facing: file still opens fine. Audit-facing: file is in "wrong" folder. Manual recovery via Drive UI. |
| Date-only edit           | n/a — no Drive op happened.                | n/a.                                                                       |

In all cases, the **DB state is correct** post-rollback because the conditional UPDATE never committed. The user sees the friendly error and is sent back to the Detail page (via the standard form rerender + revalidatePath), where they observe the new verification status and decide what to do.

### 11.3 `startVerification` / `retryVerification`

Both are FormData-based Server Actions to match the project convention (`deleteClaim` in receipts is the precedent — it accepts `FormData` with a hidden `claimId` and is invoked via `useActionState` + a small client wrapper). Don't introduce a separate "id as positional argument" pattern.

```ts
const StatementIdInput = z.object({ statementId: z.string() });

export async function startVerification(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { statementId } = StatementIdInput.parse(Object.fromEntries(formData));

  const stmt = await db.query.statement.findFirst({
    where: eq(statement.id, statementId),
    with: { claim: true },
  });
  if (!stmt) return { error: "Statement not found." };
  if (!isStatementVisible(actor, stmt)) return { error: "Statement not found." };  // 404-ish
  if (stmt.verificationStatus !== "pending_verification") {
    return { error: "Verification has already been started." };
  }

  try {
    await transitionVerificationStatus(
      stmt.id,
      ["pending_verification"],
      "queued",
      { source: "manual_start", triggeredBy: actor.id }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "CONCURRENT_CALL") {
      // Someone else (or a double-click) already advanced it. No-op to the caller.
      revalidatePath("/claims/statements");
      revalidatePath(`/claims/statements/${statementId}`);
      return { ok: true };
    }
    throw err;
  }

  revalidatePath("/claims/statements");
  revalidatePath(`/claims/statements/${statementId}`);
  return { ok: true };
}

export async function retryVerification(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { statementId } = StatementIdInput.parse(Object.fromEntries(formData));

  const stmt = await db.query.statement.findFirst({
    where: eq(statement.id, statementId),
    with: { claim: true },
  });
  if (!stmt) return { error: "Statement not found." };
  if (!isStatementVisible(actor, stmt)) return { error: "Statement not found." };
  if (stmt.verificationStatus !== "success" && stmt.verificationStatus !== "failed") {
    return { error: "Can only retry from a terminal status." };
  }

  try {
    await transitionVerificationStatus(
      stmt.id,
      ["success", "failed"],
      "queued",
      { source: "manual_retry", triggeredBy: actor.id }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "CONCURRENT_CALL") {
      revalidatePath("/claims/statements");
      revalidatePath(`/claims/statements/${statementId}`);
      return { ok: true };
    }
    throw err;
  }

  revalidatePath("/claims/statements");
  revalidatePath(`/claims/statements/${statementId}`);
  return { ok: true };
}
```

The client side uses the same `useActionState` + `useTransition` + `formAction(fd)` pattern as `DeleteButton` in `ClaimsTable.tsx` (lines 73–86).

### 11.4 `transitionVerificationStatus` helper

**File:** `src/app/(app)/claims/statements/_actions.ts` (private helper, not exported as a Server Action). This is the **only** place in this workstream where status writes and attempt inserts happen together — both calls must succeed together, so this is one of the **few** legitimate uses of `db.transaction()` in the codebase.

**Concurrency-safe via conditional UPDATE.** The transition is **idempotent under double-click / concurrent invocation**: the UPDATE is gated by a `WHERE verificationStatus IN (...)` predicate that filters out the loser of a race. If the UPDATE affects zero rows, the helper aborts before inserting an attempt row — preventing duplicate attempt rows from a fast double-click. The caller catches the `CONCURRENT_CALL` error and returns a friendly no-op to the user (the optimistic state shown in the UI matches reality after the race winner's revalidation completes).

```ts
async function transitionVerificationStatus(
  statementId: string,
  fromStatuses: readonly ("pending_verification" | "queued" | "in_progress" | "success" | "failed")[],
  toStatus: "queued",  // this workstream only ever transitions TO queued from a user action
  opts: { source: "upload_checkbox" | "manual_start" | "manual_retry"; triggeredBy: string }
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx.update(statement)
      .set({ verificationStatus: toStatus, updatedAt: new Date() })
      .where(and(
        eq(statement.id, statementId),
        inArray(statement.verificationStatus, fromStatuses as any),
      ))
      .returning({ id: statement.id });

    if (updated.length === 0) {
      // The status changed under us (concurrent click, scheduler beat us, etc.).
      // Aborting the transaction means no attempt row is inserted.
      throw new Error("CONCURRENT_CALL");
    }

    await tx.insert(statementVerificationAttempt).values({
      statementId,
      status: toStatus,
      triggerSource: opts.source,
      triggeredBy: opts.triggeredBy,
    });
  });
}
```

**`fromStatuses` per caller** (precision matters — each caller specifies its legal source set, not a blanket "anything that isn't queued"):

| Caller (Server Action) | `fromStatuses` argument                |
|------------------------|----------------------------------------|
| Upload with checkbox (in `uploadStatement`) | n/a — inline insert during the row creation, not a transition. The helper is **not** called from `uploadStatement`. |
| `startVerification`    | `["pending_verification"]`             |
| `retryVerification`    | `["success", "failed"]`                |

So `startVerification` cannot accidentally re-queue a `success` row, and `retryVerification` cannot re-queue a `pending_verification` row. This is defense in depth — the Server Actions already pre-check, but the helper's predicate is the last line of defense and what makes the operation safe under concurrent invocation.

**Catch the CONCURRENT_CALL error in callers:**

```ts
try {
  await transitionVerificationStatus(...);
} catch (err) {
  if (err instanceof Error && err.message === "CONCURRENT_CALL") {
    // Another click / scheduler / actor already advanced the status.
    // Return ok: true with no insert — the UI revalidates and shows
    // the truth from the database.
    return { ok: true };
  }
  throw err;
}
```

Why this gets a transaction even though `uploadStatement` does not: in upload, the Drive call is the unstable step, and the DB writes happen after Drive succeeds — if step 2 fails after step 3 we already have the cleanup path. Here, both writes are DB-only, **and** the conditional UPDATE + insert must succeed atomically for the attempt log to stay coherent with the status — so a transaction is the correct primitive.

### 11.5 `deleteStatement` — hard delete (Admin / Finance only)

**Permission:** `requireRole(['admin', 'finance'])`. Employees cannot reach this action — the Delete button is not rendered for them, and the Server Action rejects Employee POSTs at the role gate.

**Capability:** Hard-delete a statement record, cascade-delete its verification attempts, trash the Drive file, and revert the parent claim's status back to `awaiting_statement` so a new statement can be uploaded. Decision recorded 2026-05-19 (see section 18).

**Status guard:** Only allowed from `pending_verification`, `success`, or `failed`. Blocked from `queued` and `in_progress` — those states have scheduler activity pending that would be left in an inconsistent state by a hard-delete.

**Cascade-deleted guard:** If the statement is already soft-deleted via the claim cascade (`statement.deletedAt IS NOT NULL`), the action refuses and directs the user to restore the parent claim first. This case shouldn't be reachable in practice (the Detail page returns 404 for soft-deleted statements, and the list filters them out) but the guard is defense-in-depth against malicious POSTs.

#### 11.5.1 Code shape

```ts
const DeleteInput = z.object({ statementId: z.string() });

export async function deleteStatement(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const actor = await requireRole(["admin", "finance"]);
  const { statementId } = DeleteInput.parse(Object.fromEntries(formData));

  const existing = await db.query.statement.findFirst({
    where: eq(statement.id, statementId),
  });
  if (!existing) {
    return { error: "Statement not found or already deleted." };
  }
  if (existing.deletedAt) {
    return {
      error:
        "This statement is part of a deleted claim. Restore the claim first " +
        "(Claims page → Show deleted → Restore) before hard-deleting.",
    };
  }
  if (!isStatementMutable(existing.verificationStatus)) {
    return {
      error:
        "Cannot delete — verification is queued or in progress. " +
        "Reload to see the current status, or wait for it to finish.",
    };
  }

  // DB writes inside a transaction. The DELETE is CONDITIONAL on the mutability
  // predicate to close the read-then-write race (scheduler could have flipped
  // the status to queued/in_progress between the read above and this write).
  // Attempts cascade-delete via the FK (§3.2).
  try {
    const deleted = await db.transaction(async (tx) => {
      const result = await tx.delete(statement)
        .where(and(
          eq(statement.id, statementId),
          inArray(statement.verificationStatus, [
            "pending_verification",
            "success",
            "failed",
          ] as any),
        ))
        .returning({ id: statement.id });

      if (result.length === 0) {
        // Race: status flipped to queued/in_progress under us. Abort the
        // transaction (the parent-status update never runs).
        throw new Error("RACE_LOSER");
      }

      await tx
        .update(claim)
        .set({ status: "awaiting_statement" })
        .where(eq(claim.id, existing.claimId));

      return result;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "RACE_LOSER") {
      return {
        error:
          "Cannot delete — verification status changed while you were preparing " +
          "the delete. Reload to see the current state.",
      };
    }
    console.error(`[deleteStatement] DB delete failed for ${existing.displayId}:`, err);
    return { error: "Database error while deleting statement. Please try again." };
  }

  // Drive trash after DB commit. Best-effort; orphan on failure is recoverable.
  try {
    await deleteDriveFile(existing.driveFileId);
  } catch (err) {
    console.warn(
      `[deleteStatement] Orphan Drive file after DB delete succeeded ` +
        `(fileId=${existing.driveFileId}, statement=${existing.displayId}). ` +
        `Manual cleanup via Drive trash.`,
      err
    );
    // Do NOT return an error — the statement is deleted from the user's POV.
    // The orphan is a soft cleanup concern, not a user-visible failure.
  }

  revalidatePath("/claims/statements");
  revalidatePath(`/claims/receipts/${existing.claimId}`);  // claim status changed
  return { ok: true };
}
```

#### 11.5.2 Ordering rationale (DB-first, then Drive)

This **deviates** from `deleteReceipt`'s pattern, which goes Drive-first. The rationale for the deviation:

| Approach                      | Worst-case failure outcome                                              |
|-------------------------------|-------------------------------------------------------------------------|
| **DB-first → Drive trash** (this spec) | DB clean; orphan file lingers in old claim's `statements/` folder. User sees the statement gone from the portal. Recoverable manually via Drive UI. |
| **Drive-first → DB** (receipts pattern) | If DB fails after Drive succeeded: the record still points at a now-trashed Drive file. User sees a broken record. They'd retry, which then trashes-an-already-trashed file (no-op) and re-deletes the row. |

For statements, the parent claim's `status` flip is a second DB write that needs to be coherent with the statement deletion — DB-first lets that be atomic via the transaction. For receipts, there's no equivalent "parent status flip," so the Drive-first pattern works fine there.

Both approaches have failure modes; we picked DB-first to keep the DB invariants coherent at the cost of accepting an occasional orphan file (recoverable for ~30 days via Drive trash). The cost asymmetry favors this choice for statements.

#### 11.5.3 Client-side confirmation

The Delete button (Detail page header AND list row trash icon) uses `window.confirm` with detailed copy, matching the `deleteClaim` pattern (`ClaimsTable.tsx:80–86`):

```ts
const msg =
  `Permanently delete statement ${stmt.displayId}?\n\n` +
  `This will:\n` +
  `• Remove the statement record and all its verification history.\n` +
  `• Move the file to Google Drive trash.\n` +
  `• Revert claim ${claim.displayId} to "Awaiting Statement"\n` +
  `  so a new statement can be uploaded.\n\n` +
  `This cannot be undone from the portal. The file in Drive trash\n` +
  `is recoverable for ~30 days.`;
if (!window.confirm(msg)) return;
```

The button itself is wired with `useActionState(deleteStatement, null)` + `useTransition()` to match the existing `DeleteButton` shape in `receipts/_components/ClaimsTable.tsx` (lines 73–86). After confirmation, the FormData is built with just the `statementId`, the action fires, and `revalidatePath` causes the row (or the detail page) to refresh.

#### 11.5.4 Redirect behavior

From the **Detail page** Delete: the action returns `{ ok: true }`; the calling component then navigates the browser to `/claims/statements` (the Detail URL would 404 after delete). Implementation: the component uses `useRouter().push('/claims/statements')` after the action settles successfully.

From the **List row** trash icon: the action returns `{ ok: true }`; `revalidatePath('/claims/statements')` re-renders the list with the row gone. No client-side navigation needed.

No flash banner, no success toast — silent success, matching the `deleteClaim` UX.

#### 11.5.5 Idempotency under double-click

The `existing` lookup is the first guard: a second click after the first has committed finds `existing = null` → returns the friendly "Statement not found or already deleted" error. The transaction is otherwise non-idempotent — but the user-facing outcome of a double-click is "the delete succeeded once, and the second click gave a benign error." No data corruption is possible.

---

## 12. Drive integration additions

The existing `src/lib/drive.ts` already exposes `uploadReceiptFile`, `deleteDriveFile`, `createClaimFolders`, etc. This workstream adds two:

### 12.1 `uploadStatementFile`

Signature mirrors `uploadReceiptFile` (positional args, returns `{ fileId, webViewLink }`). The internal `bufferToStream` helper already exists in `drive.ts` — reuse it.

```ts
export async function uploadStatementFile(
  parentFolderId: string,
  filename: string,
  file: File,
): Promise<{ fileId: string; webViewLink: string }> {
  const drive = getDriveClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [parentFolderId],
    },
    media: {
      mimeType: file.type,
      body: bufferToStream(buffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  if (!res.data.id || !res.data.webViewLink) {
    throw new Error("Drive returned an incomplete response (missing id or webViewLink).");
  }
  return { fileId: res.data.id, webViewLink: res.data.webViewLink };
}
```

Kept as a separate function from `uploadReceiptFile` (instead of being shared) so the receipt and statement upload paths can evolve independently — e.g. statement-specific virus scanning hooks later — without one accidentally breaking the other. The two functions are byte-for-byte equivalent today; that's fine.

### 12.2 `moveStatementFile`

```ts
export async function moveStatementFile(
  fileId: string,
  fromFolderId: string,
  toFolderId: string,
): Promise<void> {
  const drive = getDriveClient();
  await drive.files.update({
    fileId,
    addParents: toFolderId,
    removeParents: fromFolderId,
    fields: "id, parents",
    supportsAllDrives: true,
  });
}
```

The Drive v3 API supports moves via `addParents` + `removeParents` on `files.update`. The file's ID does **not** change, so the stored `statement.driveFileId` and `statement.fileUrl` (which is the `webViewLink`, keyed off the file ID) remain valid post-move.

### 12.3 Why no helper for "delete old + upload new in one folder"

The edit flow's "replace file" path uses `uploadStatementFile` + `deleteDriveFile` in sequence. There's no atomic Drive "replace" API — best-effort sequential calls are the only option. The upload happens first so that if Drive fails, the old file is still there.

---

## 13. Touching the Claims workstream

Two existing files in `src/app/(app)/claims/receipts/` need small additions:

### 13.1 Cascade soft-delete in `deleteClaim`

The existing `deleteClaim` Server Action in `src/app/(app)/claims/receipts/_actions.ts` (lines 206–225) **already uses `db.transaction()`** but currently only updates the claim row. Extend the transaction body to update the linked statement, if any, in the same atomic unit:

```ts
// Inside the existing db.transaction() block of deleteClaim:
await tx.update(claim).set({ deletedAt, deletedBy: actor.id }).where(eq(claim.id, claimId));
await tx.update(statement)
  .set({ deletedAt, deletedBy: actor.id })
  .where(and(eq(statement.claimId, claimId), isNull(statement.deletedAt)));
```

The transaction (and the `deletedAt` variable) already exists — only the second `tx.update(statement)` call needs to be added. Import `statement` from `@/db/schema` at the top of the file, and `and` from `drizzle-orm` (already imported in the receipts module via other actions; double-check the current import list).

### 13.2 Cascade restore in `restoreClaim`

Symmetric. The existing `restoreClaim` (lines 227–244) also wraps a single `tx.update(claim)` in `db.transaction()`. Extend it:

```ts
// Inside the existing db.transaction() block of restoreClaim:
await tx.update(claim).set({ deletedAt: null, deletedBy: null }).where(eq(claim.id, claimId));
await tx.update(statement)
  .set({ deletedAt: null, deletedBy: null })
  .where(eq(statement.claimId, claimId));
```

The `WHERE statement.claimId = ?` predicate is sufficient — this workstream never deletes statements standalone, so any statement attached to a restored claim is by definition a cascade victim. A defensive `AND deletedAt IS NOT NULL` would also work but adds no real safety.

### 13.3 No file/folder cleanup on cascade

The statement's Drive file is **left in place** when soft-deleted, exactly as the claim's Drive folder is left in place. Restoration is symmetric: the file is still there, the row's `deletedAt` is cleared, and the statement is visible again. Hard cleanup (purging Drive files for permanently-deleted records) is a separate retention-policy workstream, out of scope here.

### 13.4 Interaction between cascade soft-delete and hard-delete

The two deletion modes are independent but coordinate:

| Scenario                                                                          | Outcome                                                                                                                                                                                                |
|-----------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Hard-delete statement, then admin soft-deletes parent claim                       | Cascade UPDATE on `statement` affects zero rows (statement is gone). Claim soft-delete succeeds normally. No issue.                                                                                       |
| Admin soft-deletes claim (cascades to statement), then Admin tries hard-delete   | `deleteStatement` refuses: the statement has `deletedAt IS NOT NULL`. Error message directs Admin to restore the claim first. In practice the Delete button isn't rendered (Detail page 404s for soft-deleted statements; list filters them out), so this is a defense-in-depth guard only. |
| Hard-delete statement (this reverts claim to `awaiting_statement`)                | Parent claim's `status` is reverted in the same transaction as the statement delete. Admin can then upload a fresh statement against the claim. No restoration affordance needed; the claim was never deleted. |

### 13.5 Hard-delete is self-contained, not cascade-driven

Hard-delete fires from the **Statement Detail page or list** (not from any claim-side action). The cascade chain is:

```
deleteStatement
  ├─ DELETE FROM statement (in transaction)
  │    └─ Postgres cascade: DELETE FROM statement_verification_attempt
  ├─ UPDATE claim SET status='awaiting_statement' (in transaction)
  │
  └─ (after commit) deleteDriveFile(driveFileId) — best-effort trash
```

The parent `claim` row is **not** touched beyond the status flip. The Drive *folder* (the claim's parent folder) is **not** touched — only the statement file inside `<claim_displayId>/statements/` is trashed. Future statements uploaded against the same claim will land in the same `statements/` folder, alongside any orphan files from previous hard-deletes (if Drive-trash cleanup failed). This is acceptable — orphans are a soft concern.

---

## 14. Dashboard impact — DEFERRED

The Admin/Finance and Employee dashboards (UI spec section 4) consume statement counts and verification status breakdowns. **The dashboard wiring is explicitly out of scope for this workstream** and will be implemented in a later phase. This spec only needs to make the underlying data queryable, which it does by virtue of building the tables and indexes (sections 3.1, 3.2) — no dashboard code changes are made here.

Decision recorded 2026-05-19. The dashboard workstream will write its own queries against `statement` / `statement_verification_attempt` when it lands; no scaffolding is needed in advance.

---

## 15. Testing checklist

For the implementer's verification pass, in order of priority:

### 15.1 Upload happy path
1. As Employee with `claim.claimantId = me, claim.status = 'awaiting_statement'`: upload form shows the claim in the dropdown. Submit. Verify (a) statement row inserted, (b) claim flipped to `statement_attached`, (c) file in Drive at `<claim_displayId>/statements/`, (d) no verification-attempt row, (e) redirect to list page.
2. Same as above with checkbox checked. Verify additionally (f) verification status is `queued`, (g) one attempt row with `triggerSource = 'upload_checkbox'`.

### 15.2 Upload access control
1. Employee tries to upload against a claim where they're not the claimant — claim isn't in the dropdown. Manually POST anyway → Server Action rejects with "Not your claim".
2. Employee tries to upload against a claim with no claimant assigned — claim isn't in the dropdown (UI spec 6.1). POST anyway → "Claim has no claimant assigned".
3. Finance uploads against a claim assigned to someone else — succeeds.

### 15.3 Edit flow
1. Edit date only → verify only `statementDate` + `updatedBy/updatedAt` changed; no Drive operation.
2. Replace file → verify old `driveFileId` deleted from Drive, new file uploaded, `verificationStatus` reset to `pending_verification`, attempt rows preserved.
3. Re-link to a different awaiting claim → verify file moved (same `driveFileId`, new parent), old claim back to `awaiting_statement`, new claim `statement_attached`, status reset, attempts preserved.
4. Re-link + replace file together → all of the above.

### 15.4 Verification controls
1. From `pending_verification`, click Start (row OR detail) → verify status `queued`, new attempt row `manual_start`.
2. From `queued`, verify no Start or Retry buttons render.
3. From `success` or `failed`, click Retry on detail → verify status `queued`, **new** attempt row `manual_retry`, prior attempts still visible in the accordion.

### 15.5 Cascade delete
1. As Admin, delete a claim that has a linked statement → verify statement's `deletedAt`/`deletedBy` set in the same transaction. Statement disappears from the statements list (deletedAt filter).
2. Restore the claim → statement reappears.
3. Verify the Drive file is untouched throughout.

### 15.6 Scoping
1. As Employee, list page returns only statements where I uploaded them OR I'm the claimant on the linked claim.
2. As Employee, hitting `/claims/statements/[id]` for a statement I shouldn't see returns 404 (not 403).
3. As Admin/Finance, list page returns everything (minus deleted).

### 15.7 One-to-one constraint
1. Try to insert two statements with the same `claimId` → DB rejects the second (unique constraint on `claimId`).
2. Verify the upload Server Action's pre-check catches this with a friendly message in the normal flow (claim status check makes it impossible in practice, but the DB constraint is the last line of defense).

### 15.7.1 Edit lock during queued / in_progress (§8.5, §9.0, §11.2)
1. Open Edit form for a `pending_verification` statement. Verify the form renders fully.
2. Have someone (or the scheduler in a future test fixture) flip the status to `queued` while the form is open. Submit the form. Server Action returns "Cannot edit — verification status changed while you were editing. Reload to see the current state." (the conditional UPDATE caught the race-loser path).
3. After getting that error: verify Drive state is clean. If the form attempted a file replacement, the new upload should be trashed and the old file should still be in its original folder. If a claim re-link, the file should be back in the old claim's folder.
4. Navigate directly to `/claims/statements/[id]/edit` for a `queued` statement. Verify the page redirects to `/claims/statements/[id]?notice=locked` and the Detail page renders the amber banner. Click `[×]` on the banner — URL clears, banner disappears.
5. Same direct-navigation test for `in_progress`. Same outcome.
6. As Admin: confirm the lock applies. The Edit button on the Detail header should be hidden, the Edit URL should redirect, and the Server Action should reject. No override.
7. Soft-delete the parent claim while its statement is `queued`. Verify the cascade still updates `statement.deletedAt` (the lock does not block cascade soft-delete per §8.5 exemption).
8. Verify the Detail header for a `queued` or `in_progress` statement shows **zero action buttons** — no Edit, no Start, no Retry, no Delete. Only the status badge.

### 15.7.2 Edit happy path returns to working order
1. `success` statement: open Edit, replace file, save. Verify status resets to `pending_verification`, `lastDestructiveEditAt` is set, attempts preserved, Edit button reappears.
2. From `pending_verification` after the above: click Start Verification → status `queued` → Edit button disappears.
3. Wait (or simulate) the scheduler transitioning to `success`. Verify Edit button reappears.

### 15.8 Hard-delete (Admin / Finance only)
1. As Admin, on a `success` statement: click Delete in the Detail header → confirm prompt → confirm. Verify (a) statement row gone, (b) all `statement_verification_attempt` rows for it gone (cascade), (c) parent claim `status` reverted to `awaiting_statement`, (d) Drive file is in Drive trash, (e) user redirected to `/claims/statements`.
2. Same flow from the list row trash icon — no redirect, just row disappears.
3. As Finance, repeat (1) — same outcome.
4. As Employee uploading the statement themselves: verify the Delete button is **not rendered** on the Detail page or in the list row. POST to `deleteStatement` directly → role gate redirects to `/dashboard`.
5. Click Delete on a `queued` statement → action returns "Cannot delete — verification is queued or in progress" error. Verify row is untouched.
6. Click Delete on an `in_progress` statement → same error.
7. Click Delete on a `pending_verification` statement → succeeds (no verification activity to disrupt).
8. Click Delete on a `failed` statement → succeeds.
9. **Double-click race:** click Delete twice in rapid succession. First click succeeds; second click sees `existing = null` → "Statement not found or already deleted."
10. **Status race:** simulate a status change between Delete-click and Server Action execution (e.g. another user clicks Start Verification just before). Server Action's status guard fires → friendly error.
11. **Cascade-deleted guard:** manually set `statement.deletedAt` (or soft-delete its claim), then attempt `deleteStatement` via crafted POST. Action refuses with "part of a deleted claim" error.
12. **Drive failure tolerance:** mock `deleteDriveFile` to throw. DB transaction has already committed; statement is gone from the DB. Verify a console warning is logged, but the action still returns `{ ok: true }` (user sees success). Verify the Drive orphan exists in the original folder and can be manually trashed.
13. **DB failure rollback:** mock the `tx.update(claim)...` to throw. Verify the `tx.delete(statement)` is also rolled back (statement row still exists), the action returns the DB-error message, and the Drive file is still in place (Drive call never happened because of the early throw).
14. **Re-upload after delete:** Admin deletes a statement; verify the parent claim is `awaiting_statement` and can receive a fresh upload via the normal flow. New statement gets a fresh `displayId` (e.g. `STM-043` if previous deleted was `STM-042`) — sequence numbers do **not** reset on delete.

---

## 16. Open questions deferred to implementation

None. The spec is intended to be implementation-ready. Two items confirmed against the codebase (no longer open):

1. **Drive folder name plurality.** Confirmed in `src/lib/drive.ts:71` — `createClaimFolders` creates a subfolder named `"statements"` (plural). All references in this spec to `<claim_id>/statements/` match what's on disk. The `claim.driveStatementsFolderId` column is the authoritative pointer.
2. **Table naming convention.** Confirmed singular across the codebase (`claim`, `receipt`, `entity`, `user`, `department`, `class`). This spec follows the same: `statement` (singular), `statement_verification_attempt` (singular). No change.

---

## 17. Code-alignment audit (post-implementation review)

This section was added after auditing the spec against the actual `master` branch state. It captures conventions discovered in the codebase that the spec didn't initially encode, and notes the corrections that have been folded in above. Treat it as the definitive style guide for the implementation pass.

### 17.1 Server Action return shape

**Convention:** `type ActionResult = { error: string } | { ok: true } | null;` exported as a local type alias in every `_actions.ts` file. **Not** the `{ ok: false, error }` shape some earlier sketches in this spec implied — those have been corrected in sections 11.1–11.3.

Forms consume via:
```ts
const [state, formAction, pending] = useActionState(action, null as ActionResult);
```
Error rendering checks `state && "error" in state`. Reference: `CreateClaimForm.tsx:29`, `ReceiptForm.tsx:45`.

### 17.2 Validation

**Convention:** `zod` schemas with `safeParse(Object.fromEntries(formData))`. Return `{ error: parsed.error.errors[0].message }` on failure. Do not use `formData.get(...) as string` ad-hoc — pipe everything through zod. Reference: every action in `claims/receipts/_actions.ts` and `claims/receipts/[id]/_actions.ts`.

For checkboxes, the FormData entry is the string `"on"` when checked, absent when unchecked. The spec uses a `z.preprocess` to coerce — see `UploadInput` in section 11.1.

### 17.3 Transactions

**Convention:** `db.transaction(...)` is used **sparingly** and only for purely-DB invariants. The receipts module uses `db.transaction()` in exactly two places:
- `deleteClaim` / `restoreClaim` — wraps the soft-delete writes (and now the cascade to `statement`, per section 13).
- (no others)

`createClaim`, `updateClaim`, `createReceipt`, `updateReceipt` all use **sequential ops + cleanup** because each involves a Drive call that can't participate in a DB transaction. This spec's `uploadStatement` (11.1) and `updateStatement` (11.2) follow the same convention.

The one new transaction this workstream adds is `transitionVerificationStatus` (11.4), which is DB-only.

### 17.4 Drive client API surface

The actual exports from `src/lib/drive.ts` (verified):

| Export                  | Signature                                                                                | Notes                                                              |
|-------------------------|------------------------------------------------------------------------------------------|--------------------------------------------------------------------|
| `createClaimFolders`    | `(displayId: string) => Promise<ClaimFolderHandles>`                                     | `ClaimFolderHandles = { parentId, receiptsId, statementsId, netsuiteId, receiptsUrl }` |
| `renameFolder`          | `(folderId: string, newName: string) => Promise<void>`                                   | Used by `updateClaim` on period change.                            |
| `uploadReceiptFile`     | `(parentFolderId: string, filename: string, file: File) => Promise<{ fileId: string; webViewLink: string }>` | **Positional args**, returns `webViewLink` (not `fileUrl`).        |
| `downloadDriveFile`     | `(fileId: string) => Promise<{ stream, mimeType }>`                                       | Used for in-app file viewing.                                       |
| `deleteDriveFile`       | `(fileId: string) => Promise<void>`                                                       | **Trashes via `trashed: true`**, not hard delete. Safer for accidents. |
| `bufferToStream`        | internal helper                                                                           | `require("node:stream").Readable.from(buffer)`. Reuse — don't re-import `Readable` at module top. |
| `getDriveClient`        | internal                                                                                  | JWT auth with `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`. |
| `grantEditorPermission` | internal                                                                                  | Used by `createClaimFolders` to grant `AUTHORIZED_USERS`.            |

**Implications for this spec:**
- `uploadStatementFile` (12.1) follows the positional-args + `webViewLink` return convention.
- `moveStatementFile` (12.2) is new — adds to `drive.ts`. Use `addParents`/`removeParents` per Drive v3.
- The DB column `statement.fileUrl` stores what Drive calls `webViewLink`. Map at the call site, not by renaming the Drive return.
- `deleteDriveFile`'s "trash, not delete" behavior means orphan cleanup is forgiving — a failed cleanup leaves a recoverable file in Drive's trash, not data loss.

### 17.5 Drizzle query style

Two patterns coexist in the codebase:

**Relational queries (`db.query.X.findMany({ with: ... })`)** — used in `receipts/[id]/page.tsx`, `receipts/[id]/_lib/access.ts`. Cleaner for joins. Requires the relevant relation to be declared in `src/db/schema/relations.ts`.

**Builder queries (`db.select(...).from(...).leftJoin(...)`)** — used in `receipts/page.tsx` for the list page, with `alias()` from `drizzle-orm/pg-core` to disambiguate self-joins (e.g. `claimantAlias`, `deletedByAlias`).

**For statements:**
- The list page (section 6.4) should use the **builder** pattern with `alias()` (matches `receipts/page.tsx` for consistency on list-style queries with multiple optional filter joins).
- The detail page (section 10) should use the **relational** pattern with a `with: { claim, uploadedByUser, attempts }` clause (matches `receipts/[id]/page.tsx`).

The spec's section 6.4 code example uses relational queries for brevity but should be re-written to match the receipts list-page builder pattern during implementation. Either works functionally — pick the one that matches the analogous file.

### 17.6 Relations file additions

`src/db/schema/relations.ts` currently declares: `claimRelations`, `receiptRelations`, `departmentRelations`, `classRelations`, `entityRelations`. Statements needs:

```ts
export const statementRelations = relations(statement, ({ one, many }) => ({
  claim: one(claim, { fields: [statement.claimId], references: [claim.id] }),
  uploadedByUser: one(user, { fields: [statement.uploadedBy], references: [user.id], relationName: "statementUploadedBy" }),
  updatedByUser: one(user, { fields: [statement.updatedBy], references: [user.id], relationName: "statementUpdatedBy" }),
  deletedByUser: one(user, { fields: [statement.deletedBy], references: [user.id], relationName: "statementDeletedBy" }),
  attempts: many(statementVerificationAttempt),
}));

export const statementVerificationAttemptRelations = relations(statementVerificationAttempt, ({ one }) => ({
  statement: one(statement, { fields: [statementVerificationAttempt.statementId], references: [statement.id] }),
  triggeredByUser: one(user, { fields: [statementVerificationAttempt.triggeredBy], references: [user.id], relationName: "attemptTriggeredBy" }),
}));
```

And extend `claimRelations` with `statement: one(statement, ...)` — Drizzle's `one(...)` on the parent side of a unique FK reads naturally for 1:1.

The `relationName` strings must be unique across the user table's relations (the `claimant`, `receiptUploadedBy`, etc. relations already use this disambiguation pattern). Pick fresh strings for the four new ones above.

### 17.7 Permissions registry

`src/lib/permissions.ts` has a `canAccess(role, route)` map. `"/claims/statements"` is **already listed** with `["admin", "finance", "employee"]` access — no change needed. Detail and edit routes (`/claims/statements/:id`, `/claims/statements/:id/edit`, `/claims/statements/new`) are not in the map, but per the file's pattern only top-level pages are listed; nested routes inherit access via the `requireRole` calls in each page file. Mirror this for statements.

### 17.8 Detail-page inline form pattern

The receipts module mixes patterns: **claim edit** lives at a separate route (`receipts/[id]/edit/page.tsx`), while **receipt add/edit** is inline on the claim detail page via `?action=add-receipt|edit-receipt&rid=...` search params (`receipts/[id]/page.tsx:46–80`).

The statement spec uses **only** the separate-route pattern (`statements/[id]/edit/page.tsx`) because:
- A statement is a top-level entity (like a claim), not a child entity (like a receipt within a claim).
- The mock (HTML mock line 1463: `<div id="statements-form">`) is a peer-level page-swap UI, not a child-of-detail inline form — separate routes give the same UX.

Do **not** introduce a `?action=edit` search param on the Detail page for statements. Use the dedicated `[id]/edit/` route.

### 17.9 Filename sanitization on Drive

The receipts module sanitizes filenames before they hit Drive: `name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200)`, prefixed with the receipt's UUID (`${receiptId}_${sanitized}`). This protects against Drive name collisions and weird characters in user-submitted filenames.

The statement spec (section 11.1) follows the same: `${statementId}_${sanitizeFilename(file.name)}`. The `sanitizeFilename` helper should be re-defined inline in `statements/_actions.ts` to avoid coupling — or extracted to a shared `src/lib/files.ts` later (out of scope here).

### 17.10 Confirms in the client layer

Deletes / destructive ops in the receipts module use `window.confirm(...)` in the client (e.g. `ClaimsTable.tsx:80–82` for the delete claim flow). They are **not** custom modals — UI spec section 12 forbids modal dialogs for forms, but `window.confirm` for destructive confirmations is fine and is the established pattern.

For statements: the "Replace file will permanently delete from Drive / Change linked claim will revert old claim" guidance is implemented as the **amber banner at the top of the Edit form** (section 9.2), not as a `window.confirm` on save. No confirm dialog is needed in the statement edit flow — the banner is the user contract.

### 17.11 `requireRole` redirect behavior

`requireRole(...)` from `src/lib/session.ts` redirects to `/dashboard` (not 403) when the role check fails, and to `/login` when there's no session. This is "soft access denial" — combined with the section 10.1 directive that data-scoping mismatches return `notFound()`, the UX is: the user either gets the page or gets bounced to dashboard / 404. Nothing in this workstream changes that contract.

### 17.12 Migration filename convention

Generated migrations live in `drizzle/` with Drizzle Kit's slugged-noun naming (e.g. `drizzle/0003_nappy_doctor_spectrum.sql` per memory). Don't hand-name the new statement migration; let `drizzle-kit generate` pick. The expected output: one migration adding both new tables, both new enums (`statement_verification_status`, `statement_verification_trigger_source`, `statement_verification_attempt_status`), the new sequence (`statement_seq`), and the new FK indexes.

### 17.13 Test fixtures and seed

No seed file changes are needed. The receipts module ships with no seed data either — claims and receipts are created via the UI. Statements follow suit.

### 17.14 Things this audit confirms are NOT issues

These were flagged as "verify" points but are now confirmed correct in the spec:

- **All three roles can access `/claims/statements`** — `permissions.ts:6` already declares this.
- **`statementId` on edit form** — the receipts module uses hidden `<input name="receiptId" ...>` in `ReceiptForm.tsx:71`; statements follow the same with `name="statementId"`.
- **The `claim.driveStatementsFolderId` column is populated for every claim ever created** — `createClaim` in receipts/_actions.ts:62–73 sets it unconditionally; the spec's assumption that "the column is non-null" holds.
- **`crypto.randomUUID()` is used for IDs without import** — Node 19+ globalizes `crypto`; receipts uses it via the schema default (`$defaultFn`) AND inline (`_actions.ts:68`). Both patterns are valid; the spec uses the inline form in `uploadStatement` (section 11.1) so the UUID can be reused in the Drive filename before the DB insert.

---

## 18. Decisions log (grilled & resolved)

A `grill-me` session on 2026-05-19 walked the spec's decision tree and recorded explicit answers to ambiguous or branching design questions. Each row below is the resolution; the section number cross-references where the decision is encoded in the spec body.

| # | Topic                                              | Decision                                                                                                       | Spec section            |
|---|----------------------------------------------------|----------------------------------------------------------------------------------------------------------------|-------------------------|
| 1 | Statement displayId format                         | `STM-NNN` (period-agnostic, never re-numbers on edit). Matches UI mock.                                         | 3.1                     |
| 2 | Standalone statement delete                        | ~~Not supported~~ **Superseded by #28** (2026-05-19). Hard-delete added for Admin + Finance.                    | 1, 11.5, 13             |
| 3 | Drive filename                                     | `<statementId>_<sanitizedOriginal>` (mirrors receipts).                                                         | 11.1                    |
| 4 | Edit ordering when file AND claim both change      | Upload new → DB write → trash old. Skip the move (waste of I/O). Best-effort cleanup of the orphan.            | 9.3 (matrix + 9.3 notes)|
| 5 | Concurrent upload race                             | Catch unique-violation on `statement_claim_id_unique`, surface friendly error.                                  | 11.1                    |
| 6 | Visibility on claim reassignment                   | Current claimant only. Original claimant loses visibility once reassigned (unless they were the uploader too). | 5.1                     |
| 7 | Stale attempt UI on Detail page                    | Visual "Stale" chip + banner in expanded panel.                                                                 | 10.4, 10.4.1            |
| 8 | Stale detection rule                               | Compare `attempt.createdAt < statement.lastDestructiveEditAt`. New column added.                                | 3.1, 9.3.1, 10.4.1      |
| 9 | Start/Retry idempotency                            | Conditional UPDATE inside transaction (`WHERE status IN fromStatuses`). On zero rows, throw `CONCURRENT_CALL`; caller catches and returns ok-noop. | 11.4                    |
| 10| URL scoping                                        | Server-side scoping from session. URL stays clean. Filters layer on top.                                        | 6.4 (server query)      |
| 11| Employee no eligible claims                        | Empty-state on Upload form, role-aware copy. Employee + Admin/Finance variants.                                  | 7.1.1                   |
| 12| Admin/Finance no eligible claims system-wide       | Same empty-state pattern with copy directing to "Create a Claim".                                               | 7.1.1                   |
| 13| Cascade Drive behavior                             | Leave the file in place. Drive is untouched on cascade soft-delete.                                              | 3.4, 13.3               |
| 14| MIME validation                                    | Browser-reported MIME only, narrow allowlist (PDF / JPEG / PNG, no HEIC).                                       | 2.2, 7.1                |
| 15| Filter dropdown statuses                           | All 5 statuses + default "All". Matches UI mock.                                                                 | 6.1                     |
| 16| Employee edit/start permission rule                | **OR** (uploadedBy OR claimantId). Looser than the originally-proposed AND. Decision overrides the AND text in the spec body. | 5.1                     |
| 17| `lastDestructiveEditAt` initial value              | NULL on insert. Set only on file-replace or claim-relink in `updateStatement`.                                  | 3.1, 9.3.1              |
| 18| Detail page for deleted statement                  | 404 for all roles, including Admin. Recovery is via the Claims module's restore flow.                            | 10.1                    |
| 19| Migration slicing                                  | One single migration covering both tables, sequence, enums, and the new `lastDestructiveEditAt` column.          | 3.5                     |
| 20| Empty accordion item rendering                     | Expandable with placeholder copy ("Awaiting scheduler pickup …").                                                | 10.4                    |
| 21| Checkbox FormData transport                        | Standard HTML checkbox; zod preprocess for `"on"` / absent.                                                      | 11.1 (`UploadInput`)    |
| 22| List page sort tiebreaker                          | `statement_date DESC, upload_date DESC, id DESC`. Deterministic when month-end statements share a closing date.  | 6.1                     |
| 23| Date range filter column                           | **Toggleable** (`?dateField=statement|upload`, default `statement`). Deviates from UI mock; documented as such.   | 6.1                     |
| 24| Search field scope                                 | Narrow: `statement.displayId`, `claim.displayId`, `claim.description`. Does NOT match claimant name.             | 6.1                     |
| 25| List page columns                                  | Match the mock exactly. No `Uploaded By` column in the list.                                                     | 6.2                     |
| 26| `revalidatePath` style                             | Bare string paths, matching the receipts module. No typed-revalidation API.                                       | 11.1 / 11.2 / 11.3      |
| 27| Dashboard wiring                                   | **Deferred entirely.** Section 14 reduced to a "deferred" marker. Dashboard team owns it later.                  | 14                      |

### 18.1 Hard-delete decisions (grilled 2026-05-19, round 2)

A second `grill-me` session resolved the hard-delete feature added per user request: *"Admin and Finance should be given the option to hard delete the statement record: Remove record from related tables; Remove uploaded file from google drive."*

| #  | Topic                                                | Decision                                                                                                                                                            | Spec section            |
|----|------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------|
| 28 | Standalone hard-delete \[supersedes #2\]             | Admin + Finance can hard-delete (DB row + cascade attempts + trash Drive file + revert claim status). Allowed from `pending_verification`, `success`, `failed`. Blocked on `queued`, `in_progress`, or cascade-deleted statements. | 1, 11.5, 13.4, 13.5     |
| 29 | Action name                                          | `deleteStatement` (matches `deleteReceipt` convention; semantics are per-entity).                                                                                  | 11.5                    |
| 30 | Permission scope                                     | Admin + Finance only. Employees never delete, even if they uploaded.                                                                                                | 5.1, 11.5               |
| 31 | Drive file removal strictness                        | Trash via existing `deleteDriveFile` (recoverable for ~30 days). No hard-delete API call on Drive.                                                                  | 11.5, 13.5              |
| 32 | Attempts FK strategy                                 | `ON DELETE CASCADE` on `statement_verification_attempt.statementId`. Postgres deletes attempts atomically with the statement.                                       | 3.2, 11.5               |
| 33 | Operation ordering                                   | DB transaction first (delete statement, revert claim status), then best-effort Drive trash. **Deviates from `deleteReceipt`'s Drive-first pattern** — rationale in section 11.5.2. | 11.5.2                  |
| 34 | Status guard                                         | Block hard-delete when status is `queued` or `in_progress`. Allow on `pending_verification`, `success`, `failed`.                                                   | 11.5                    |
| 35 | Confirmation UX                                      | `window.confirm` with detailed three-bullet copy (record + Drive trash + claim revert).                                                                              | 11.5.3                  |
| 36 | Button locations                                     | Two surfaces: Detail page header (next to Edit/Retry/Start) AND list row Actions cell (trash icon). Both Admin/Finance-only.                                         | 6.2, 10.3, 11.5.3       |
| 37 | Cascade-deleted guard                                | Block hard-delete when `statement.deletedAt IS NOT NULL`. Direct user to restore the parent claim first. Defense-in-depth — UI doesn't render the button in that state anyway. | 11.5, 13.4              |
| 38 | Post-delete feedback                                 | Silent. Detail Delete redirects to list. List trash icon refreshes via `revalidatePath`. No flash/toast.                                                              | 11.5.4                  |
| 39 | Error message copy                                   | Two distinct user-facing errors: "Statement not found or already deleted." and "Cannot delete — verification is queued or in progress. Reload to see the current status." | 11.5.1                  |

### 18.2 Edit-lock decisions (grilled 2026-05-19, round 3)

A third `grill-me` session resolved the edit-lock feature added per user request: *"Nobody can edit statement e.g. reupload or change any parameter when it is in queued or in progress state."*

| #  | Topic                                                | Decision                                                                                                                                                            | Spec section            |
|----|------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------|
| 40 | Scope of the edit lock                               | All three Edit-form fields (re-upload, change closing date, re-link claim) are blocked when status is `queued` or `in_progress`. No carve-outs.                       | 8.5, 9.0, 11.2          |
| 41 | Role exemptions                                      | **No exemptions.** Admin is also blocked. "Nobody" means nobody.                                                                                                     | 8.5, 9.0, 11.2          |
| 42 | Layered enforcement                                  | Two layers: (a) Edit page server component redirects when status is non-mutable; (b) Server Action checks status AND uses conditional UPDATE to close the read-then-write race. | 9.0, 11.2.x             |
| 43 | Banner UX on Edit-page redirect                      | Redirect to `/claims/statements/[id]?notice=locked`. Detail page renders an amber banner with a `[×]` dismiss. Pure URL-state; no cookies.                              | 9.0                     |
| 44 | Cascade soft-delete vs. lock                         | Cascade exempt. `deleteClaim` (parent action) still flips `statement.deletedAt` even for `queued`/`in_progress` statements. Scheduler workstream must tolerate finding statements in a soft-deleted state. | 8.5, 13.4                |
| 45 | Mutable source states                                | `pending_verification`, `success`, `failed`. Same set as hard-delete (#34). Extracted as `isStatementMutable(status)` shared helper.                                  | 8.5, 11 intro           |
| 46 | Race-loser Drive rollback                            | On conditional-UPDATE 0-row outcome: trash the new upload (file-replace path) or move the file back to the old claim's folder (claim-relink path). Best-effort; failure leaves an orphan recoverable from Drive trash. | 11.2.x                  |
| 47 | Out-of-band Drive edits                              | **Out of scope.** AUTHORIZED_USERS could still modify files directly in Google Drive; the portal cannot prevent this. Documented as a known boundary in §8.5.          | 8.5                     |
| 48 | Detail header buttons during lock                    | **None** render — no Edit, no Start, no Retry, no Delete. Only the status badge.                                                                                       | 10.3                    |
| 49 | Shared `isStatementMutable` location                 | In `src/app/(app)/claims/statements/_lib/mutability.ts` — pure helper, server+client safe. Imported by `_actions.ts` AND client components.                          | 4, 11 intro             |

**How to use this log:** during implementation, if a question arises that this spec doesn't answer, check section 18 first — many follow-up questions are anticipated here. If a question isn't covered, surface it for another grill-me round rather than guessing.
