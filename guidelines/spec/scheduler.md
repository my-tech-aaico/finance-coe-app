# Implementation Spec — Verification Scheduler & Verification History

**Project:** COE Finance Claims Portal
**Scope:** The two background workflows that drive credit-card statement verification through Opus, plus the verification-history surface that renders their output. This is the **scheduler workstream** that `statement.md` repeatedly defers as "out of scope — a follow-up workstream."

**Stack:** Next.js App Router · TypeScript · Drizzle ORM · PostgreSQL · Google Drive (service account) via `googleapis` · standalone `tsx` scripts.

This spec assumes the **Claims** (`receipt.md`), **Receipts** (`receipt-cr.md`), and **Statements** (`statement.md`) workstreams are complete and merged. They are: the `statement` and `statement_verification_attempt` tables, the `VerificationHistoryAccordion`, the Statement Detail page, and the `drive.ts` helpers all exist in the codebase today. This workstream **adds the execution engine** that was always intended to mutate the verification-attempt rows in place. Every file path, function signature, and helper name referenced in this spec was checked against the current working tree.

### Files to read first
- `guidelines/spec/receipt.md` — claim table + per-claim Drive folder layout.
- `guidelines/spec/receipt-cr.md` — first-class receipt records.
- `guidelines/spec/statement.md` — the statement domain. **Sections 3.2, 3.3, 8.2, 8.3, 8.5, 10.4 are the contract this workstream implements against.**
- `guidelines/ui/COE_Finance_Claims_Portal_UI_Spec.md` sections 6.5–6.6 — verification history + verification flow.
- `guidelines/ui/COE_Finance_Claims_Portal_UI_Mock.html` — the statement detail mock.

---

## 1. What this workstream is

`statement.md` builds the verification-history **data structures and UI** but explicitly never writes the `in_progress` / `success` / `failed` states. Every attempt row that workstream produces is a `queued` row with `opusJobId = NULL` and `opusResponse = NULL`. This workstream supplies the missing half:

1. **Submission workflow** — a scheduled job that picks up `queued` verification attempts, pulls the statement + receipt files from Google Drive, submits them to the Opus verification API, and records the returned job execution ID.
2. **Update workflow** — a second scheduled job that polls Opus for `in_progress` attempts and writes back the terminal `success` / `failed` outcome.
3. **Verification history surface** — the accordion on the Statement Detail page already renders all five statuses and `opusResponse`; this workstream adds the one missing field (`remarks`) so failure reasons are visible.

### In scope
- Submission of verification jobs to Opus.
- Polling and update of verification status from Opus.
- The `remarks` column and its display in the verification-history accordion.
- A schema migration adding `remarks`.
- Two `tsx` scheduler scripts + their npm scripts + cron setup docs.

### Out of scope
- Any change to how `queued` attempts are *created* — that is owned by `statement.md` (upload checkbox, "Start Verification", "Retry Verification").
- NetSuite export of verified statements.
- A retry/backoff policy beyond what section 8 specifies (no exponential backoff, no dead-letter queue — failed attempts are retried by a human via the existing "Retry Verification" button).
- Auth/session — schedulers run as a system process with no HTTP request and no user.

---

## 2. The verification state machine (recap from `statement.md` §8)

This workstream owns exactly the transitions `statement.md` §8.3 marks "out of scope (scheduler workstream)":

| From          | To                   | Owned by          | Trigger                                                                 |
|---------------|----------------------|-------------------|-------------------------------------------------------------------------|
| `queued`      | `in_progress`        | **Submission job**| Job claims the row, flips status, then submits files to Opus.            |
| `in_progress` | `success` / `failed` | **Update job**    | Job polls Opus `checkStatus`; writes the terminal outcome.               |
| `queued`      | `failed`             | **Submission job**| Drive file/folder missing, or Opus submission errored. See §8.           |
| `in_progress` | `failed`             | **Update job**    | Opus reports failure, or the attempt is stuck past a §7.4 timeout (60 min no-jobId / 24 h with-jobId). |

**The schedulers mutate the *existing* attempt row in place. They never INSERT a new `statement_verification_attempt` row** (`statement.md` §8.3). New rows are only ever created by the three user-driven triggers in `statement.md`. `triggeredBy` and `triggerSource` on a row are **never modified** by a scheduler — they record who originally created the attempt.

### 2.1 The denormalization invariant — keep `statement.verificationStatus` in sync

`statement.md` §3.3 keeps the current status in two places: the denormalized `statement.verificationStatus` column (read by the list page filter and the Detail header) and the `statement_verification_attempt.status` of the latest attempt. **Every status mutation in this workstream MUST update both columns inside the same DB transaction.**

This is safe because a statement has **at most one non-terminal attempt at a time** (`statement.md` §8.4 — the user cannot Start/Retry again until the current attempt reaches a terminal state). The attempt a scheduler processes is therefore always the latest attempt for that statement, so mirroring its status onto `statement.verificationStatus` is always correct.

The `statement.verificationStatus` enum already includes all five values (`src/db/schema/statement.ts`). No enum change needed.

---

## 3. Prerequisites & environment

