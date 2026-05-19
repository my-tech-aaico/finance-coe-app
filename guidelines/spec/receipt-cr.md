# Implementation Spec — Receipts (First-Class Records)

**Project:** COE Finance Claims Portal
**Scope:** The Receipts feature, redesigned as first-class database records. Every receipt has structured metadata (date, amount, currency, USD equivalent, department, class, uploader) plus a single file stored in Google Drive. Receipts are children of Claims. This spec also covers the Claim Detail page (new), the Edit Claim flow (relocated), the Entity `currency` field (added), and the FX rate scheduler subsystem (new).

**Stack:** Next.js App Router · TypeScript · Better Auth · Drizzle ORM · PostgreSQL · Google Drive (service account) · Railway (deployment + cron).

**Replaces:** the earlier `receipt.md` spec, which framed Receipts as "a page that lists Claims and surfaces Drive folder links." That model is superseded. The pieces from the earlier spec that survive — the `claim` table, the bigint sequence, `YYMM-CLM-XXX` formatting, the Drive folder structure with three subfolders, the claim soft-delete pattern, the Drive permissioning rules — are restated here in full so this spec stands alone.

---

## 1. What's changing

Previously, a Claim was a Google-Drive-folder dropping ground. Finance created the Claim, shared the folder link, and people manually dumped receipt files into Drive with no portal-side tracking. The portal's "Receipts" page just listed Claims and surfaced their Drive folder URLs.

**New behavior:** Receipts become first-class records in the portal. Each Claim is a *container* that holds many Receipts. Each Receipt has:

- A receipt date (when the expense was incurred)
- An amount in local currency (the entity's currency)
- A USD-equivalent amount computed via the FX scheduler
- A department reference (`Engineering`, `Marketing`, etc.)
- A class reference (`Travel`, `Meals`, etc.)
- A single file uploaded through the portal to Google Drive
- An uploader (the user who created the receipt)

The sidebar's "Receipts" page still lists Claims, but each Claim row now navigates to a new **Claim Detail page** (`/claims/receipts/[id]`) which owns receipt CRUD inline. The previous inline Edit Claim form moves to the Detail page's header.

### 1.1 New / changed at a glance

1. **Receipt is a new database entity** (`receipt` table) with full metadata.
2. **Receipt file upload happens through the portal** — Server Action accepts FormData, uploads to Drive via the service account, stores `fileUrl`/`fileName` on the row.
3. **Claim Detail page** is a new route. Replaces the inline Edit Claim form as the home for editing a Claim and managing its Receipts.
4. **Departments admin page** exists — see `departments-spec.md`.
5. **Classes admin page** exists — see `classes-spec.md`.
6. **Entity model gains `currency`** (ISO 4217 code, e.g. `MYR`).
7. **FX subsystem** — an hourly scheduler fetches USD rates per active currency and stores them in `fx_rate`. Receipt creation reads from this table; never calls the FX provider directly.
8. **Three-mode permission model** — Admin/Finance, Employee-own-claim, Employee-other-claim (filtered to own receipts). The three modes drive what renders on the Detail page.
9. **Hard-delete for receipts** (DB row + Drive file). Soft-delete for claims continues; claim soft-delete *does not* cascade to receipts (receipts untouched).

### 1.2 What's NOT in scope

- **Statement upload, verification queue, NetSuite integration.** Separate workstreams. The `statements/` and `netsuite/` Drive subfolders are provisioned now so those workstreams have somewhere to land.
- **Bulk receipt import** (CSV upload). Hand-entered one at a time only.
- **Receipt-level audit log** beyond `uploadedBy`/`updatedBy`. A change history table is deferred.
- **Currency conversion for non-USD reporting.** The portal computes USD for each receipt; rollups in other currencies are out of scope.

---

## 2. Prerequisites

This section additive over what the auth foundation and earlier specs already established.

### 2.1 Environment variables (new ones for this workstream)

| Variable                       | Example                                                  | Purpose                                                                                       |
|--------------------------------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| `FX_PROVIDER_URL`              | `https://open.er-api.com/v6/latest`                       | Base URL for the FX rate provider. Scheduler appends the source currency code.                |
| `FX_PROVIDER_API_KEY`          | (empty, or a paid-tier key)                                | If using a keyed provider (e.g. exchangerate-api.com). Optional.                              |
| `FX_TARGET_CURRENCY`           | `USD`                                                     | The currency all receipts are converted to. Fixed at USD for this version.                    |
| `RECEIPT_FILE_MAX_BYTES`       | `10485760`                                                | 10 MiB. Server-side limit on receipt file uploads.                                            |
| `RECEIPT_FILE_ALLOWED_TYPES`   | `application/pdf,image/jpeg,image/png,image/heic`         | Comma-separated MIME types accepted by the upload Server Action.                              |

All other Drive and auth env vars from earlier specs are unchanged.

### 2.2 Railway cron job (FX scheduler)

The scheduler runs as a separate Railway service with a cron schedule. Configuration:

- **Service type:** Cron / scheduled
- **Schedule:** `0 * * * *` (top of every hour)
- **Command:** `npm run fx-scheduler` (which executes `tsx src/scripts/fx-scheduler.ts`)
- **Env:** same `DATABASE_URL` + `FX_PROVIDER_*` as the app service
- **Timeout:** 5 minutes (the script should finish in under 30 seconds in practice)

If Railway's cron service isn't available in your plan tier, fall back to a Vercel-style approach: a Next.js Route Handler at `/api/cron/fx-scheduler` protected by a shared secret, triggered by an external scheduler (e.g. Upstash Cron, Cloudflare Cron Triggers). The script content is identical; only the invocation pattern changes.

### 2.3 npm packages

Already-present packages (no change): `next`, `react`, `better-auth`, `drizzle-orm`, `drizzle-kit`, `zod`, `googleapis`, `google-auth-library`.

Additions for this workstream:

```bash
npm install date-fns                          # date math for receipt dates and FX freshness
npm install --save-dev tsx                    # to run the FX scheduler script standalone
```

No new HTTP client — `fetch` is sufficient for the FX provider.

---

## 3. Data model

### 3.1 `entity` — added column

The existing entity table (from `entities-management-spec.md`) gains one column:

| Column     | Type        | Notes                                                                                                |
|------------|-------------|------------------------------------------------------------------------------------------------------|
| `currency` | `text`, not null | ISO 4217 currency code, e.g. `MYR`, `SGD`. Three uppercase letters. Validated by Zod regex `/^[A-Z]{3}$/`. |

**Migration:** ALTER TABLE adds the column as nullable, backfills from a hardcoded map, then sets NOT NULL.

```sql
-- Generated by drizzle-kit, plus manual backfill step:
ALTER TABLE entity ADD COLUMN currency text;
UPDATE entity SET currency = 'MYR'  WHERE country = 'MY';
UPDATE entity SET currency = 'SGD'  WHERE country = 'SG';
UPDATE entity SET currency = 'HKD'  WHERE country = 'HK';
UPDATE entity SET currency = 'PHP'  WHERE country = 'PH';
UPDATE entity SET currency = 'AED'  WHERE country = 'AE';
ALTER TABLE entity ALTER COLUMN currency SET NOT NULL;
```

If any rows have a country outside the {MY, SG, HK, PH, AE} set, the migration fails loudly and a manual fix is required before retry. Don't silently default to USD or skip rows.

**Entities Management spec also gains a "Currency" form field** when creating or editing an entity. Update `entities-management-spec.md` separately to reflect this (or treat this section as the addendum).

**Currency editability:** the `currency` field is **editable, with a confirm dialog**, same pattern as the entity `code`. However, the confirm dialog is louder for currency because of the audit consequence:

> *"Change the currency from `MYR` to `SGD`? This entity has 47 receipts already recorded under MYR. Existing receipts will continue showing MYR (the currency they were uploaded under). New receipts will be in SGD. Continue?"*

This is enabled by the `currency_code` denormalization on receipts (section 3.3 below).

### 3.2 `claim` table — preserved from earlier `receipt.md` spec

The `claim` table is **unchanged** from the previous specification. Restating it here for completeness:

**File:** `src/db/schema/claim.ts`

| Column                        | Type                                                          | Notes                                                                                                  |
|-------------------------------|---------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `id`                          | `text` (uuid), primary key                                    | Internal identifier. Used as FK from `receipt.claimId`.                                                |
| `displayId`                   | `text`, unique, not null                                       | The human-readable Claim ID, format `YYMM-CLM-XXX`, regenerated when period changes. Example: `2605-CLM-001`. |
| `sequenceNumber`              | `bigint`, unique, not null, `default nextval('claim_seq')`    | Global running number from the Postgres `claim_seq` sequence. Preserved across period edits. `bigint` for ~9.2 quintillion capacity. |
| `claimMonth`                  | `integer`, not null                                            | 1–12. Editable.                                                                                        |
| `claimYear`                   | `integer`, not null                                            | E.g. 2026. Editable.                                                                                   |
| `entityId`                    | `text`, FK → `entity.id`, not null                            | Editable with confirm.                                                                                 |
| `description`                 | `text`, not null                                               | Free text. Editable.                                                                                   |
| `claimantId`                  | `text`, FK → `user.id`, nullable                              | Editable. Null when no claimant is assigned.                                                            |
| `status`                      | enum `('awaiting_statement','statement_attached')`, default `'awaiting_statement'` | System-managed. Flips when Statements workstream attaches a statement. Not editable from this module. |
| `driveFolderId`               | `text`, not null                                              | Stable Drive ID of the `2605-CLM-001/` parent folder.                                                  |
| `driveReceiptsFolderId`       | `text`, not null                                              | Stable Drive ID of the `receipts/` subfolder.                                                          |
| `driveStatementsFolderId`     | `text`, not null                                              | Stable Drive ID of the `statements/` subfolder.                                                        |
| `driveNetsuiteFolderId`       | `text`, not null                                              | Stable Drive ID of the `netsuite/` subfolder.                                                          |
| `driveReceiptsUrl`            | `text`, not null                                              | Web URL of the `receipts/` subfolder. The "Open in Drive" button on the Detail page links here.        |
| `createdBy`                   | `text`, FK → `user.id`, nullable                              |                                                                                                        |
| `createdAt`                   | `timestamp`, default `now()`                                  |                                                                                                        |
| `updatedBy`                   | `text`, FK → `user.id`, nullable                              | Last claim-level edit. Receipt-level changes update the receipt row, not the claim.                    |
| `updatedAt`                   | `timestamp`, default `now()`                                  |                                                                                                        |
| `deletedAt`                   | `timestamp`, nullable                                          | Set when soft-deleted by an Admin. Null on active claims.                                              |
| `deletedBy`                   | `text`, FK → `user.id`, nullable                              | The Admin who soft-deleted.                                                                            |

**Sequence:** `CREATE SEQUENCE claim_seq AS bigint START 1 INCREMENT 1`.

**Indexes:** unique on `sequenceNumber`, unique on `displayId`, plain on `entityId`, plain on `status`, plain on `(createdAt DESC)`, partial on `deletedAt WHERE deletedAt IS NULL`.

### 3.3 `receipt` — new table

**File:** `src/db/schema/receipt.ts`

| Column              | Type                                          | Notes                                                                                                            |
|---------------------|-----------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| `id`                | `text` (uuid), primary key                    | Internal identifier. Used in the Drive file name prefix to prevent collisions.                                   |
| `claimId`           | `text`, FK → `claim.id`, not null             | Cascade behavior: the FK uses **`ON DELETE RESTRICT`** at the DB level. Application code handles the claim-soft-delete case by leaving receipts untouched (since soft-delete doesn't trigger the FK). |
| `receiptDate`       | `date`, not null                              | When the expense was incurred (user-entered).                                                                    |
| `amountLocal`       | `numeric(15,2)`, not null                     | Amount in local currency (entity's currency).                                                                    |
| `currencyCode`      | `text`, not null                              | ISO 4217. **Denormalized** from `entity.currency` at save time. Immutable on the row after creation.             |
| `amountUsd`         | `numeric(15,2)`, not null                     | Computed at save: `round(amountLocal * fxRate, 2)`. Snapshot.                                                    |
| `fxRate`            | `numeric(15,6)`, not null                     | Snapshot from `fx_rate` at save time.                                                                            |
| `fxRateFetchedAt`   | `timestamp`, not null                         | Copied from `fx_rate.fetchedAt` at save. Lets audit trace which scheduler run produced this rate.                 |
| `departmentId`      | `text`, FK → `department.id`, not null        | See `departments-spec.md`. Editable.                                                                             |
| `classId`           | `text`, FK → `class.id`, not null             | See `classes-spec.md`. Editable.                                                                                 |
| `driveFileId`       | `text`, not null                              | Google Drive file ID. **Canonical** reference for every Drive operation (download/delete/metadata). Captured directly from `drive.files.create` at upload — never parsed out of a URL. |
| `fileUrl`           | `text`, not null                              | Google Drive `webViewLink`. Kept alongside `driveFileId` for the admin-only "Open in Drive" button and human-readable audit. Whatever URL Drive returned at upload; not synthesized. |
| `fileName`          | `text`, not null                              | Original filename (e.g. `receipt-coffee-2026-05-14.pdf`). For display in the table.                              |
| `uploadedBy`        | `text`, FK → `user.id`, not null              | Set from session at creation. Immutable.                                                                         |
| `uploadedAt`        | `timestamp`, default `now()`                  | Immutable.                                                                                                       |
| `updatedBy`         | `text`, FK → `user.id`, nullable              | Set on every edit. Null until first edit.                                                                        |
| `updatedAt`         | `timestamp`, default `now()`                  |                                                                                                                  |

**Indexes:**
- Plain on `claimId` (every receipt query is scoped by claim).
- Plain on `uploadedBy` (the Employee-other discovery query joins through this).
- Plain on `receiptDate` (for date-sorted display).

**CHECK constraints:**
- `CHECK (amount_local > 0)` — no zero or negative amounts.
- `CHECK (amount_usd >= 0)` — guard against rate corruption producing negatives.
- `CHECK (currency_code = upper(currency_code) AND length(currency_code) = 3)`.

**No soft-delete columns.** Receipts are hard-deleted per the grill (Q5). The `claimId` FK uses `RESTRICT` instead of `CASCADE` because we explicitly *don't* want claim deletion (which is always a soft-delete in the portal) to affect receipts.

### 3.4 `fx_rate` — new table

**File:** `src/db/schema/fxRate.ts`

| Column          | Type                          | Notes                                                                                  |
|-----------------|-------------------------------|----------------------------------------------------------------------------------------|
| `currencyPair`  | `text`, primary key           | Format: `<from>-<to>`, e.g. `MYR-USD`. Always uppercase.                                |
| `rate`          | `numeric(15,6)`, not null     | The multiplicative rate: `amount_in_to_currency = amount_in_from_currency * rate`.     |
| `fetchedAt`     | `timestamp`, not null         | Timestamp of the successful provider fetch that produced this rate.                    |

**One row per currency pair.** Updated by the hourly scheduler via UPSERT. Read by `createReceipt` and `updateReceipt` (when amount changes).

**Indexes:** primary key is sufficient (queries are always single-pair lookups).

### 3.5 Migration plan

Order matters. Department and Class must exist before Receipt FKs land.

1. `departments-spec.md` migration: create `department` table.
2. `classes-spec.md` migration: create `class` table (note: SQL `"class"` quoted, TS alias `class_`).
3. ALTER `entity`: add `currency text`. Backfill from country map. Set NOT NULL.
4. CREATE `fx_rate` table. Seed initial rows from a one-off script (so first deploy has rates available before the scheduler's first hourly tick). Use the FX provider directly in the seed, fail loudly if it can't be reached.
5. CREATE `receipt` table with FKs to `claim`, `department`, `class`, `user`.
6. The existing `claim` table is unchanged (assuming previous Receipts spec was implemented; otherwise create per section 3.2).

`drizzle-kit generate` produces all of the above except the entity backfill and the fx_rate seed, which are manual migration steps.

---

## 4. Routes and files

| File                                                                       | Purpose                                                                  |
|----------------------------------------------------------------------------|--------------------------------------------------------------------------|
| `src/db/schema/receipt.ts`                                                 | Drizzle table definition                                                  |
| `src/db/schema/fxRate.ts`                                                  | Drizzle table definition                                                  |
| `src/db/schema/entity.ts`                                                  | Updated to include `currency` column                                      |
| `src/lib/drive.ts`                                                         | Drive client + helpers (existing; receives new upload/delete functions)   |
| `src/lib/fx.ts`                                                            | Helper: `getCurrentRate(currencyCode)` reads from `fx_rate`               |
| `src/scripts/fx-scheduler.ts`                                              | Hourly cron entry point — fetches rates, UPSERTs `fx_rate`                |
| `src/app/(app)/claims/receipts/page.tsx`                                   | Claims list page (preserved, with delete-toggle for admins)               |
| `src/app/(app)/claims/receipts/new/page.tsx`                               | New Claim form                                                            |
| `src/app/(app)/claims/receipts/[id]/page.tsx`                              | **Claim Detail page (NEW)**                                                |
| `src/app/(app)/claims/receipts/[id]/edit/page.tsx`                         | Edit Claim form (still a separate route; navigated to from Detail page)   |
| `src/app/(app)/claims/receipts/[id]/_actions.ts`                           | Server Actions for receipts (create / update / delete) + claim delete/restore |
| `src/app/(app)/claims/receipts/_actions.ts`                                | Server Actions for claims (create / update) — preserved from prior spec  |
| `src/app/(app)/claims/receipts/[id]/_components/ClaimOverviewCard.tsx`     | Top section of Detail page                                                |
| `src/app/(app)/claims/receipts/[id]/_components/ReceiptsSummaryCard.tsx`   | Three stat tiles (count / local total / USD total)                        |
| `src/app/(app)/claims/receipts/[id]/receipts/[receiptId]/view/page.tsx` | **Receipt file viewer page (NEW)** — portal-served, auth-gated viewer |
| `src/app/api/receipts/[receiptId]/file/route.ts`                          | **Route Handler (NEW)** — streams the file bytes from Drive via service account, authorized per request |
| `src/app/(app)/claims/receipts/[id]/_components/FileViewer.tsx`           | Client component — embeds the file via `<img>` (images) or `<iframe>` (PDFs) |
| `src/app/(app)/claims/receipts/[id]/_components/ReceiptsTable.tsx`         | Table of receipts                                                         |
| `src/app/(app)/claims/receipts/[id]/_components/ReceiptForm.tsx`           | Add/Edit Receipt form (URL-param toggled into the Detail page)            |

**Routing decisions:**

- **Detail page is the "home" for a Claim.** Clicking a Claim ID or the eye icon from the list lands here.
- **Edit Claim is a separate route** (`/claims/receipts/[id]/edit`) rather than an inline sub-view. Reason: Next.js routes are cleaner, bookmarkable, and consistent with `/new`.
- **Add/Edit Receipt is a *sub-view of the Detail page* via URL params**, not a separate route. Reason: receipts are conceptually scoped to the Claim and the Detail page provides all the relevant context (entity, currency, claimant). A sub-route like `/[id]/receipts/new` would work but adds depth without benefit.
  - URL params: `?action=add-receipt` and `?action=edit-receipt&rid=<receiptId>` toggle the page into form mode.
  - When the form is active, the receipts table area is replaced by the form. The overview card and summary card remain visible.
  - On submit or cancel, the URL param is cleared and the receipts table returns.
- **Receipt file viewer is a separate route** at `/claims/receipts/[id]/receipts/[receiptId]/view`. Opens in a new browser tab from the receipts table (target="_blank"). Reasons documented in section 8.7.

---

## 5. Access control — three-mode model

Three layers as always (middleware → page → Server Action). The new wrinkle is the three rendering modes on the Detail page.

### 5.1 The permission table (locked decision from the grill)

| UI Element                | Admin / Finance | Employee (own claim) | Employee (other claim) |
|---------------------------|------------------|------------------------|--------------------------|
| Overview card             | ✅               | ✅                     | ✅                       |
| Edit Claim button         | ✅               | ❌                     | ❌                       |
| Open in Drive button      | ✅               | ❌                     | ❌                       |
| Receipts summary card     | ✅ (all)         | ✅ (all)               | ✅ (own only)            |
| Receipts table — all rows | ✅               | ✅                     | own only                 |
| Add Receipt button        | ✅               | ✅                     | ✅                       |
| Edit/Delete on receipt row | always          | own rows only          | own rows only            |

### 5.2 Computing the mode server-side

```ts
type DetailViewMode = "admin_finance" | "employee_claimant" | "employee_other";

async function resolveDetailViewMode(actor: SessionUser, claim: Claim): Promise<DetailViewMode> {
  if (actor.role === "admin" || actor.role === "finance") {
    return "admin_finance";
  }
  if (actor.id === claim.claimantId) {
    return "employee_claimant";
  }
  // All other employees land in employee_other — they see only their own receipts
  // (which may be an empty list if they haven't uploaded yet). No "denied" case:
  // employees can see all claims.
  return "employee_other";
}
```

**Note:** `employee_other` is now reachable by any employee who is not the claimant, including those with zero prior uploads. They see an empty receipt table and can add their first receipt.

### 5.3 The receipts query for each mode

```ts
async function loadReceipts(claimId: string, mode: DetailViewMode, actor: SessionUser): Promise<Receipt[]> {
  const baseWhere = eq(receipt.claimId, claimId);
  if (mode === "employee_other") {
    return db.query.receipt.findMany({
      where: and(baseWhere, eq(receipt.uploadedBy, actor.id)),
      orderBy: (r, { desc }) => [desc(r.receiptDate)],
    });
  }
  return db.query.receipt.findMany({
    where: baseWhere,
    orderBy: (r, { desc }) => [desc(r.receiptDate)],
  });
}
```

**The summary card totals are computed over the filtered set**, not the full set. This is the critical "no information leak" rule from the grill — the totals must match the visible rows. Implement summary computation client-side from the filtered list, or compute server-side over the same filtered query — either is fine, but the inputs must be identical.

### 5.4 Server Action authorization

Every receipt-mutating Server Action re-derives the mode (don't trust the client). The permission rules in code form:

```ts
function canEditReceipt(actor: SessionUser, receipt: Receipt): boolean {
  if (actor.role === "admin" || actor.role === "finance") return true;
  return receipt.uploadedBy === actor.id;
}

const canDeleteReceipt = canEditReceipt;

function canAddReceipt(actor: SessionUser): boolean {
  // Any authenticated employee (or admin/finance) can add receipts to any visible claim.
  // Employees cannot create claims, but can always upload receipts to existing ones.
  return true;
}
```

---

## 6. The FX scheduler

### 6.1 Discovery — which currency pairs to fetch

The scheduler dynamically discovers the currencies it needs from the entity table:

```ts
const pairs = await db.selectDistinct({ currency: entity.currency })
  .from(entity)
  .where(eq(entity.status, "active"));
// → ["MYR", "SGD", "HKD", "PHP", "AED"]
```

For each currency in the result, the scheduler fetches the `<currency>-USD` rate. Inactive entities don't contribute — if an entity is deactivated, its currency no longer needs fresh rates (the historical receipts already have snapshotted rates).

### 6.2 The script

```ts
// src/scripts/fx-scheduler.ts
import { db } from "@/db";
import { entity, fxRate } from "@/db/schema";
import { eq } from "drizzle-orm";

const PROVIDER_BASE = process.env.FX_PROVIDER_URL ?? "https://open.er-api.com/v6/latest";
const TARGET = process.env.FX_TARGET_CURRENCY ?? "USD";

async function fetchRate(fromCurrency: string): Promise<number | null> {
  const url = `${PROVIDER_BASE}/${fromCurrency}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) {
      console.error(`[fx-scheduler] HTTP ${resp.status} for ${fromCurrency}: ${await resp.text()}`);
      return null;
    }
    const data = await resp.json();
    if (data.result !== "success" || typeof data.rates?.[TARGET] !== "number") {
      console.error(`[fx-scheduler] Unexpected response shape for ${fromCurrency}:`, data);
      return null;
    }
    return data.rates[TARGET];
  } catch (err) {
    console.error(`[fx-scheduler] Network error for ${fromCurrency}:`, err);
    return null;
  }
}

async function main() {
  const start = Date.now();
  const pairs = await db.selectDistinct({ currency: entity.currency })
    .from(entity)
    .where(eq(entity.status, "active"));

  let successCount = 0;
  let failCount = 0;

  for (const { currency } of pairs) {
    if (currency === TARGET) continue;   // no need for USD-USD

    const rate = await fetchRate(currency);
    if (rate === null) {
      failCount++;
      continue;
    }

    const currencyPair = `${currency}-${TARGET}`;
    await db.insert(fxRate)
      .values({ currencyPair, rate: String(rate), fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: fxRate.currencyPair,
        set: { rate: String(rate), fetchedAt: new Date() },
      });
    successCount++;
  }

  const elapsedMs = Date.now() - start;
  console.log(`[fx-scheduler] Done in ${elapsedMs}ms. Success: ${successCount}, Failed: ${failCount}.`);

  if (failCount > 0) process.exit(1);   // non-zero exit so Railway flags the run
}

main().catch((err) => {
  console.error("[fx-scheduler] Fatal:", err);
  process.exit(1);
});
```

### 6.3 Failure handling

The scheduler **never blocks** receipt creation. Its failure modes:

- **Single currency fails:** other currencies succeed and update normally. The failed currency's row in `fx_rate` retains its previous (slightly stale) rate. Receipts saved in that currency until the next successful run use the previous rate.
- **All currencies fail (e.g. provider down):** the entire `fx_rate` table is unchanged. Receipts saved in any currency use the previous rates.
- **Scheduler process crashes:** Railway's cron retry policy + the next hour's run pick up. The previous `fx_rate` rows persist.
- **DB unavailable:** scheduler exits non-zero. Next hour's run.

In all cases, **the `fx_rate` table is the single source of truth** for receipt creation, and it always contains the most recent successfully-fetched rate for each currency. No staleness threshold in code — that's an ops concern (monitor scheduler runs).

### 6.4 Cold start

On first deploy, `fx_rate` is empty. The migration plan (section 3.5 step 4) seeds it via a one-off script using the same fetch logic. If that seed fails, deploy aborts. After that, receipts can be created immediately; the hourly scheduler keeps rates fresh.

### 6.5 The `getCurrentRate` helper

```ts
// src/lib/fx.ts
import { db } from "@/db";
import { fxRate } from "@/db/schema";
import { eq } from "drizzle-orm";

const TARGET = process.env.FX_TARGET_CURRENCY ?? "USD";

export async function getCurrentRate(fromCurrency: string): Promise<{ rate: number; fetchedAt: Date }> {
  if (fromCurrency === TARGET) {
    return { rate: 1, fetchedAt: new Date() };
  }

  const currencyPair = `${fromCurrency}-${TARGET}`;
  const row = await db.query.fxRate.findFirst({ where: eq(fxRate.currencyPair, currencyPair) });

  if (!row) {
    // Unreachable in normal operation — covered by the cold-start seed.
    // If it happens, the scheduler hasn't run successfully for this currency yet.
    throw new Error(
      `No FX rate available for ${currencyPair}. The scheduler may not have run yet for this currency. ` +
      `If this is a newly added entity currency, wait up to one hour for the next scheduler tick.`
    );
  }

  return { rate: Number(row.rate), fetchedAt: row.fetchedAt };
}
```

The user-facing error for the unreachable case is intentionally informative — if Finance sees it, they need to know it's an ops issue, not a data-entry issue.

---

## 7. Claims list page (`/claims/receipts`)

Largely preserved from the previous spec. The relevant differences for this workstream:

### 7.1 List query for Employees

Employees see **all** claims (same unfiltered set as Admin/Finance), excluding soft-deleted claims. No claimant or receipt ownership filter applies. Employees cannot create new claims — that remains admin/finance only.

```ts
// No additional condition pushed for employees — they see everything.
// The only universal filter is isNull(claim.deletedAt) (already applied for all roles).
```

### 7.2 Columns (unchanged from prior spec, plus delete-toggle behavior)

Same columns as before: Claim ID chip, Description, Period, Entity, Claimant, Status badge, Created Date, Drive Link, Edit pencil, Delete trash, Restore (when deleted toggle is on).

The Edit pencil now navigates to `/claims/receipts/[id]/edit` (Edit Claim form, separate route — same as before). The new addition is a third action: **clicking the Claim ID chip OR pressing the row navigates to `/claims/receipts/[id]` (the Detail page)**.

### 7.3 Other behavior

Soft-delete behavior, "Show deleted" toggle (admin-only), and all related logic are unchanged from the previous spec. The trash icon, restore, and confirm dialogs all remain as designed.

---

## 8. The Claim Detail page (`/claims/receipts/[id]`)

This is the new page. Server component.

### 8.1 Page composition

```
+--------------------------------------------+
|  ← Back to Receipts                         |
|                                             |
|  Claim Overview Card                        |
|  ─────────────────────                      |
|  2605-CLM-001 · APD Malaysia                |
|  Description: Monthly travel claim          |
|  Claimant: Lambert · Period: May 2026       |
|  Status: [Awaiting Statement] badge         |
|  Created by Sarah Chen · 12 May 2026        |
|                            [Edit] [Drive]  ← admin/finance only
|                                             |
|  Receipts Summary                           |
|  ─────────────────────                      |
|  ┌──────────┬──────────────┬──────────────┐ |
|  │ Receipts │ Total (MYR)  │ Total (USD)  │ |
|  │    5     │   3,420.00   │     725.40   │ |
|  └──────────┴──────────────┴──────────────┘ |
|                                             |
|  Receipts                       [+ Add Receipt]
|  ─────────────────────                      |
|  Receipts table…                            |
|                                             |
+--------------------------------------------+
```

When `?action=add-receipt` or `?action=edit-receipt&rid=…` is in the URL, the receipts table area is replaced by the receipt form. Overview and summary cards remain.

### 8.2 Server component skeleton

```tsx
// src/app/(app)/claims/receipts/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, receipt } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { ClaimOverviewCard } from "./_components/ClaimOverviewCard";
import { ReceiptsSummaryCard } from "./_components/ReceiptsSummaryCard";
import { ReceiptsTable } from "./_components/ReceiptsTable";
import { ReceiptForm } from "./_components/ReceiptForm";
import { resolveDetailViewMode, loadReceipts } from "./_lib/access";

export default async function ClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string; rid?: string }>;
}) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { id } = await params;
  const sp = await searchParams;

  const claimRow = await db.query.claim.findFirst({
    where: and(eq(claim.id, id), isNull(claim.deletedAt)),
    with: { entity: true, claimant: true, createdByUser: true },
  });
  if (!claimRow) notFound();

  const mode = await resolveDetailViewMode(actor, claimRow);
  if (mode === "denied") redirect("/dashboard");

  const receipts = await loadReceipts(claimRow.id, mode, actor);

  const summary = computeSummary(receipts, claimRow.entity.currency);

  const action = sp.action;
  const editingReceipt =
    action === "edit-receipt" && sp.rid
      ? receipts.find((r) => r.id === sp.rid)
      : undefined;

  return (
    <>
      <ClaimOverviewCard claim={claimRow} mode={mode} />
      <ReceiptsSummaryCard summary={summary} mode={mode} entityCurrency={claimRow.entity.currency} />

      {action === "add-receipt" ? (
        <ReceiptForm mode="add" claim={claimRow} actor={actor} />
      ) : action === "edit-receipt" && editingReceipt ? (
        <ReceiptForm mode="edit" claim={claimRow} actor={actor} receipt={editingReceipt} />
      ) : (
        <ReceiptsTable receipts={receipts} mode={mode} actor={actor} entityCurrency={claimRow.entity.currency} />
      )}
    </>
  );
}