### 3.1 Re-used, unchanged
Everything Drive-related from the receipts/statements workstreams: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_DRIVE_PARENT_FOLDER_ID`, `AUTHORIZED_USERS`. The `googleapis` package is already a dependency. No new npm packages are required — `FormData`, `Blob`, and `fetch` are all global in the Node version this project runs (`tsx` on Node 18+).

### 3.2 New environment variables

| Variable                          | Example                       | Purpose                                                                                  |
|------------------------------------|-------------------------------|------------------------------------------------------------------------------------------|
| `OPUS_API_URL`                     | `https://opus.com`            | Base URL of the Opus verification service. From `new-new.md` ("url: opus.com").          |
| `OPUS_SUBMISSION_PATH`             | `/submission`                 | Path of the verification submission endpoint. From `new-new.md`.                         |
| `OPUS_CHECK_STATUS_PATH`           | `/checkStatus`                | Path of the status-check endpoint. From `new-new.md`.                                    |
| `OPUS_API_KEY`                     | `sk-opus-...`                 | Bearer token for Opus auth. **ASSUMPTION — see §11.** Submitted as `Authorization: Bearer`. |
| `OPUS_REQUEST_TIMEOUT_MS`          | `60000`                       | Per-request timeout for Opus calls (`AbortSignal.timeout`). Used to classify timeouts.   |
| `VERIFICATION_SUBMIT_BATCH_SIZE`   | `5`                           | Max `queued` attempts processed per submission run. Default `5` per `new-new.md`.        |
| `VERIFICATION_POLL_BATCH_SIZE`     | `5`                           | Max `in_progress` attempts processed per update run. Default `5` per `new-new.md`.       |
| `VERIFICATION_SUBMIT_STUCK_MINUTES`     | `60`                          | An `in_progress` attempt with **no** `opusJobId` older than this = a crashed submit run; force-failed by the poll job (§7.4). |
| `VERIFICATION_INPROGRESS_TIMEOUT_HOURS` | `24`                          | An `in_progress` attempt **with** an `opusJobId` older than this = Opus never finished; force-failed by the poll job (§7.4).  |

All values are read with `process.env.X ?? <default>` so the scripts run locally without a full `.env` if the defaults suffice — mirroring `fx-scheduler.ts` (`FX_PROVIDER_URL`, `FX_TARGET_CURRENCY`). Add the `OPUS_*` and `VERIFICATION_*` keys to `.env.example` as well — it currently lists only the DB/auth keys (and omits even the existing Drive service-account keys), so extend it while you are here.

---

## 4. Data model change

The two tables already exist. The **only** schema change is one new column.

### 4.1 New column: `statement_verification_attempt.remarks`

**File:** `src/db/schema/statementVerificationAttempt.ts` (edit the existing file)

| Column     | Type             | Notes                                                                                                              |
|------------|------------------|--------------------------------------------------------------------------------------------------------------------|
| `remarks`  | `text`, nullable | Human-readable note explaining a non-obvious outcome. Written by the schedulers on **failure** (the two messages in §8). `NULL` for `queued`, `in_progress`, and `success` rows unless a future need arises. Surfaced in the accordion (§9). |

Add it to the Drizzle table definition:

```ts
// src/db/schema/statementVerificationAttempt.ts — inside pgTable("statement_verification_attempt", { ... })
remarks: text("remarks"),
```

No index. `remarks` is only ever read alongside a row already being fetched by `id` or `statementId`.

**Mapping note — `new-new.md` terminology vs. the schema:**
- `new-new.md` says "MODIFIED_DATE" → this is the existing `updatedAt` column. There is **no** separate `MODIFIED_DATE` column; schedulers set `updatedAt = new Date()` on every mutation.
- `new-new.md` says "REMARKS" → the new `remarks` column above.
- `new-new.md` says statuses "QUEUED / IN-PROGRESS / FAILED / SUCCESS" → the existing `statement_verification_attempt_status` enum values `queued` / `in_progress` / `failed` / `success`. Use the enum values verbatim.

### 4.2 Migration plan

1. `npm run db:generate` (`drizzle-kit generate`) after editing the schema file. `drizzle.config.ts` writes migrations to `./drizzle`; the latest there is `0007_*`, so this produces `drizzle/0008_*.sql`. It must be a single `ALTER TABLE "statement_verification_attempt" ADD COLUMN "remarks" text;` — verify it contains nothing else.
2. `npm run db:migrate` (`drizzle-kit migrate`).
3. No backfill — existing rows keep `remarks = NULL`, which is correct.

---

## 5. Opus API client

**New file:** `src/lib/opus.ts`

A thin, server-only HTTP client. It contains **no DB access** — purely Opus I/O — so it is unit-testable and reusable by both scheduler scripts.

> **The Opus request/response shapes below are ASSUMPTIONS.** `new-new.md` supplies only the base URL and the two paths. The shapes here are the minimum a submit→poll job API needs and are consistent with `statement.md` (`opusJobId` ⇄ `JOB_EXECUTION_ID`, `opusResponse` jsonb holding the raw payload). **Confirm them against the real Opus API docs before implementing** — see §11. The two scheduler algorithms (§6, §7) depend only on the *named fields* below, so adjusting the wire shape is a localized change inside `opus.ts`.

### 5.1 `submitVerification` — `POST {OPUS_API_URL}{OPUS_SUBMISSION_PATH}`

Sends the statement file and all receipt files for the claim as `multipart/form-data`.

```ts
export type OpusSubmissionFile = { blob: Blob; fileName: string; kind: "statement" | "receipt" };

export type OpusSubmissionResult = {
  jobExecutionId: string;   // ASSUMPTION: response field carrying JOB_EXECUTION_ID
  raw: unknown;             // the full parsed JSON body — stored verbatim into opusResponse
};

export async function submitVerification(input: {
  statementDisplayId: string;
  claimDisplayId: string;
  files: OpusSubmissionFile[];
}): Promise<OpusSubmissionResult>;
```

- Request: `FormData` with one part per file (`form.append("statement", blob, fileName)` / `form.append("receipt", blob, fileName)`), plus text parts `statementDisplayId` and `claimDisplayId` for traceability.
- Auth: `Authorization: Bearer ${OPUS_API_KEY}`.
- Timeout: `AbortSignal.timeout(OPUS_REQUEST_TIMEOUT_MS)`.
- On non-2xx, malformed JSON, missing `jobExecutionId`, or network/timeout error → **throw** a typed `OpusError` (see §5.3). The caller (§6) classifies the throw.

### 5.2 `checkVerificationStatus` — `POST {OPUS_API_URL}{OPUS_CHECK_STATUS_PATH}`

```ts
export type OpusStatusResult = {
  state: "in_progress" | "success" | "failed";  // ASSUMPTION: normalized from the Opus status field
  raw: unknown;                                  // the full parsed JSON body — stored into opusResponse
};

export async function checkVerificationStatus(jobExecutionId: string): Promise<OpusStatusResult>;
```

- Request body: `{ jobExecutionId }` as JSON (ASSUMPTION — could be a query param; localized to this function).
- `opus.ts` owns the mapping from Opus's raw status vocabulary to the three normalized `state` values. Keep this mapping in one clearly-commented spot so it is the single thing to fix when the real vocabulary is known.
- Same auth + timeout as §5.1. On transport failure → throw `OpusError`.

### 5.3 `OpusError`

```ts
export class OpusError extends Error {
  constructor(message: string, readonly kind: "timeout" | "http" | "malformed" | "network") {
    super(message);
  }
}
```

The `kind` lets §8 decide between a transient retry (poll job) and a hard fail. It is *not* surfaced to the user — the user-facing `remarks` text is fixed copy (§8).

---

## 6. Submission workflow (scheduler #1)

**New file:** `src/scripts/verification-submit.ts`
**npm script:** `"verification-submit": "tsx src/scripts/verification-submit.ts"`
**Cadence:** every ~3 minutes (`new-new.md`). See §10.

Structure follows `src/scripts/fx-scheduler.ts` exactly: `import "dotenv/config"` first, a `main()`, a final `.catch()` that logs and `process.exit(1)`, log lines prefixed `[verification-submit]`.

### 6.1 Algorithm

**Step 1 — Claim a batch (one transaction).** Atomically select and lock the oldest `queued` attempts, flip them to `in_progress`, and mirror onto the statement. Locking inside the transaction is what makes overlapping cron runs safe.

```ts
const BATCH = Number(process.env.VERIFICATION_SUBMIT_BATCH_SIZE ?? 5);

const claimed = await db.transaction(async (tx) => {
  const rows = await tx
    .select({
      attemptId: statementVerificationAttempt.id,
      statementId: statement.id,
      statementDisplayId: statement.displayId,
      statementDriveFileId: statement.driveFileId,
      statementFileName: statement.fileName,
      claimId: claim.id,
      claimDisplayId: claim.displayId,
    })
    .from(statementVerificationAttempt)
    .innerJoin(statement, eq(statementVerificationAttempt.statementId, statement.id))
    .innerJoin(claim, eq(statement.claimId, claim.id))
    .where(
      and(
        eq(statementVerificationAttempt.status, "queued"),
        isNull(statement.deletedAt),   // skip cascade-soft-deleted statements (statement.md §8.5)
        isNull(claim.deletedAt),
      ),
    )
    .orderBy(asc(statementVerificationAttempt.createdAt))   // "earliest first" — new-new.md
    .limit(BATCH)
    .for("update", { of: statementVerificationAttempt, skipLocked: true });

  if (rows.length === 0) return [];

  const now = new Date();
  const attemptIds = rows.map((r) => r.attemptId);
  const statementIds = rows.map((r) => r.statementId);

  await tx.update(statementVerificationAttempt)
    .set({ status: "in_progress", updatedAt: now })
    .where(inArray(statementVerificationAttempt.id, attemptIds));

  await tx.update(statement)
    .set({ verificationStatus: "in_progress", updatedAt: now })
    .where(inArray(statement.id, statementIds));

  return rows;
});
```

The batch-claim query uses the **core `db.select()` builder**, not the relational `db.query.*` API — the relational builder does not support `FOR UPDATE`. The `of: statementVerificationAttempt` clause scopes the lock to **only** the attempt rows; without it, `FOR UPDATE` would also lock the joined `statement` and `claim` rows and could contend with portal edits. `SKIP LOCKED` lets a second, overlapping submission run claim a disjoint batch instead of blocking. The transaction is kept I/O-free (one `SELECT`, two `UPDATE`s) so the lock is held only for milliseconds.