function computeSummary(receipts: Receipt[], currency: string) {
  return {
    count: receipts.length,
    totalLocal: receipts.reduce((sum, r) => sum + Number(r.amountLocal), 0),
    totalUsd: receipts.reduce((sum, r) => sum + Number(r.amountUsd), 0),
    currency,
  };
}
```

### 8.3 ClaimOverviewCard

Renders the claim's metadata. Conditionally shows Edit and Open in Drive buttons based on mode:

```tsx
{(mode === "admin_finance") && (
  <div className="flex gap-2">
    <Link href={`/claims/receipts/${claim.id}/edit`}>
      <Button>Edit</Button>
    </Link>
    <a href={claim.driveReceiptsUrl} target="_blank" rel="noopener">
      <Button variant="secondary">Open in Drive</Button>
    </a>
  </div>
)}
```

For Employee modes, neither button renders.

### 8.4 ReceiptsSummaryCard

Three stat tiles: Count, Total Local, Total USD. Local total is suffixed with the entity's currency code (e.g. `MYR 3,420.00`).

**For `employee_other` mode**, an info chip below the tiles reads: *"Showing your receipts only. Other team members may have added receipts you can't see."* This makes the filtered view explicit so the employee doesn't think they're seeing the full picture.

### 8.5 ReceiptsTable

Columns:

| Column        | Source / format                                                                                                |
|---------------|----------------------------------------------------------------------------------------------------------------|
| Date          | `receiptDate`, formatted "14 May 2026".                                                                        |
| Department    | Chip from joined `department.code`.                                                                            |
| Class         | Chip from joined `class.code`.                                                                                 |
| Amount (Local) | `amountLocal` + `currencyCode`, e.g. `RM 120.00` or `120.00 MYR`. Format follows entity convention.            |
| Amount (USD)   | `amountUsd`, formatted `$25.44`.                                                                              |
| Uploaded By    | Joined user name.                                                                                              |
| File           | View icon — opens `/claims/receipts/[claimId]/receipts/[receiptId]/view` in a new browser tab (`target="_blank"`). The portal serves the file; Drive permission is never required for the viewer. See section 8.7. |
| Actions        | Edit and Delete row icons, conditionally rendered per `canEditReceipt(actor, row)`. Hide entirely (don't render disabled) when the user has no permission. |

**Empty state:** "No receipts yet. Add your first receipt to start building this claim." with a primary "Add Receipt" button.

### 8.6 Add Receipt button placement

Visible to all three modes (per the permission table). Clicking it navigates to `?action=add-receipt`. The form replaces the receipts table.

### 8.7 Receipt file viewer page

A separate page at `/claims/receipts/[claimId]/receipts/[receiptId]/view`, opened in a new tab from the receipts table's File column.

**Why a portal-served viewer rather than a direct Drive link:**

The previous design ("File column opens `fileUrl` in a new tab") sent users straight to Google Drive's webViewLink. That works for Admin/Finance (who have folder-level Drive access via the AUTHORIZED_USERS grant) but fails for Employees — Drive returns a 403, since the file was uploaded by the service account and the employee was never granted personal Drive permission to it. Even the *uploader* themselves can't view their own receipt that way.

The fix is to serve receipt files through the portal:

1. The portal authenticates the user (Better Auth session).
2. The portal authorizes the request using the same `canViewReceipt` rule that gates the receipts table.
3. The portal fetches the file from Drive using the **service account credentials** (which always have access).
4. The portal streams the bytes back to the user's browser.

Drive permissions become irrelevant to the viewing UX — the portal is the gatekeeper, and the rules are exactly the same as those that decide whether the receipt row appears on the Detail page in the first place.

**The page** (`view/page.tsx`):

```tsx
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { receipt, claim } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { resolveDetailViewMode } from "../../../_lib/access";
import { FileViewer } from "../../../_components/FileViewer";