Flipping to `in_progress` **before** the Opus call is deliberate and matches `new-new.md` ("Then it updates the statement_verification_attempt table ... to update the status to IN-PROGRESS ... It will then call opus.com"). The flip doubles as a claim/lock so the next run does not re-pick these rows.

**Step 2 — Per attempt: gather files, submit, record.** Iterate `claimed` **sequentially** (not `Promise.all` — keeps Drive/Opus load predictable and log output readable, matching `fx-scheduler.ts`'s sequential loop). For each row:

1. **Load receipts** for `claimId`: `SELECT id, driveFileId, fileName FROM receipt WHERE claimId = ?`. **If this returns zero rows**, the claim has nothing to cross-check the statement against — fail the attempt immediately via `finalizeAttempt({ attemptId, statementId, status: "failed", remarks: "No receipts on the linked claim to verify against." })` and skip to the next attempt (no Drive download, no Opus call). See §6.3.
2. **Download files from Drive** — the statement file (`statementDriveFileId`) and every receipt's `driveFileId`. Use the new `downloadDriveFileAsBlob` helper (§6.2).
   - Any Drive download failure (404 file-not-found, folder-not-found, permission) → **fail this attempt** with `remarks = "File/Folder is not found, please check in Google Drive."` (verbatim from `new-new.md`). Skip to the next attempt. See §8.
3. **Submit to Opus** via `submitVerification(...)` (§5.1).
   - `OpusError` of any `kind` → **fail this attempt** with `remarks = "Error from OPUS, please check in OPUS or retry"` (verbatim from `new-new.md`). Skip to the next attempt.
4. **On success** — write the job details (own transaction):

```ts
const now = new Date();
await db.transaction(async (tx) => {
  await tx.update(statementVerificationAttempt)
    .set({ opusJobId: result.jobExecutionId, opusResponse: result.raw, updatedAt: now })
    .where(eq(statementVerificationAttempt.id, row.attemptId));
  // status stays "in_progress" — set in Step 1. statement.verificationStatus already "in_progress".
});
```

The attempt now sits at `in_progress` with a populated `opusJobId`, ready for the update job (§7).

**Step 3 — Summary log + exit.** `console.log("[verification-submit] Done in ${ms}ms. Submitted: ${ok}, Failed: ${failed}, Empty batch: ${claimed.length === 0}.")`, then `process.exit(failed > 0 ? 1 : 0)`. A non-zero exit lets the cron host surface a partial failure. **Always exit explicitly** — `src/db/index.ts` opens a `pg.Pool` at module load whose connections keep the Node event loop alive until they idle out, so a script that merely returns from `main()` lingers for ~10s (a latent rough edge in `fx-scheduler.ts`'s success path). An explicit `process.exit()` terminates immediately.

### 6.2 New Drive helper

**File:** `src/lib/drive.ts` — add one function alongside the existing `downloadDriveFile`:

```ts
export async function downloadDriveFileAsBlob(
  fileId: string,
): Promise<{ blob: Blob; mimeType: string }> {
  const { stream, mimeType } = await downloadDriveFile(fileId);
  const buffer = await new Response(stream).arrayBuffer();
  // Set the Blob's type explicitly: a Blob built from a bare stream has type "",
  // which would make the multipart part fall back to application/octet-stream.
  return { blob: new Blob([buffer], { type: mimeType }), mimeType };
}
```

`downloadDriveFile` already exists and throws on a missing file — its throw is what Step 2.2 catches. A Google Drive 404 surfaces as an error whose `code`/`status` is `404`; classify "file/folder not found" by catching the throw broadly (any download error → the file-not-found `remarks`), since from the scheduler's perspective an un-downloadable file is functionally "not found." The `mimeType` is taken from `downloadDriveFile`'s Drive metadata lookup — required because the `receipt` table stores **no** MIME column (only `statement.fileMimeType` is persisted), so receipt files have no portal-side type to fall back on.

### 6.3 What gets sent to Opus

Per `new-new.md`: "pull the statement file and receipt files from Google Drive ... call opus.com verification API with the files." Opus cross-checks the statement against its receipts. The submission therefore includes **the one statement file + every receipt file on the claim.**

Edge case — **a claim with zero receipts**: the submit job does **not** call Opus. A statement cannot be cross-checked without receipts, so Step 2 item 1 fails the attempt fast with `remarks = "No receipts on the linked claim to verify against."` (grilled decision, 2026-05-21). This skips a pointless Opus round-trip and hands the user an actionable remark — add receipts to the claim, then click Retry Verification.

---

## 7. Update workflow (scheduler #2)

**New file:** `src/scripts/verification-poll.ts`
**npm script:** `"verification-poll": "tsx src/scripts/verification-poll.ts"`
**Cadence:** every ~10 minutes (`new-new.md`). See §10.

Same script skeleton as §6 / `fx-scheduler.ts`; log prefix `[verification-poll]`.

### 7.1 Algorithm

**Step 1 — Select a batch.** The oldest `in_progress` attempts. The poll job takes **no row lock** — see §7.3.

```ts
const BATCH = Number(process.env.VERIFICATION_POLL_BATCH_SIZE ?? 5);

const rows = await db
  .select({
    attemptId: statementVerificationAttempt.id,
    statementId: statement.id,
    opusJobId: statementVerificationAttempt.opusJobId,
    attemptUpdatedAt: statementVerificationAttempt.updatedAt,
  })
  .from(statementVerificationAttempt)
  .innerJoin(statement, eq(statementVerificationAttempt.statementId, statement.id))
  .where(
    and(
      eq(statementVerificationAttempt.status, "in_progress"),
      isNull(statement.deletedAt),
    ),
  )
  .orderBy(asc(statementVerificationAttempt.updatedAt))   // earliest-submitted first
  .limit(BATCH);
```

`updatedAt` is a stable "verification started at" marker (see §7.4 — nothing touches it while a row sits at `in_progress`), so ordering by it ascending processes the longest-running attempts first.

**Step 2 — Per attempt.** Sequentially. For each row, compute its age and the two thresholds:

```ts
const STUCK_MS   = Number(process.env.VERIFICATION_SUBMIT_STUCK_MINUTES ?? 60) * 60_000;
const TIMEOUT_MS = Number(process.env.VERIFICATION_INPROGRESS_TIMEOUT_HOURS ?? 24) * 3_600_000;
const ageMs = Date.now() - row.attemptUpdatedAt.getTime();
```

- **`opusJobId` is `NULL`** — the submission job flipped this row to `in_progress` (§6.1 Step 1) but never wrote a job ID; there is no job to poll:
  - **`ageMs <= STUCK_MS`** (default 60 min) → a submission run may **still be processing this row right now** (its Step 2 can take minutes for a multi-file claim). **Skip it** — make no write. It will gain a job ID on that run, or age out.
  - **`ageMs > STUCK_MS`** → the submission run that claimed it crashed before reaching Opus. Force-fail (§7.4) with `remarks = "Verification did not start in time, please retry."`
- **`opusJobId` present** — call `checkVerificationStatus(opusJobId)` (§5.2):
  - `state: "success"` → `finalizeAttempt({ attemptId, statementId, status: "success", opusResponse: raw, remarks: null })`.
  - `state: "failed"` → `finalizeAttempt({ attemptId, statementId, status: "failed", opusResponse: raw, remarks: "Error from OPUS, please check in OPUS or retry" })`.
  - `state: "in_progress"` → still running. If **`ageMs > TIMEOUT_MS`** (default 24h), force-fail (§7.4) with `remarks = "Error from OPUS, please check in OPUS or retry"`; otherwise **make no DB write** — leaving the row untouched keeps `updatedAt` frozen so the §7.4 clock keeps counting.
  - **`OpusError` thrown** — `checkStatus` itself failed (timeout, 5xx). **Transient** — if `ageMs > TIMEOUT_MS`, force-fail (§7.4) with the OPUS remark (Opus has been unreachable too long to keep waiting); otherwise log and skip (no write), and the next cycle retries.

**Step 3 — Summary log + exit**, same shape as §6.1 Step 3 (log prefix `[verification-poll]`, explicit `process.exit`).

### 7.2 Why `checkStatus` failure is not a hard fail

The submission job fails fast on Opus errors because a failed submission means *no job was ever created* — there is nothing to recover, and the user must retry. The update job is the opposite: a job **is** running inside Opus; a flaky `checkStatus` response says nothing about that job. Hard-failing here would discard a verification that may well be succeeding. So `checkStatus` errors are retried indefinitely, bounded only by §7.4.

### 7.3 Idempotency — and why the poll job takes no lock

The poll job intentionally uses **no `FOR UPDATE`**. Every poll operation is idempotent: `checkVerificationStatus` is a read on the Opus side, and `finalizeAttempt` re-applies a terminal state (re-writing the same `success`/`failed` payload has no net effect). If two poll runs overlap and pick the same row, the worst case is one extra harmless Opus read.

Avoiding the lock is deliberate: holding `FOR UPDATE` across the `checkStatus` HTTP call would pin a DB connection for a full network round-trip. The submission job *can* lock (§6.1) precisely because its locked transaction does no I/O — only a `SELECT` and two `UPDATE`s.

### 7.4 Stuck-attempt timeouts

The poll job force-fails an attempt wedged at `in_progress` under **two** thresholds, distinguished by whether the submission ever recorded a job ID:

| Condition                          | Threshold (env var)                     | Default | `remarks` written                                   |
|------------------------------------|-----------------------------------------|---------|-----------------------------------------------------|
| `in_progress`, `opusJobId IS NULL` | `VERIFICATION_SUBMIT_STUCK_MINUTES`     | 60 min  | `Verification did not start in time, please retry.` |
| `in_progress`, `opusJobId` present | `VERIFICATION_INPROGRESS_TIMEOUT_HOURS` | 24 h    | `Error from OPUS, please check in OPUS or retry`    |

The split exists because the two cases are genuinely different. A `NULL`-job row means the **submission run crashed before it ever reached Opus** — "check in OPUS" would be misleading, nothing is there — so the remark instead tells the user to retry. A row with a job ID means **Opus accepted the job and never finished it**, so the OPUS remark is accurate. The short 60-minute window is safe for the first case: a healthy submission run completes its per-attempt work in seconds to a few minutes, so 60 minutes is unambiguously a crash — and it lets the user retry within the hour instead of waiting a full day.

- **Age = `now - attempt.updatedAt`.** Reliable because **no code path touches `updatedAt` while a row sits at `in_progress`**: the submission job sets it at the `queued → in_progress` flip and again when it writes `opusJobId`, and the poll job's "still running" branch (§7.1) deliberately writes nothing. `updatedAt` is a stable "verification started at" marker, **not** "last polled at" — polling does not reset the clock.
- **Force-fail** = `finalizeAttempt({ status: "failed", remarks: <per the table> })`, which also mirrors `statement.verificationStatus = failed`.
- A non-timed-out `NULL`-job row is *skipped*, never failed, so the poll job cannot clobber an attempt an in-flight submission run is still working on (§7.1).
- Once failed, the statement is terminal again and "Retry Verification" (terminal-status-gated, `statement.md` §8.2) becomes available to the user.
- **Known limitation:** if a submission crashes *after* Opus accepted the job but *before* `opusJobId` was persisted, the 60-minute timeout fails the attempt and the user's retry spawns a **new** Opus job — the original runs orphaned. Eliminating this would need an Opus-side idempotency key (send `attemptId` with `/submission`), which depends on Opus capabilities not in the docs we have (§11), so it is not designed for here.

---

## 8. Status transitions, transactions & error handling

### 8.1 Shared transition helper

**New file:** `src/lib/verification.ts` — server-only DB helpers shared by both scripts, so the denormalization invariant (§2.1) lives in exactly one place.

```ts
import { db } from "@/db";
import { statement, statementVerificationAttempt } from "@/db/schema";
import { eq } from "drizzle-orm";

type Terminal = "success" | "failed";

/** Apply a terminal outcome to an attempt AND mirror it onto the parent statement, atomically. */
export async function finalizeAttempt(input: {
  attemptId: string;
  statementId: string;
  status: Terminal;
  opusResponse?: unknown;
  remarks: string | null;
}): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(statementVerificationAttempt)
      .set({
        status: input.status,
        opusResponse: input.opusResponse ?? null,
        remarks: input.remarks,
        updatedAt: now,
      })
      .where(eq(statementVerificationAttempt.id, input.attemptId));
    await tx.update(statement)
      .set({ verificationStatus: input.status, updatedAt: now })
      .where(eq(statement.id, input.statementId));
  });
}
```

The submission job's batch-claim step (§6.1 Step 1) does the `queued → in_progress` mirror inline because it operates on a whole batch in one transaction; every **terminal** transition in both jobs goes through `finalizeAttempt`.

**Do not reuse the portal's `transitionVerificationStatus`.** `src/app/(app)/claims/statements/_actions.ts` already defines a *private* helper of that name, but it is a different operation — it only ever transitions **to `queued`** and **INSERTs a new attempt row** — and it lives in a `"use server"` file (importing `revalidatePath` / `redirect`) that a standalone `tsx` script cannot import. `finalizeAttempt` is intentionally separate: it lives in `src/lib/verification.ts` (no `"use server"`, no Next.js imports) and **mutates the existing row in place**, never inserting.

### 8.2 Error → outcome table

| Failure point                                        | Job        | Attempt `status` | `remarks` (verbatim)                                            |
|------------------------------------------------------|------------|------------------|-----------------------------------------------------------------|
| Linked claim has zero receipts                       | Submission | `failed`         | `No receipts on the linked claim to verify against.`            |
| Statement file or a receipt file un-downloadable, or claim's Drive folder missing | Submission | `failed`         | `File/Folder is not found, please check in Google Drive.`       |
| Opus `/submission` errors (timeout, 5xx, malformed)  | Submission | `failed`         | `Error from OPUS, please check in OPUS or retry`                |
| Opus reports the job failed                          | Update     | `failed`         | `Error from OPUS, please check in OPUS or retry`                |
| `in_progress` + `opusJobId`, past the 24h timeout (§7.4)       | Update | `failed`   | `Error from OPUS, please check in OPUS or retry`                |
| `in_progress` + no `opusJobId`, past the 60-min timeout (§7.4) | Update | `failed`   | `Verification did not start in time, please retry.`             |
| Opus `/checkStatus` errors (transient)               | Update     | *unchanged* (`in_progress`) | *unchanged* — retried next cycle (§7.2)               |

Every `failed` write also mirrors `statement.verificationStatus = failed` via `finalizeAttempt`. There are **four** fixed `remarks` strings — two verbatim from `new-new.md` (`File/Folder is not found, please check in Google Drive.` and `Error from OPUS, please check in OPUS or retry`) and two added by grilled decisions on 2026-05-21 (`No receipts on the linked claim to verify against.` and `Verification did not start in time, please retry.`). All four are fixed copy — do not interpolate error details into them; the raw error goes to `console.error` and, where available, into `opusResponse`.

### 8.3 One bad attempt must not abort the batch

Each attempt is processed in its own `try/catch`. A failure (Drive or Opus) is recorded against *that* attempt and the loop continues to the next — exactly like `fx-scheduler.ts` continuing its currency loop after a `fetchRate` returns `null`. An unexpected throw outside the per-attempt `try` (e.g. the DB itself is down) propagates to the top-level `.catch()` and exits non-zero.

### 8.4 Interaction with statement edits & soft-delete

- **Soft-deleted statements** (`statement.deletedAt` set by the claim cascade, `statement.md` §3.4) are filtered out by the `isNull(statement.deletedAt)` clause in both batch queries. An attempt whose statement gets soft-deleted mid-flight is simply not picked up again; if Opus later returns a result for it, the update job skips it. This is the tolerance `statement.md` §8.5 requires of this workstream.
- **Statement edits** cannot race the scheduler: `statement.md` §8.5 freezes editing/deleting while `verificationStatus IN ('queued','in_progress')`. Once this workstream flips a statement to `in_progress`, the portal's Edit/Delete are locked until a terminal status is reached — so no file/claim re-link can occur under a running job.

---

## 9. Verification history surface

The verification-history UI is **already built** by `statement.md` — `VerificationHistoryAccordion.tsx` renders all five statuses, status-tinted panels, the stale-attempt chip, and pretty-prints `opusResponse`. Once the schedulers run, those components light up automatically with real `in_progress` / `success` / `failed` data and real `opusJobId` values. **The only change this workstream makes to the UI is surfacing the new `remarks` field.**

### 9.1 Render `remarks` in the accordion

**File:** `src/app/(app)/claims/statements/_components/VerificationHistoryAccordion.tsx`

1. Add `remarks: string | null` to the exported `AttemptRow` type.
2. In the expanded panel of `AttemptItem`, when `attempt.remarks` is non-empty, render it **above** the "Opus Response" block as a labelled line — e.g. a `Remarks` caption + the text, using the same `panel.color` as the surrounding status panel so a `failed` remark reads in red, consistent with the existing `STATUS_PANEL_STYLE`.
3. For a `failed` attempt the remarks line is the primary, human-readable explanation; `opusResponse` (if present) remains below as the raw detail.

### 9.2 Pass `remarks` from the Detail page query

**File:** `src/app/(app)/claims/statements/[id]/page.tsx`

The attempt query (`db.select({ ... }).from(statementVerificationAttempt)`) selects an explicit column list. Add `remarks: statementVerificationAttempt.remarks` to that `select`, and include it in the object passed to `<VerificationHistoryAccordion attempts={...} />`.

No other Detail-page change. The collapsed header, timestamp, trigger sub-label, and stale logic all already work.

### 9.3 No new route or table component

`new-new.md` item 3 ("verification history table will be under claims - statement page") describes a surface that **already exists** — it is the accordion on `/claims/statements/[id]`, built per UI Spec §6.5. Do **not** create a new page or a separate table. This workstream only makes that existing surface show scheduler-produced data, plus `remarks`.

---

## 10. Scheduling the jobs

These are standalone `tsx` scripts, exactly like `src/scripts/fx-scheduler.ts`. They are **not** Next.js routes and run no server — an external scheduler invokes them on an interval. This matches the only scheduler precedent in the codebase (`npm run fx-scheduler`).

### 10.1 `package.json`

Add two scripts next to the existing `"fx-scheduler"`:

```json
"verification-submit": "tsx src/scripts/verification-submit.ts",
"verification-poll": "tsx src/scripts/verification-poll.ts"
```

### 10.2 Cron / Task Scheduler

Run from the project root so `dotenv` finds `.env` and the `@/` path alias resolves (as `fx-scheduler` already does).

**Linux/macOS cron:**
```
*/3  * * * *  cd /path/to/finance-coe-app && npm run verification-submit >> logs/verification-submit.log 2>&1
*/10 * * * *  cd /path/to/finance-coe-app && npm run verification-poll   >> logs/verification-poll.log 2>&1
```

**Windows Task Scheduler** (this project's dev environment): two tasks, triggers "repeat every 3 minutes" and "every 10 minutes", action `npm run verification-submit` / `verification-poll` with **Start in** set to the project directory.

### 10.3 Overlap safety

Overlapping **submission** runs are made safe by `FOR UPDATE ... SKIP LOCKED` in the batch-claim transaction (§6.1) — a late-starting run claims a disjoint batch (or an empty one) instead of blocking or double-processing. Overlapping **poll** runs need no lock at all: every poll operation is idempotent (§7.3), so the worst case is one redundant, harmless `checkStatus` read. Batch sizes are small (5) so runs are short; if Opus latency makes a run exceed its interval, throughput self-limits rather than corrupting state. No external lock file is required.

### 10.4 No cache revalidation

The schedulers run outside the Next.js runtime — they cannot call `revalidatePath`, and they do not need to. `/claims/statements` and `/claims/statements/[id]` are both **dynamically rendered**: each page calls `requireRole`, which reads the session cookie, so Next.js re-runs the DB query on every request. Scheduler-written status changes therefore appear on the user's next page load or refresh with no invalidation step.

---

## 11. Assumptions to confirm

`new-new.md` specifies the Opus base URL and the two paths, but not the wire contract. The following are **assumptions** baked into §5; all are isolated inside `src/lib/opus.ts`, so confirming/correcting them is a localized edit that does not touch the scheduler algorithms:

1. **Auth** — `Authorization: Bearer ${OPUS_API_KEY}`. Opus may instead use an API-key header or query param.
2. **Submission request** — `multipart/form-data` carrying the statement + receipt files. Opus may instead expect Drive file IDs/links (in which case §6.2's download step is skipped entirely and files are passed by reference).
3. **Submission response** — JSON containing a job-execution identifier; this spec calls the field `jobExecutionId` and maps it to `opusJobId` / `JOB_EXECUTION_ID`.
4. **`checkStatus` request** — `POST` with `{ jobExecutionId }`. Could be `GET /checkStatus?jobExecutionId=...`.
5. **`checkStatus` response** — a status field that normalizes to `in_progress` / `success` / `failed`. The exact Opus vocabulary and the normalization map live in one commented block in `opus.ts`.
6. **HTTP method** — both endpoints assumed `POST`. Adjust in `opus.ts` if `/checkStatus` is a `GET`.

Whatever the real shapes, the contract the rest of this spec relies on is just: *submit returns a job id; checkStatus returns one of three states*. Keep that boundary intact and the schedulers need no changes.

---

## 12. Files touched

| File                                                                  | Action  | Purpose                                                              |
|-----------------------------------------------------------------------|---------|----------------------------------------------------------------------|
| `src/db/schema/statementVerificationAttempt.ts`                       | Edit    | Add `remarks: text("remarks")` column.                               |
| `drizzle/0008_*.sql`                                                  | Generate| `ALTER TABLE ... ADD COLUMN "remarks" text` — latest existing is `0007_*`. |
| `src/lib/opus.ts`                                                     | New     | Opus HTTP client: `submitVerification`, `checkVerificationStatus`, `OpusError`. |
| `src/lib/verification.ts`                                             | New     | `finalizeAttempt` — terminal transition + statement mirror, in one transaction. |
| `src/lib/drive.ts`                                                    | Edit    | Add `downloadDriveFileAsBlob`.                                       |
| `src/scripts/verification-submit.ts`                                  | New     | Submission scheduler (§6).                                          |
| `src/scripts/verification-poll.ts`                                    | New     | Update/poll scheduler (§7).                                         |
| `src/app/(app)/claims/statements/_components/VerificationHistoryAccordion.tsx` | Edit | Render `remarks`.                                          |
| `src/app/(app)/claims/statements/[id]/page.tsx`                       | Edit    | Select `remarks` and pass it to the accordion.                       |
| `package.json`                                                        | Edit    | Add `verification-submit` and `verification-poll` npm scripts.       |
| `.env.example`                                                        | Edit    | Document the new `OPUS_*` / `VERIFICATION_*` keys.                   |

---

## 13. Test checklist

1. **Migration** — `db:generate` + `db:migrate`; confirm `remarks` exists and existing rows are `NULL`.
2. **Happy path, submission** — create a `queued` attempt (upload a statement with the "Start verification immediately" box, or click "Start Verification"). Run `npm run verification-submit`. Expect: attempt `in_progress`, `opusJobId` populated, `statement.verificationStatus = in_progress`, Detail accordion shows the In Progress panel.
3. **Happy path, poll** — with an `in_progress` attempt, run `npm run verification-poll`. Stub Opus to return `success`. Expect: attempt `success`, `opusResponse` populated, `remarks` NULL, statement status mirrored, accordion green.
4. **Drive failure** — point a statement's `driveFileId` at a non-existent file; run submit. Expect: attempt `failed`, `remarks = "File/Folder is not found, please check in Google Drive."`, statement mirrored, accordion shows the remark in red.
5. **Opus submission failure** — stub `/submission` to time out; run submit. Expect: attempt `failed`, `remarks = "Error from OPUS, please check in OPUS or retry"`.
6. **Opus reports failed** — stub `/checkStatus` to return `failed`; run poll. Expect: attempt `failed` with the Opus remark.
7. **Transient checkStatus error** — stub `/checkStatus` to 503; run poll. Expect: attempt stays `in_progress`, no `remarks`, error logged; a second run with a `success` stub finalizes it.
8. **Batch cap** — queue 7 attempts; one submit run processes exactly 5 (oldest first by `createdAt`); the next run takes the remaining 2.
9. **Overlap** — start two submit runs concurrently against the same backlog; confirm no attempt is processed twice (`SKIP LOCKED`).
10. **24h timeout** — force an `in_progress` attempt **with an `opusJobId`** to have `updatedAt` older than `VERIFICATION_INPROGRESS_TIMEOUT_HOURS`; run poll. Expect: force-failed, `remarks = "Error from OPUS, please check in OPUS or retry"`.
11. **Soft-deleted statement** — soft-delete a claim with a `queued` attempt; run submit. Expect: the attempt is skipped, no error.
12. **Retry loop** — after a `failed` attempt, click "Retry Verification" (existing statement.md flow), confirm a fresh `queued` attempt is created and the schedulers pick it up.
13. **In-flight protection** — create an `in_progress` attempt with `opusJobId = NULL` and a *recent* `updatedAt`; run poll. Expect: the row is skipped untouched (not failed), confirming the poll job won't clobber an attempt a submission run is still processing.
14. **60-min crashed-submit timeout** — create an `in_progress` attempt with `opusJobId = NULL` and `updatedAt` older than `VERIFICATION_SUBMIT_STUCK_MINUTES`; run poll. Expect: force-failed, `remarks = "Verification did not start in time, please retry."`
15. **Zero receipts** — queue a verification for a statement whose claim has no receipt rows; run submit. Expect: attempt `failed` with **no** Opus call made, `remarks = "No receipts on the linked claim to verify against."`