export default async function ReceiptViewPage({
  params,
}: {
  params: Promise<{ id: string; receiptId: string }>;
}) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { id: claimId, receiptId } = await params;

  const row = await db.query.receipt.findFirst({
    where: eq(receipt.id, receiptId),
    with: { claim: { with: { entity: true } }, uploadedByUser: true },
  });
  if (!row || row.claimId !== claimId) notFound();
  if (row.claim.deletedAt) notFound();   // soft-deleted claims hide their receipts from view

  // Permission check — same rule as canViewReceipt
  const mode = await resolveDetailViewMode(actor, row.claim);
  if (mode === "denied") redirect("/dashboard");
  if (mode === "employee_other" && row.uploadedBy !== actor.id) redirect("/dashboard");

  // Stream URL is a separate Route Handler. The page just embeds it.
  const fileStreamUrl = `/api/receipts/${receiptId}/file`;

  return (
    <main>
      <header>
        <Link href={`/claims/receipts/${claimId}`}>← Back to claim {row.claim.displayId}</Link>
        <h1>{row.fileName}</h1>
        <dl>
          <dt>Date</dt><dd>{formatDate(row.receiptDate)}</dd>
          <dt>Amount</dt><dd>{row.currencyCode} {row.amountLocal} ≈ ${row.amountUsd}</dd>
          <dt>Uploaded by</dt><dd>{row.uploadedByUser?.name}</dd>
        </dl>
        {(actor.role === "admin" || actor.role === "finance") && (
          <a href={row.fileUrl} target="_blank" rel="noopener">Open in Drive</a>
        )}
      </header>
      <FileViewer src={fileStreamUrl} fileName={row.fileName} />
    </main>
  );
}
```

**The streaming endpoint** (`/api/receipts/[receiptId]/file/route.ts`):

```ts
import { NextRequest } from "next/server";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { receipt } from "@/db/schema";
import { eq } from "drizzle-orm";
import { downloadDriveFile } from "@/lib/drive";
import { resolveDetailViewMode } from "@/app/(app)/claims/receipts/[id]/_lib/access";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ receiptId: string }> }) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { receiptId } = await params;

  const row = await db.query.receipt.findFirst({
    where: eq(receipt.id, receiptId),
    with: { claim: true },
  });
  if (!row || row.claim.deletedAt) {
    return new Response("Not found", { status: 404 });
  }

  // Same authorization as the viewer page — defense in depth.
  const mode = await resolveDetailViewMode(actor, row.claim);
  if (mode === "denied") return new Response("Forbidden", { status: 403 });
  if (mode === "employee_other" && row.uploadedBy !== actor.id) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const { stream, mimeType } = await downloadDriveFile(row.driveFileId);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${row.fileName.replace(/"/g, "")}"`,
        // Receipts are sensitive financial data. Never cache in shared caches; don't persist in the browser.
        "Cache-Control": "private, no-store",
        // Defense against MIME sniffing surprises on bytes we didn't validate beyond the Server Action filter.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error(`[receipt file] Drive fetch failed for receipt ${receiptId}:`, err);
    return new Response("Could not retrieve file", { status: 500 });
  }
}
```

**The FileViewer client component** (light wrapper for the embed):

```tsx
"use client";

export function FileViewer({ src, fileName }: { src: string; fileName: string }) {
  const lower = fileName.toLowerCase();
  const isImage = /\.(jpe?g|png|gif|webp)$/.test(lower);
  const isHeic = /\.heic$/.test(lower);

  if (isImage) {
    return <img src={src} alt={fileName} style={{ maxWidth: "100%", height: "auto" }} />;
  }

  if (isHeic) {
    // Browsers don't render HEIC natively. Offer a download link instead.
    return (
      <div>
        <p>This receipt is a HEIC image, which most browsers can't display directly.</p>
        <a href={src} download={fileName}>Download {fileName}</a>
        <p>HEIC viewing in-browser is a future enhancement (server-side conversion to JPEG).</p>
      </div>
    );
  }

  // PDFs and everything else — let the browser's built-in viewer handle it.
  return <iframe src={src} title={fileName} width="100%" height="800" style={{ border: 0 }} />;
}
```

**Why both the page AND the API route check permissions** — the page guards against unauthorized navigation (redirects to dashboard); the API route guards against direct GETs of the streaming URL even if the page is bypassed (e.g. a user shares the stream URL or guesses receipt IDs). Each is a layer; both layers run on every request.

**HEIC limitation** — iPhone photos are commonly HEIC. Browsers can't render them inline. For Phase 1 the viewer offers a download link. A future enhancement could convert HEIC to JPEG server-side at view time (using `sharp` or `heic-convert`) and stream the converted bytes.

### 8.8 Edit Receipt entry

Click the row's Edit icon → navigate to `?action=edit-receipt&rid=<receiptId>`. Same form, pre-filled.

---

## 9. Receipt form (Add / Edit)

### 9.1 Fields

| Field        | Type              | Notes                                                                                                  |
|--------------|-------------------|--------------------------------------------------------------------------------------------------------|
| Receipt Date | Date picker       | Required. Defaults to today on Add. Editable on Edit.                                                  |
| Amount       | Number input      | Required. Currency code (from entity) shown as a fixed prefix or suffix: `MYR 120.00`. Min > 0.        |
| Department   | Dropdown          | Required. Sourced from `department` where `status = 'active'`, ordered by code. On Edit, inactive-current-value preservation applies. |
| Class        | Dropdown          | Required. Sourced from `class` where `status = 'active'`, ordered by code. Same preservation rule.    |
| File         | File input        | Required on Add. Optional on Edit (skipping it means "keep existing file"). Accepts PDF/JPEG/PNG/HEIC up to 10 MiB. |

**No currency selector** — currency is derived from the entity on the parent claim. Shown as a read-only label: *"Amount in MYR (the entity's currency)"*.

**No FX rate field** — looked up server-side from `fx_rate` at save time, snapshotted onto the receipt row, and displayed read-only on the saved receipt (no badge needed since rates always come from a single trusted source).

**No USD preview** during input (could be a nice-to-have, deferred). The user enters local amount; the server computes USD on save.

### 9.2 Submission flow

```ts
// Client
<form action={createReceipt}>
  <input type="hidden" name="claimId" value={claim.id} />
  <input name="receiptDate" type="date" required />
  <input name="amountLocal" type="number" step="0.01" min="0.01" required />
  <select name="departmentId" required>...</select>
  <select name="classId" required>...</select>
  <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.heic" required />
  <button type="submit">Add Receipt</button>
</form>
```

Server Action handles the multipart payload, uploads the file to Drive, looks up the FX rate, computes USD, and inserts.

### 9.3 Loading state

Receipt uploads can take a few seconds (file goes to Drive). The submit button shows a spinner and is disabled. The "Cancel" button stays available so the user can abort if they realize they have the wrong file. (Once the upload starts, abort doesn't recall the partial upload — `useFormStatus` exposes the in-flight state.)

---

## 10. Server Actions

### 10.1 createClaim, updateClaim, deleteClaim, restoreClaim (preserved)

These are unchanged from the previous `receipt.md` spec. Restating the contracts here for completeness:

- **`createClaim`** — admin/finance only. Generates next sequence, creates Drive folders (parent + receipts/statements/netsuite), persists row. See previous spec for the full retry/rollback logic.
- **`updateClaim`** — admin/finance only. Cheap path for Description/Claimant/Entity changes (single DB write). Expensive path for Month/Year changes (regenerates displayId, renames Drive folder). Confirm dialog assembled client-side. Inactive-current-value rule for entity/claimant.
- **`deleteClaim`** — admin only. Soft delete; sets `deletedAt`/`deletedBy`. **Does NOT touch receipts** (per Q6 grill decision). Drive folder untouched.
- **`restoreClaim`** — admin only. Clears `deletedAt`/`deletedBy`. Receipts come back "for free" because they were never modified.

### 10.2 createReceipt (new)

```ts
// src/app/(app)/claims/receipts/[id]/_actions.ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { claim, receipt, department, class_ as klass } from "@/db/schema";
import { uploadReceiptFile } from "@/lib/drive";
import { getCurrentRate } from "@/lib/fx";

const FILE_MAX_BYTES = Number(process.env.RECEIPT_FILE_MAX_BYTES ?? 10 * 1024 * 1024);
const FILE_ALLOWED_TYPES = (process.env.RECEIPT_FILE_ALLOWED_TYPES ?? "application/pdf,image/jpeg,image/png,image/heic").split(",");

const CreateReceiptInput = z.object({
  claimId: z.string(),
  receiptDate: z.coerce.date(),
  amountLocal: z.coerce.number().positive(),
  departmentId: z.string(),
  classId: z.string(),
  // file handled separately because FormData
});

export async function createReceipt(_prev: unknown, formData: FormData) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const parsed = CreateReceiptInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please select a file." };
  }
  if (file.size > FILE_MAX_BYTES) {
    return { error: `File too large. Max ${(FILE_MAX_BYTES / 1024 / 1024).toFixed(0)} MiB.` };
  }
  if (!FILE_ALLOWED_TYPES.includes(file.type)) {
    return { error: `Unsupported file type ${file.type}. Allowed: ${FILE_ALLOWED_TYPES.join(", ")}.` };
  }

  // Load the parent claim, validate user can add to it.
  const parent = await db.query.claim.findFirst({
    where: and(eq(claim.id, parsed.data.claimId), isNull(claim.deletedAt)),
    with: { entity: true },
  });
  if (!parent) return { error: "Claim not found." };

  // Permission check: admin/finance always; employee if claimant or has prior upload.
  let canAdd = actor.role === "admin" || actor.role === "finance" || actor.id === parent.claimantId;
  if (!canAdd) {
    const priorUpload = await db.query.receipt.findFirst({
      where: and(eq(receipt.claimId, parent.id), eq(receipt.uploadedBy, actor.id)),
    });
    canAdd = !!priorUpload;
  }
  if (!canAdd) return { error: "You don't have permission to add a receipt to this claim." };

  // Validate department + class exist and are active.
  const dept = await db.query.department.findFirst({ where: eq(department.id, parsed.data.departmentId) });
  if (!dept || dept.status !== "active") return { error: "Selected department is invalid." };

  const cls = await db.query.class_.findFirst({ where: eq(klass.id, parsed.data.classId) });
  if (!cls || cls.status !== "active") return { error: "Selected class is invalid." };

  // FX lookup from local DB.
  const { rate, fetchedAt } = await getCurrentRate(parent.entity.currency);
  const amountUsd = Math.round(parsed.data.amountLocal * rate * 100) / 100;

  // Generate the receipt ID up front so we can use it in the Drive filename.
  const receiptId = crypto.randomUUID();
  const driveFilename = `${receiptId}_${sanitizeFilename(file.name)}`;

  // Upload to Drive FIRST. If this fails, no DB row, no orphan.
  let uploaded: { fileId: string; webViewLink: string };
  try {
    uploaded = await uploadReceiptFile(parent.driveReceiptsFolderId, driveFilename, file);
  } catch (err) {
    console.error(`[createReceipt] Drive upload failed for claim ${parent.displayId}:`, err);
    return { error: "Could not upload file to Google Drive. Please try again." };
  }

  // Insert the row. On failure, best-effort delete the Drive file.
  try {
    await db.insert(receipt).values({
      id: receiptId,
      claimId: parent.id,
      receiptDate: parsed.data.receiptDate,
      amountLocal: String(parsed.data.amountLocal),
      currencyCode: parent.entity.currency,
      amountUsd: String(amountUsd),
      fxRate: String(rate),
      fxRateFetchedAt: fetchedAt,
      departmentId: parsed.data.departmentId,
      classId: parsed.data.classId,
      driveFileId: uploaded.fileId,
      fileUrl: uploaded.webViewLink,
      fileName: file.name,
      uploadedBy: actor.id,
    });
  } catch (err) {
    console.error(`[createReceipt] DB insert failed after Drive upload. Attempting cleanup:`, err);
    try { await deleteDriveFile(uploaded.fileId); } catch (cleanupErr) {
      console.error(`[createReceipt] Cleanup also failed. Orphan in Drive (fileId=${uploaded.fileId}):`, cleanupErr);
    }
    return { error: "Database error while saving receipt. Please try again." };
  }

  revalidatePath(`/claims/receipts/${parent.id}`);
  redirect(`/claims/receipts/${parent.id}`);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}
```

### 10.3 updateReceipt

```ts
const UpdateReceiptInput = z.object({
  receiptId: z.string(),
  receiptDate: z.coerce.date(),
  amountLocal: z.coerce.number().positive(),
  departmentId: z.string(),
  classId: z.string(),
});

export async function updateReceipt(_prev: unknown, formData: FormData) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const parsed = UpdateReceiptInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.errors[0].message };

  const existing = await db.query.receipt.findFirst({
    where: eq(receipt.id, parsed.data.receiptId),
    with: { claim: { with: { entity: true } } },
  });
  if (!existing) return { error: "Receipt not found." };

  // Permission: admin/finance always; uploader for their own.
  const canEdit = actor.role === "admin" || actor.role === "finance" || existing.uploadedBy === actor.id;
  if (!canEdit) return { error: "You don't have permission to edit this receipt." };

  // Inactive-current-value rule for department + class (mirrors entity/claimant on claim edit).
  const dept = await db.query.department.findFirst({ where: eq(department.id, parsed.data.departmentId) });
  if (!dept) return { error: "Department not found." };
  if (dept.status !== "active" && dept.id !== existing.departmentId) {
    return { error: "Selected department is inactive." };
  }
  const cls = await db.query.class_.findFirst({ where: eq(klass.id, parsed.data.classId) });
  if (!cls) return { error: "Class not found." };
  if (cls.status !== "active" && cls.id !== existing.classId) {
    return { error: "Selected class is inactive." };
  }

  const amountChanged = String(parsed.data.amountLocal) !== existing.amountLocal;

  // Optional new file upload.
  const file = formData.get("file");
  const hasNewFile = file instanceof File && file.size > 0;
  let newUpload: { fileId: string; webViewLink: string } | undefined;
  let newFileName: string | undefined;

  if (hasNewFile) {
    if (file.size > FILE_MAX_BYTES) return { error: `File too large.` };
    if (!FILE_ALLOWED_TYPES.includes(file.type)) return { error: `Unsupported file type ${file.type}.` };

    const driveFilename = `${existing.id}_${sanitizeFilename(file.name)}`;
    try {
      newUpload = await uploadReceiptFile(existing.claim.driveReceiptsFolderId, driveFilename, file);
      newFileName = file.name;
    } catch (err) {
      console.error(`[updateReceipt] Drive upload failed:`, err);
      return { error: "Could not upload new file. Receipt not updated." };
    }
  }

  // Recompute FX only if amount changed (currency itself never changes — denormalized).
  let fxFields: Partial<typeof receipt.$inferInsert> = {};
  if (amountChanged) {
    const { rate, fetchedAt } = await getCurrentRate(existing.currencyCode);
    fxFields = {
      fxRate: String(rate),
      fxRateFetchedAt: fetchedAt,
      amountUsd: String(Math.round(parsed.data.amountLocal * rate * 100) / 100),
    };
  }

  try {
    await db.update(receipt).set({
      receiptDate: parsed.data.receiptDate,
      amountLocal: String(parsed.data.amountLocal),
      departmentId: parsed.data.departmentId,
      classId: parsed.data.classId,
      ...(newUpload ? {
        driveFileId: newUpload.fileId,
        fileUrl: newUpload.webViewLink,
        fileName: newFileName!,
      } : {}),
      ...fxFields,
      updatedBy: actor.id,
      updatedAt: new Date(),
    }).where(eq(receipt.id, existing.id));
  } catch (err) {
    console.error(`[updateReceipt] DB update failed:`, err);
    if (newUpload) {
      // Best-effort: delete the new file we uploaded, since the row update failed.
      try { await deleteDriveFile(newUpload.fileId); } catch (cleanupErr) {
        console.error(`[updateReceipt] Cleanup of new Drive file failed (fileId=${newUpload.fileId}):`, cleanupErr);
      }
    }
    return { error: "Database error while updating receipt." };
  }

  // If we uploaded a new file successfully and the DB update also succeeded,
  // delete the OLD Drive file (best-effort; orphans logged but don't fail the request).
  if (newUpload && existing.driveFileId) {
    try {
      await deleteDriveFile(existing.driveFileId);
    } catch (cleanupErr) {
      console.warn(`[updateReceipt] Could not delete old Drive file (fileId=${existing.driveFileId}). Manual cleanup needed:`, cleanupErr);
    }
  }

  revalidatePath(`/claims/receipts/${existing.claimId}`);
  redirect(`/claims/receipts/${existing.claimId}`);
}
```

### 10.4 deleteReceipt (hard delete)

```ts
const DeleteReceiptInput = z.object({ receiptId: z.string() });

export async function deleteReceipt(_prev: unknown, formData: FormData) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { receiptId } = DeleteReceiptInput.parse(Object.fromEntries(formData));

  const existing = await db.query.receipt.findFirst({ where: eq(receipt.id, receiptId) });
  if (!existing) return { error: "Receipt not found." };

  const canDelete = actor.role === "admin" || actor.role === "finance" || existing.uploadedBy === actor.id;
  if (!canDelete) return { error: "You don't have permission to delete this receipt." };

  // Order matters: delete the Drive file first. If that fails, abort (don't leave
  // the DB pointing at a deleted file). If DB delete fails after Drive succeeded,
  // we end up with an orphan record-less file — log loudly.
  try {
    await deleteDriveFile(existing.driveFileId);
  } catch (err) {
    console.error(`[deleteReceipt] Drive delete failed for receipt ${existing.id} (fileId=${existing.driveFileId}):`, err);
    return { error: "Could not delete file from Google Drive. Receipt not deleted." };
  }

  try {
    await db.delete(receipt).where(eq(receipt.id, existing.id));
  } catch (err) {
    // Drive file is already gone; DB row still exists pointing at a missing file.
    // This is the rare bad state. Logging is the best we can do.
    console.error(
      `[deleteReceipt] DB delete failed AFTER Drive delete succeeded. ` +
      `Receipt ${existing.id} now points at a deleted Drive file. Manual cleanup needed:`, err,
    );
    return { error: "Database error while deleting receipt. The file was removed from Drive but the record may persist." };
  }

  revalidatePath(`/claims/receipts/${existing.claimId}`);
  return { ok: true };
}
```

**Drive-first ordering rationale:** if we deleted the DB row first and Drive failed, we'd have an unreachable Drive file with no way to find it again (no DB row pointing at it). With Drive-first, the worst case is "Drive deleted, DB row still exists" — which is detectable (the row points at a 404 URL) and fixable manually. Pick the recoverable failure mode.

### 10.5 Delete confirm dialog (UI side)

For receipt delete (admin/finance, or uploader on their own):

> *"Delete this receipt? The file `coffee-receipt.pdf` will be permanently removed from Google Drive. This cannot be undone."*

Confirm → calls `deleteReceipt`. Cancel → close dialog.

---

## 11. Google Drive integration

### 11.1 Existing functions (preserved)

From the previous spec: `createClaimFolders`, `renameFolder`, `grantEditorPermission`. Unchanged.

### 11.2 New helpers

```ts
// src/lib/drive.ts (additions)
import { google, drive_v3 } from "googleapis";

/**
 * Upload a file (typically a receipt) to a specific Drive folder.
 * Returns BOTH the file's stable Drive ID (the canonical reference used by
 * subsequent operations) AND the webViewLink (for the admin-only "Open in
 * Drive" button on the viewer page). Both are captured in the same
 * `files.create` response — no separate calls.
 */
export async function uploadReceiptFile(
  parentFolderId: string,
  filename: string,
  file: File,
): Promise<{ fileId: string; webViewLink: string }> {
  const drive = await getDriveClient();
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

/**
 * Stream a Drive file's bytes back through the portal so it can be served to
 * authorized users without granting them Drive permission. Used by the file
 * viewer at /claims/receipts/[id]/receipts/[receiptId]/view via the
 * /api/receipts/[id]/file Route Handler.
 *
 * Takes the canonical Drive file ID — no URL parsing required.
 *
 * Returns the file content as a web ReadableStream plus the MIME type Drive
 * recorded at upload. The MIME type drives the Content-Type response header,
 * which in turn drives how the browser renders the file (inline PDF viewer,
 * image, etc.).
 */
export async function downloadDriveFile(
  fileId: string,
): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string }> {
  const drive = await getDriveClient();

  // First fetch metadata to learn the MIME type. Cheap call.
  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });
  const mimeType = meta.data.mimeType ?? "application/octet-stream";

  // Then stream the file content.
  const fileResp = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" },
  );

  const nodeStream = fileResp.data as unknown as NodeJS.ReadableStream;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err: Error) => controller.error(err));
    },
    cancel() {
      // If the client disconnects mid-stream, tear down the upstream too.
      (nodeStream as any).destroy?.();
    },
  });

  return { stream, mimeType };
}

/**
 * Delete a Drive file by its canonical file ID.
 * No URL parsing — caller stores driveFileId on the receipt row.
 */
export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = await getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

function bufferToStream(buffer: Buffer) {
  const { Readable } = require("node:stream");
  return Readable.from(buffer);
}
```

**Why we don't store and parse the URL alone:** the previous design (pre-this-rev) stored only `fileUrl` and ran `extractFileIdFromUrl(fileUrl)` on every download/delete operation. That works today but couples our code to Drive's URL format (`drive.google.com/file/d/{id}/view`) which isn't a documented contract — Google has changed Drive URL shapes before. Storing `driveFileId` separately removes that coupling entirely. The ID is what Drive's API uses; we use what Drive uses.

### 11.3 Drive permission consistency

`AUTHORIZED_USERS` get `writer` role on the parent folder (Contributor on Shared Drives → cannot delete). Same as previous spec. The service account does all uploads/deletes for receipts; AUTHORIZED_USERS only need read/write through the web UI for inspection or manual cleanup, never for receipt operations through the portal.

---

## 12. Business rules / invariants

Combining preserved rules from the previous spec with the new ones from this grill:

### Claim-level (preserved)

1. **Claim ID is the unique human-readable identifier**, formed from claim period and a global `bigint` sequence number from `claim_seq`.
2. **Claim Month, Year, and Entity are editable** after creation, each with a confirm dialog. Period edits cascade to a Drive folder rename and a displayId regeneration.
3. **Sequence number is preserved on period edit** — a claim's sequence belongs to the claim for life.
4. **Inactive entity/claimant are preserved on edit** if matching `existing.entityId` / `existing.claimantId`; switching to a *different* inactive value is rejected.
5. **Claim status is system-managed** by the Statements workstream.
6. **Drive folders are created up-front** with all three subfolders (`receipts/`, `statements/`, `netsuite/`).
7. **Renaming a Drive folder does not change its ID** — Drive Link continues to work.
8. **`createdBy` / `updatedBy` are session-derived**, never from the form.
9. **Edit access is open across Admin/Finance** — any can edit any claim.
10. **Concurrent claim edits use last-write-wins**, no optimistic locking. (Explicit decision; not an oversight.)
11. **Claim soft-delete is admin-only**. Sets `deletedAt`/`deletedBy`. Drive folder untouched.

### Receipt-level (new)

12. **Receipts are first-class records.** Every receipt has a DB row, structured metadata, and a single Drive file.
13. **File upload goes through the portal.** Server Action accepts FormData, uploads to Drive via service account, persists row.
14. **Drive-first ordering on writes.** Create: upload to Drive → insert DB row → on DB failure, best-effort delete the Drive file. Update with file replacement: upload new → update DB → on success, delete old (best-effort). Delete: delete Drive file → delete DB row → on DB failure, log loudly.
15. **`currencyCode` is denormalized from `entity.currency` at receipt save** and is immutable on the row. If the entity's currency is later changed, existing receipts continue showing the original currency.
16. **`fxRate`, `fxRateFetchedAt`, `amountUsd` are snapshotted at save.** Editing a receipt without changing the amount preserves these. Editing the amount triggers a fresh FX lookup (from `fx_rate`, never the provider).
17. **FX rates come from the `fx_rate` table only.** Receipt Server Actions never call the FX provider. The hourly scheduler is the sole writer of `fx_rate`.
18. **Receipt deletion is hard.** DB row removed, Drive file deleted. No recovery within the portal.
19. **Claim soft-delete leaves receipts untouched.** All receipt queries must JOIN to claim and filter `claim.deletedAt IS NULL` (with the Admin show-deleted override). Restoring the claim brings receipts back into visibility automatically.
20. **The `receipt.claimId` FK uses `RESTRICT`, not `CASCADE`.** Application code enforces "claim soft-delete leaves receipts untouched" without DB-level cascade ever firing.

### Permission rules (new)

21. **Three view modes on the Detail page:** Admin/Finance, Employee-claimant, Employee-other. Mode is resolved server-side; the client cannot override.
22. **Receipts list query for Employees expands** to include claims they're either the claimant of OR have uploaded a receipt to.
23. **Summary card totals are computed over the filtered receipt set.** Employee-other must never see totals from invisible receipts.
24. **`uploadedBy` is set from session and is immutable.** Editing a receipt does not change who uploaded it. The `updatedBy` column tracks edits separately.
25. **Receipt files are served through the portal, never via direct Drive links** (except an "Open in Drive" affordance for Admin/Finance on the viewer page). The portal-side viewer page and its API streaming route both re-authorize on every request via the same `canViewReceipt` rule. Drive's own permission system is never relied on for viewing — the service account fetches the bytes, the portal decides who gets them.

### FX rules (new)

25. **The scheduler runs hourly** and UPSERTs into `fx_rate`. Failure leaves the previous successful rate in place — never overwrites with empty or stale data.
26. **`fx_rate` is the only source of truth** for receipt creation. Never read from the FX provider in a user-facing code path.
27. **New currencies are discovered dynamically** by the scheduler via `SELECT DISTINCT currency FROM entity WHERE status = 'active'`. Adding an entity with a new currency requires no scheduler code change; the next hourly tick picks it up.

---

## 13. Error handling

| Scenario                                              | Behavior                                                                                                            |
|-------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| FX rate missing for entity's currency at receipt save | Throw with informative message (section 6.5). Unreachable in normal ops — covered by cold-start seed.               |
| Drive upload fails on createReceipt                   | No DB row created. User sees "Could not upload file." Retry safe.                                                   |
| DB insert fails after Drive upload on createReceipt   | Best-effort delete the just-uploaded Drive file. Orphan logged if cleanup also fails.                                |
| Drive upload fails on updateReceipt (file replacement) | Existing row unchanged, new file not uploaded. User sees error.                                                     |
| DB update fails after new file upload on updateReceipt | Best-effort delete the newly-uploaded file. Old file preserved on the existing row.                                  |
| Drive delete fails on deleteReceipt                   | Receipt not deleted. User sees error. Retry safe.                                                                   |
| Drive fetch fails on viewer streaming endpoint        | Route Handler returns 500 with a generic message. The viewer page's iframe shows the browser's default error. User can refresh or contact admin. The receipt row is not modified. |
| DB delete fails after Drive delete on deleteReceipt   | Bad state — row points at a deleted Drive file. Log loudly. Manual cleanup required.                                |
| Receipt file too large / wrong type                   | Server-side rejection with a friendly error before any Drive call.                                                  |
| Concurrent edits to the same receipt                  | Last-write-wins (same policy as claims). No optimistic locking.                                                     |
| Receipt added to a soft-deleted claim                 | Server Action rejects: "Claim not found." (Soft-deleted claims aren't visible to receipt creation queries.)         |

---

## 14. Testing checklist

### Claim CRUD (preserved from previous spec)

1. ✅–34. (All preserved tests from the previous receipt.md grill — claim creation, period editing, entity editing, inactive-dropdown behavior, soft delete, restore, show-deleted toggle, concurrent edit scenario.)

### Receipt CRUD (new)

35. ✅ Admin/Finance opens Claim Detail → sees overview card with Edit and Open in Drive buttons.
36. ✅ Employee who is the claimant opens the Detail page → sees overview card, no Edit/Drive buttons, summary card over ALL receipts.
37. ✅ Employee who is not the claimant but has uploaded a receipt → sees Detail page with summary card over OWN receipts only, info chip "Showing your receipts only", table filtered to own rows.
38. ❌ Employee who is neither claimant nor uploader → navigating to the Detail page URL → redirected to dashboard.
39. ✅ Add Receipt → form opens via `?action=add-receipt` → submit valid → file uploads to Drive `receipts/` folder, named `<uuid>_<sanitized-filename>` → DB row created with snapshot FX rate and computed USD.
40. ❌ Add Receipt with file > 10 MiB → rejected with friendly error, no Drive call.
41. ❌ Add Receipt with `.docx` MIME type → rejected with friendly error.
42. ❌ Add Receipt with amount = 0 → CHECK constraint and Zod validation both reject.
43. ❌ Add Receipt with inactive Department selected → server rejects.
44. ✅ Edit Receipt without changing amount → FX columns preserved unchanged; `updatedBy`/`updatedAt` set.
45. ✅ Edit Receipt changing amount only → fresh FX rate snapshotted (read from `fx_rate`), `amountUsd` recomputed.
46. ✅ Edit Receipt with new file → new file uploaded to Drive, old file deleted (best-effort), DB row updated.
47. ❌ Employee tries to edit another team member's receipt on a claim they can see → server rejects with permission error.
48. ✅ Delete Receipt → confirm dialog → Drive file removed → DB row removed → table refreshes.
49. ❌ Simulated Drive delete failure → DB row preserved, user sees error, retry safe.
50. ⚠️ Simulated DB delete failure AFTER successful Drive delete → orphan record logged, user sees specific error message.

### FX scheduler

51. ✅ Scheduler script runs against a fresh DB → fetches rates for each distinct active entity currency → UPSERTs `fx_rate`.
52. ✅ Scheduler with one currency failing (e.g. one currency code unsupported by provider) → other currencies succeed, the failed one's row in `fx_rate` is unchanged.
53. ✅ Scheduler with all fetches failing → `fx_rate` table unchanged. Receipts continue to use existing rates.
54. ✅ Adding a new entity with a never-seen currency → next scheduler tick discovers it (via `SELECT DISTINCT`) → `fx_rate` row created.
55. ❌ Receipt creation when `fx_rate` is empty for the required currency (unreachable in normal ops) → server returns the informative error from `getCurrentRate`.

### Permission edge cases

56. ✅ Receipts summary totals for `employee_other` mode → match the filtered receipt set exactly. Never include other team members' amounts.
57. ❌ Employee crafts a direct POST to `createReceipt` with a `claimId` they don't have access to → server rejects.
58. ❌ Employee crafts a direct POST to `updateReceipt` for a receipt uploaded by someone else → server rejects.

### Receipt file viewer (new)

59. ✅ Admin clicks the View icon on a receipt → new browser tab opens the viewer page → PDF embeds via `<iframe>` → image embeds via `<img>` → file streams from `/api/receipts/[id]/file` through the portal.
60. ✅ Employee (claimant) clicks View on their own receipt → viewer loads successfully (file served by the portal regardless of Drive permissions on the file).
61. ✅ Employee (claimant) clicks View on a teammate's receipt that's visible on the same claim → viewer loads successfully (any receipt visible on the Detail page is viewable).
62. ✅ Employee (other) clicks View on their own receipt on a claim they're not the claimant of → viewer loads successfully.
63. ❌ Employee crafts the URL `/claims/receipts/<claimId>/receipts/<otherReceiptId>/view` for a receipt they don't own on a claim they're not the claimant of → page redirects to `/dashboard`.
64. ❌ Employee crafts a direct GET to `/api/receipts/<otherReceiptId>/file` (bypassing the page) → Route Handler returns 403.
65. ❌ Anonymous request to `/api/receipts/<receiptId>/file` (no session) → middleware redirects to login (or returns 401 depending on configuration).
66. ✅ Viewer for a HEIC file → renders the "browser can't display HEIC" message with download link rather than a broken `<img>`.
67. ✅ Viewer for a receipt on a soft-deleted claim → page returns 404 (matches business rule 19).
68. ✅ Admin opens the viewer → "Open in Drive" button is present in the header. Employee opens the viewer → button is absent.
69. ✅ Streaming response headers verified: `Content-Type` matches Drive's recorded MIME type, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
70. ⚠️ Simulated Drive fetch failure inside the Route Handler → returns 500 to the iframe; receipt row unmodified; user sees a generic browser error and can retry.

### Claim soft-delete + receipts

71. ✅ Admin soft-deletes a claim with 5 receipts → claim disappears from list; receipts table is untouched (verify by inspecting DB).
72. ✅ Admin toggles "Show deleted" and opens the soft-deleted claim's detail page (admin-only flow) → all 5 receipts still visible.
73. ✅ Admin restores the claim → claim reappears in active list with all 5 receipts intact.

### Unit / integration

- `createReceipt`: valid → row persists; Drive upload mocked; FX from `fx_rate` mocked; non-permitted user throws; bad file rejected.
- `updateReceipt`: amount-unchanged path skips FX lookup; amount-changed path snapshots fresh rate; new-file path uploads + cleans up old file.
- `deleteReceipt`: Drive-first ordering verified; permission gating verified.
- `downloadDriveFile`: mocks the Drive client; returns a stream and the correct MIME type when given a valid file ID; surfaces errors from the Drive client.
- `/api/receipts/[receiptId]/file` Route Handler: returns 404 for missing/soft-deleted-claim receipts; returns 403 for unauthorized; returns 200 with correct headers + stream body for authorized requests.
- `getCurrentRate`: returns 1 for USD-USD; throws for missing currency; reads from `fx_rate` for known currencies.
- `resolveDetailViewMode`: returns each of the four values for the four user/claim combinations.
- FX scheduler: with mocked provider, successful pairs UPSERT, failed pairs leave rows untouched.

---

## 15. Decisions (locked)

### From the latest grill

| # | Decision                          | Value                                                                                                          |
|---|-----------------------------------|----------------------------------------------------------------------------------------------------------------|
| 1 | Receipts data model               | First-class DB records with full metadata (date, amount, FX, department, class, file, uploader).               |
| 2 | File upload mechanism             | Through the portal via Server Action with FormData. Drive upload via service account.                          |
| 3 | Employee permissions              | Three-mode model: Admin/Finance / Employee-own-claim / Employee-other-claim (filtered to own receipts).         |
| 4 | FX architecture                   | Hourly scheduler UPSERTs `fx_rate`; receipt creation reads from DB only; never user-facing FX failures.        |
| 5 | Receipt deletion                  | Hard delete from DB + hard delete from Drive. Drive-first ordering. No recovery within the portal.             |
| 6 | Claim soft-delete + receipts      | Receipts untouched on claim soft-delete. Restore brings them back via the visibility JOIN.                     |

### Inherited from prior receipt.md grills (still locked)

| # | Decision                          | Value                                                                                                          |
|---|-----------------------------------|----------------------------------------------------------------------------------------------------------------|
| 7 | Per-period vs global sequence     | Global, via `claim_seq` (bigint). Preserved across period edits.                                               |
| 8 | Month/Year editability            | Editable with confirm dialog. Triggers displayId regeneration + Drive folder rename.                           |
| 9 | Entity editability                | Editable with confirm dialog. Single-column update.                                                            |
| 10 | Inactive current entity/claimant | Preserve in dropdown with `(inactive)` label; user can keep current or pick an active one.                     |
| 11 | AUTHORIZED_USERS Drive role      | `writer` (Contributor on Shared Drive, no delete).                                                             |
| 12 | Edit access scope                 | Open across Admin and Finance. Audit columns provide accountability.                                           |
| 13 | Concurrent-edit protection (claims) | Last-write-wins. Explicitly accepted.                                                                          |
| 14 | Claim delete semantics            | Soft delete via `deletedAt`/`deletedBy`. Admin-only.                                                           |
| 15 | UI surfacing for claim delete     | Trash icon + "Show deleted" toggle (admin-only). Single list page.                                              |
| 16 | Cascade with statements           | Statements cascade-soft-delete with the claim (matched by timestamp). Statements workstream owns the cascade impl. |

### Still to confirm before deployment

1. **Shared Drive parent.** Strongly recommended — see prior spec.
2. **AUTHORIZED_USERS membership.** Initial env-var list for staging/production.
3. **FX provider choice.** Default to `open.er-api.com` (no key, free). Switch to `exchangerate-api.com` (key required, 1500 req/month free) if the no-key option proves unreliable. Configurable via `FX_PROVIDER_URL`.
4. **Receipt file max size.** Default 10 MiB. Confirm vs Drive's quota and typical receipt photo sizes.
5. **Receipt date range constraint.** Currently free-form date picker. Add an upper bound (≤ today) and/or lower bound (≥ 12 months ago)? Out of scope unless requested.

---

## 16. Out of scope (deferred / future workstreams)

- **Statements workstream.** Statement table, the `statement_attached` status transition, the cascade-soft-delete with claim. Uses `claim.driveStatementsFolderId`.
- **Verification queue workstream.** Builds on Statements.
- **NetSuite integration.** Uses `claim.driveNetsuiteFolderId`.
- **Bulk receipt import** (CSV upload). Hand-entered one at a time only.
- **Receipt-level audit log** beyond `uploadedBy`/`updatedBy`. A full change-history table is deferred to a generic audit_log workstream.
- **Reporting beyond per-claim totals.** Cross-claim reports ("show me all Travel receipts across all claims for Q2 2026") are deferred.
- **Non-USD reporting.** All conversion is to USD. Multi-base-currency reporting is deferred.
- **Receipt-level versioning** (keeping the old file when a new one replaces it). Replacements are destructive — old file is deleted from Drive.
- **Permanent purge of soft-deleted claims.** A nightly job that walks claims with `deletedAt < now() - X days` and hard-deletes them (along with their receipts and Drive folders). Out of scope; build when storage hygiene becomes a real concern.
- **Receipt-side cleanup automation.** Orphaned Drive files from failed writes accumulate. A future cleanup script can reconcile.

---

## 17. Appendix: relationship to other specs

| Other spec                          | Relationship                                                                                          |
|-------------------------------------|-------------------------------------------------------------------------------------------------------|
| `auth-implementation-plan.md`       | Provides the Better Auth foundation, `requireRole` helper, session model.                              |
| `Basic_spec.md`                     | Updated stack reference. This spec implements the Receipts feature it describes.                       |
| `entities-management-spec.md`       | Provides the `entity` table. **This spec adds the `currency` column** (section 3.1) — update accordingly. |
| `departments-spec.md`               | Provides the `department` table. Receipt FKs into it.                                                  |
| `classes-spec.md`                   | Provides the `class` table. Receipt FKs into it.                                                       |
| Previous `receipt.md`               | **Superseded.** This spec restates the relevant parts (claim schema, sequence, Drive structure, soft delete) and replaces the obsolete "Receipts page just lists Claims" framing. |
