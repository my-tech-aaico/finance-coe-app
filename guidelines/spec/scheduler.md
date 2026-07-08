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

1. **Submission workflow** — a scheduled job that picks up `queued` verification attempts, pulls the statement + receipt files from Google Drive, runs the Opus submission call sequence (upload each file → Initiate → Execute, per `opus-api.md` §2), and records the returned job execution ID.
2. **Update workflow** — a second scheduled job that polls Opus for `in_progress` attempts and writes back the terminal `success` / `failed` outcome. On `success` it also fetches the Opus-produced output file from the job audit log and uploads it to the claim's Drive **netsuite** folder (§7.5).
3. **Verification history surface** — the accordion on the Statement Detail page already renders all five statuses and `opusResponse`; this workstream adds the one missing field (`remarks`) so failure reasons — and success-with-warning notes — are visible.

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
| `in_progress` | `success` / `failed` | **Update job**    | Job polls Opus `getJobStatus`; on `success` uploads the result file (§7.5), then writes the terminal outcome. |
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

The full Opus wire contract — endpoints, bodies, status vocabulary — lives in the companion
**`opus-api.md`** (§9 there is the canonical config-key list). The keys are summarized here:

| Variable                          | Example                       | Purpose                                                                                  |
|------------------------------------|-------------------------------|------------------------------------------------------------------------------------------|
| `OPUS_API_URL`                     | `https://operator.opus.com`   | Base URL of the Opus Operator service (`opus-api.md` §1).                                 |
| `OPUS_SERVICE_KEY`                 | `svc-...`                      | Value of the `x-service-key` header sent on every Opus call (`opus-api.md` §1).          |
| `OPUS_WORKFLOW_ID`                 | `d1fa11aa-...`                | `workflowId` for the Initiate call (`opus-api.md` §5).                                    |
| `OPUS_WORKFLOW_VERSION`            | `37.0`                        | `version` for the Initiate call (`opus-api.md` §5).                                       |
| `OPUS_CALLBACK_URL`                | *(unset)*                     | **Optional, future use.** When set, sent as `callbackUrl` on Execute; otherwise omitted. No callback route exists yet (`opus-api.md` §6). |
| `OPUS_VAR_STATEMENT`              | `workflow_input_...`          | Execute payload key for the statement file (`opus-api.md` §6).                            |
| `OPUS_VAR_RECEIPTS`              | `workflow_input_...`          | Execute payload key for the receipts array (`opus-api.md` §6).                            |
| `OPUS_VAR_DESTINATION`           | `workflow_input_...`          | Execute payload key holding the literal `"netsuite"` (`opus-api.md` §6).                  |
| `OPUS_VAR_NETSUITE_FOLDER`       | `workflow_input_...`          | Execute payload key for the netsuite folder id (`opus-api.md` §6).                        |
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
| `remarks`  | `text`, nullable | Human-readable note explaining a non-obvious outcome. Written by the schedulers on **failure** (the messages in §8), and also on **`success`** when the verification succeeded but the result file could not be written to Drive (§7.5 — the attempt stays `success`, the remark records the upload error). `NULL` for `queued`, `in_progress`, and clean `success` rows. Surfaced in the accordion (§9). |

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

A thin, server-only HTTP client. It contains **no DB access** — purely Opus I/O — so it is unit-testable and reusable by both scheduler scripts. **The wire contract (URLs, headers, bodies, status vocabulary, audit-log shape) is fully specified in `opus-api.md`; this section lists only the TypeScript surface the schedulers call.** When the real API drifts, fix `opus-api.md` and this one file — §6/§7 depend only on the named functions/fields below.

Auth is the `x-service-key` header (`opus-api.md` §1), **not** a Bearer token. Every call uses `AbortSignal.timeout(OPUS_REQUEST_TIMEOUT_MS)`.

### 5.1 Submission-side functions (used by §6)

```ts
// opus-api.md §3 — get a presigned upload URL for one file
export async function getUploadUrl(input: {
  fileExtension: string;     // ".pdf"
  originalName: string;      // "receipt_2.pdf"
}): Promise<{ presignedUrl: string; fileUrl: string }>;

// opus-api.md §4 — PUT the file bytes to the presigned URL (no x-service-key here)
export async function uploadFileToPresignedUrl(input: {
  presignedUrl: string;
  body: Buffer;              // buffered (≤10MB) so Content-Length is known — opus-api.md §4
  contentType: string;       // statement.fileMimeType, or Drive metadata mime for receipts
}): Promise<void>;

// opus-api.md §5 — start a job
export async function initiateJob(): Promise<{ jobExecutionId: string }>;

// opus-api.md §6 — run the job against the uploaded fileUrls
export async function executeJob(input: {
  jobExecutionId: string;
  statementFileUrl: string;
  receiptFileUrls: string[];
  netsuiteFolderId: string;
}): Promise<{ raw: unknown }>;   // raw stored into opusResponse
```

`executeJob` builds the `jobPayloadSchemaInstance` from the `OPUS_VAR_*` keys and includes `callbackUrl` only when `OPUS_CALLBACK_URL` is set (`opus-api.md` §6). It treats a non-2xx HTTP status **or** an inner `statusCode >= 400` as a failed Execute → throws `OpusError`.

### 5.2 Update-side functions (used by §7)

```ts
// opus-api.md §7 — GET status, normalized to an internal state
export type OpusJobState = "in_progress" | "success" | "failed";
export async function getJobStatus(jobExecutionId: string): Promise<{
  state: OpusJobState;
  rawStatus: string;   // the raw Opus value: in_progress|completed|failed|timed_out|stopped
  raw: unknown;        // full parsed body — stored into opusResponse
}>;

// opus-api.md §8 — fetch audit log and extract the single base64 output file
export async function getJobResultFile(jobExecutionId: string): Promise<{
  buffer: Buffer;            // decoded from Output.execution_output base64_file_content
  fileTitle: string;        // Output.execution_output file_title (name without extension)
  netsuiteFolderId: string; // Output.execution_output netsuite_folder_id (a Drive folder id)
} | null>;                   // null when no base64_file_content is present
```

The audit log is **not** returned for storage — it embeds the whole file as base64 (`opus-api.md` §8). `opusResponse` on success holds the small `getJobStatus` body only.

`getJobStatus` owns the raw→`state` normalization map (`opus-api.md` §7.1) in **one** clearly-commented block: `completed → success`; `failed`/`timed_out`/`stopped → failed`; `in_progress` (and any unrecognized value) → `in_progress`. The caller (§7) maps the distinct raw failure values to distinct `remarks`.

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

**Step 2 — Per attempt: upload files, initiate, execute, record.** Iterate `claimed` **sequentially** (not `Promise.all` — keeps Drive/Opus load predictable and log output readable, matching `fx-scheduler.ts`'s sequential loop). Each attempt runs the Opus submission call sequence (`opus-api.md` §2). For each row:

1. **Load receipts** for `claimId`: `SELECT id, driveFileId, fileName FROM receipt WHERE claimId = ?`. **If this returns zero rows**, the claim has nothing to cross-check the statement against — fail the attempt immediately via `finalizeAttempt({ attemptId, statementId, status: "failed", remarks: "No receipts on the linked claim to verify against." })` and skip to the next attempt (no Drive download, no Opus call). See §6.3.
2. **Upload each file to Opus** — the statement file (`statementDriveFileId`) and every receipt's `driveFileId` (1 statement + N receipts, up to ~20, ≤10 MB each — `opus-api.md` §2). For each file:
   - `getUploadUrl({ fileExtension, originalName })` derived from the stored `fileName` → `{ presignedUrl, fileUrl }`.
   - Download the file from Drive into a `Buffer` (`downloadDriveFileAsBuffer`, §6.2) and `uploadFileToPresignedUrl({ presignedUrl, body: buffer, contentType })`. `contentType` is `statement.fileMimeType` for the statement, or the Drive-metadata `mimeType` for a receipt (the `receipt` table has no MIME column). Buffering keeps `Content-Length` known (`opus-api.md` §4).
   - Collect the returned `fileUrl`s, tracking which is the statement and which are receipts.
   - Any Drive download failure or upload-URL/PUT failure (404 file-not-found, folder-not-found, permission) → **fail this attempt** with `remarks = "File/Folder is not found, please check in Google Drive."` (verbatim from `new-new.md`). Skip to the next attempt. See §8.
3. **Initiate** via `initiateJob()` (`opus-api.md` §5) → `jobExecutionId`. **Persist it immediately** (own transaction), status stays `in_progress`:

```ts
await db.update(statementVerificationAttempt)
  .set({ opusJobId: jobExecutionId, updatedAt: new Date() })
  .where(eq(statementVerificationAttempt.id, row.attemptId));
```

   Persisting before Execute is deliberate: if Execute then fails, the row still carries the `opusJobId`, so the §7.4 **24h** timeout (not the 60-min crashed-submit timeout) governs cleanup. See §7.4's known-limitation note.
4. **Execute** via `executeJob({ jobExecutionId, statementFileUrl, receiptFileUrls, netsuiteFolderId: row.claimDriveNetsuiteFolderId })` (`opus-api.md` §6).
   - `OpusError` of any `kind` (incl. an inner `statusCode >= 400`) → **fail this attempt** with `remarks = "Error from OPUS, please check in OPUS or retry"` (verbatim from `new-new.md`). Skip to the next attempt. (The `opusJobId` from step 3 remains; the row is now `failed`, so the poll job skips it.)
5. **On success** — record the Execute response:

```ts
await db.update(statementVerificationAttempt)
  .set({ opusResponse: executeResult.raw, updatedAt: new Date() })
  .where(eq(statementVerificationAttempt.id, row.attemptId));
// status stays "in_progress"; statement.verificationStatus already "in_progress" from Step 1.
```

The attempt now sits at `in_progress` with a populated `opusJobId`, ready for the update job (§7).

> **Add `claim.driveNetsuiteFolderId` to the §6.1 batch-claim select** (`claimDriveNetsuiteFolderId: claim.driveNetsuiteFolderId`) so Execute can pass it. The column already exists (`src/db/schema/claim.ts`).

**Step 3 — Summary log + exit.** `console.log("[verification-submit] Done in ${ms}ms. Submitted: ${ok}, Failed: ${failed}, Empty batch: ${claimed.length === 0}.")`, then `process.exit(failed > 0 ? 1 : 0)`. A non-zero exit lets the cron host surface a partial failure. **Always exit explicitly** — `src/db/index.ts` opens a `pg.Pool` at module load whose connections keep the Node event loop alive until they idle out, so a script that merely returns from `main()` lingers for ~10s (a latent rough edge in `fx-scheduler.ts`'s success path). An explicit `process.exit()` terminates immediately.

### 6.2 Drive download helper

**File:** `src/lib/drive.ts` — add a small buffering wrapper over the existing `downloadDriveFile`:

```ts
export async function downloadDriveFileAsBuffer(
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const { stream, mimeType } = await downloadDriveFile(fileId);
  const buffer = Buffer.from(await new Response(stream).arrayBuffer());
  return { buffer, mimeType };
}
```

Buffering (rather than passing the raw `ReadableStream` to the PUT) keeps `Content-Length` known and avoids `duplex: "half"` / HTTP 411 issues with presigned hosts (`opus-api.md` §4); files are ≤10 MB.

`downloadDriveFile` throws on a missing file — that throw is what Step 2.2 catches. A Google Drive 404 surfaces as an error whose `code`/`status` is `404`; classify "file/folder not found" by catching the throw broadly (any download error → the file-not-found `remarks`), since from the scheduler's perspective an un-downloadable file is functionally "not found." The `mimeType` is taken from `downloadDriveFile`'s Drive metadata lookup — required because the `receipt` table stores **no** MIME column (only `statement.fileMimeType` is persisted), so receipt files have no portal-side type to fall back on.

*(The result-upload step in §7.5 also needs a new Drive **write** helper, `uploadDriveFileFromBuffer` — see §7.5.)*

### 6.3 What gets sent to Opus

Per `new-new.md`: pull the statement file and all receipt files from Google Drive, upload each to Opus, then Execute referencing their `fileUrl`s. Opus cross-checks the statement against its receipts. The submission therefore includes **the one statement file + every receipt file on the claim.**

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
- **`opusJobId` present** — call `getJobStatus(opusJobId)` (§5.2), which normalizes the raw Opus value (`opus-api.md` §7.1):
  - `state: "success"` (raw `completed`) → fetch the result file and upload it to Drive, then finalize (§7.5). Outcome is `finalizeAttempt({ attemptId, statementId, status: "success", opusResponse: statusRaw, remarks: <null, or the upload-error note> })` — `statusRaw` is the small `getJobStatus` body; the audit log is **never** stored (`opus-api.md` §8).
  - `state: "failed"` → finalize as `failed` with the remark **chosen by `rawStatus`** (distinct messages, `opus-api.md` §7.1):
    - raw `failed` → `remarks = "Error from OPUS, please check in OPUS or retry"`
    - raw `timed_out` → `remarks = "Verification timed out in OPUS, please retry."`
    - raw `stopped` → `remarks = "Verification was stopped in OPUS, please check in OPUS or retry."`
    - via `finalizeAttempt({ attemptId, statementId, status: "failed", opusResponse: raw, remarks: <above> })`.
  - `state: "in_progress"` (raw `in_progress` or any unrecognized value) → still running. If **`ageMs > TIMEOUT_MS`** (default 24h), force-fail (§7.4) with `remarks = "Error from OPUS, please check in OPUS or retry"`; otherwise **make no DB write** — leaving the row untouched keeps `updatedAt` frozen so the §7.4 clock keeps counting.
  - **`OpusError` thrown** — `getJobStatus` itself failed (timeout, 5xx). **Transient** — if `ageMs > TIMEOUT_MS`, force-fail (§7.4) with the OPUS remark (Opus has been unreachable too long to keep waiting); otherwise log and skip (no write), and the next cycle retries.

**Step 3 — Summary log + exit**, same shape as §6.1 Step 3 (log prefix `[verification-poll]`, explicit `process.exit`).

### 7.2 Why a status-check failure is not a hard fail

The submission job fails fast on Opus errors because a failed submission means *no job was ever created* — there is nothing to recover, and the user must retry. The update job is the opposite: a job **is** running inside Opus; a flaky `getJobStatus` response says nothing about that job. Hard-failing here would discard a verification that may well be succeeding. So `getJobStatus` errors are retried indefinitely, bounded only by §7.4.

### 7.3 Idempotency — and why the poll job takes no lock

The poll job intentionally uses **no `FOR UPDATE`**. Every poll operation is idempotent: `getJobStatus` and `getJobResultFile` are reads on the Opus side; the §7.5 result upload **overwrites by name** (`opus-api.md` §8.2), so two concurrent uploads of the same `completed` job write the same content to the same file rather than duplicating it; and `finalizeAttempt` re-applies a terminal state (re-writing the same `success`/`failed` payload has no net effect). If two poll runs overlap and pick the same row, the worst case is one extra harmless Opus read and a redundant Drive overwrite (tiny residual race window, acceptable).

Avoiding the lock is deliberate: holding `FOR UPDATE` across the `getJobStatus` + result-upload I/O would pin a DB connection for multiple network round-trips. The submission job *can* lock (§6.1) precisely because its locked transaction does no I/O — only a `SELECT` and two `UPDATE`s.

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
- **Known limitation:** the submission flow now persists `opusJobId` immediately after **Initiate**, *before* **Execute** (§6.1 Step 3), which shrinks the orphan window — a crash after Initiate but before the persist leaves a `NULL`-job row whose Opus job was created but never executed; the 60-minute timeout fails it and the user's retry spawns a **new** job, orphaning the empty initiated one. Eliminating this entirely would need an Opus-side idempotency key on Initiate, not available in the contract we have (`opus-api.md`), so it is not designed for here.

### 7.5 Fetching the result file and uploading it to Drive (success branch)

On `state: "success"` (raw `completed`), before finalizing, the poll job retrieves the single Opus-produced output file and writes it into the claim's **netsuite** Drive folder. Opus's own `Upload to Google Drive` node fails intermittently, so **the app owns this upload** (decision 2026-06-15, `opus-api.md` §8.2).

Steps (full contract in `opus-api.md` §8):

1. `getJobResultFile(opusJobId)` → fetches the audit log and reads `audit.nodes_execution_data["Output"].execution_output`, returning `{ buffer, fileTitle, netsuiteFolderId }`:
   - `buffer` — base64-decoded `base64_file_content`. **Exactly one** file expected.
   - `fileTitle` — the result file's name **without** extension (`file_title`).
   - `netsuiteFolderId` — the **Drive** folder id to upload into (`netsuite_folder_id`; Opus echoes back the Drive folder id). Fall back to `claim.driveNetsuiteFolderId` if absent.
2. Detect the extension from the bytes (magic bytes — `opus-api.md` §8.1: `%PDF`→`.pdf`, `PK`→`.xlsx`, UTF-8 header with `EXTERNALID`/`ID,`/`DATE,`→`.csv`). Final filename = `fileTitle` + extension; `mimeType` derived from the extension.
3. Upload via `uploadDriveFileFromBuffer(netsuiteFolderId, fileName, buffer, mimeType)` (below). Because the name is deterministic and Opus reuses it across retries, the helper **overwrites by name** (find-then-update, else create) — `opus-api.md` §8.2. The poll select does **not** need the netsuite folder (it comes from the audit log); keep the `claim` join only for the `driveNetsuiteFolderId` fallback.
4. **Finalize as `success` regardless of the upload outcome:**
   - upload OK → `finalizeAttempt({ ..., status: "success", opusResponse: statusRaw, remarks: null })`.
   - `getJobResultFile` returned `null` (no `base64_file_content`) → `success` with `remarks = "Verification succeeded but no result file was returned by OPUS."`
   - upload threw → `success` with `remarks = "Verification succeeded but the result file could not be uploaded to Google Drive."` (decision 2026-06-15 — the verification itself succeeded; the upload error is recorded, not a failure). Log the underlying error to `console.error`.

**New Drive write helper — `src/lib/drive.ts`:**

```ts
export async function uploadDriveFileFromBuffer(
  parentFolderId: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ fileId: string; webViewLink: string }>;
```

Overwrite-by-name semantics: `drive.files.list` with `q = name='<filename>' and '<parentFolderId>' in parents and trashed=false` (`supportsAllDrives: true`); if a match exists, `drive.files.update({ fileId, media })`; otherwise `drive.files.create` mirroring `uploadStatementFile` (`bufferToStream`, `supportsAllDrives: true`). Takes a `Buffer` + explicit `mimeType` (the scheduler has decoded bytes, not a `File`).

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
| Statement file or a receipt file un-downloadable / un-uploadable, or claim's Drive folder missing | Submission | `failed`         | `File/Folder is not found, please check in Google Drive.`       |
| Opus submission errors — GetUploadURL / Initiate / Execute (timeout, 5xx, inner `statusCode >= 400`, malformed) | Submission | `failed` | `Error from OPUS, please check in OPUS or retry` |
| Opus reports job `failed` (raw `failed`)             | Update     | `failed`         | `Error from OPUS, please check in OPUS or retry`                |
| Opus reports job `timed_out`                         | Update     | `failed`         | `Verification timed out in OPUS, please retry.`                 |
| Opus reports job `stopped`                           | Update     | `failed`         | `Verification was stopped in OPUS, please check in OPUS or retry.` |
| `in_progress` + `opusJobId`, past the 24h timeout (§7.4)       | Update | `failed`   | `Error from OPUS, please check in OPUS or retry`                |
| `in_progress` + no `opusJobId`, past the 60-min timeout (§7.4) | Update | `failed`   | `Verification did not start in time, please retry.`             |
| Opus `completed` but no `base64_file_content` in audit log (§7.5) | Update | **`success`** | `Verification succeeded but no result file was returned by OPUS.` |
| Opus `completed`, result file Drive upload failed (§7.5) | Update | **`success`** | `Verification succeeded but the result file could not be uploaded to Google Drive.` |
| Opus `getJobStatus` errors (transient)               | Update     | *unchanged* (`in_progress`) | *unchanged* — retried next cycle (§7.2)               |

Every `failed` write mirrors `statement.verificationStatus = failed` via `finalizeAttempt`; the two `success` rows above mirror `success` with a non-null `remarks` (the only case where `remarks` accompanies a non-failure). There are **eight** fixed `remarks` strings — all are fixed copy, do not interpolate error details into them; the raw error goes to `console.error` and, where available, into `opusResponse`. Provenance: `File/Folder is not found, please check in Google Drive.` and `Error from OPUS, please check in OPUS or retry` are verbatim from `new-new.md`; `No receipts on the linked claim to verify against.` and `Verification did not start in time, please retry.` from grilled decisions 2026-05-21; the `timed_out`/`stopped`/two `success` strings from decisions 2026-06-15.

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
2. In the expanded panel of `AttemptItem`, when `attempt.remarks` is non-empty, render it **above** the "Opus Response" block as a labelled line — a `Remarks` caption + the text, using the same `panel.color` as the surrounding status panel so the remark reads in the status's tint, consistent with the existing `STATUS_PANEL_STYLE`. (For a `failed` attempt this is red; for a **`success` attempt carrying an upload-warning remark** (§7.5) it reads in the success tint — that is acceptable, the text itself makes the warning clear. No new panel style needed.)
3. For a `failed` attempt the remarks line is the primary, human-readable explanation. For a `success` attempt it is a non-blocking warning (result-file caveat, §7.5). `opusResponse` (if present) remains below as the raw detail in both cases.

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

Overlapping **submission** runs are made safe by `FOR UPDATE ... SKIP LOCKED` in the batch-claim transaction (§6.1) — a late-starting run claims a disjoint batch (or an empty one) instead of blocking or double-processing. Overlapping **poll** runs need no lock at all: every poll operation is idempotent (§7.3) — including the result upload, which overwrites by name — so the worst case is one redundant, harmless `getJobStatus` read and a redundant Drive overwrite. Batch sizes are small (5) so runs are short; if Opus latency makes a run exceed its interval, throughput self-limits rather than corrupting state. No external lock file is required.

### 10.4 No cache revalidation

The schedulers run outside the Next.js runtime — they cannot call `revalidatePath`, and they do not need to. `/claims/statements` and `/claims/statements/[id]` are both **dynamically rendered**: each page calls `requireRole`, which reads the session cookie, so Next.js re-runs the DB query on every request. Scheduler-written status changes therefore appear on the user's next page load or refresh with no invalidation step.

---

## 11. Assumptions & open points

The Opus wire contract is now specified concretely in `opus-api.md` (endpoints, headers, bodies, status vocabulary, audit-log shape) and is no longer assumed. The remaining open points are small and all isolated inside `src/lib/opus.ts`:

1. **Execute payload variable names** — the four `OPUS_VAR_*` keys are workflow-version-specific and carried as config (`opus-api.md` §6); confirm them against the live workflow version before first run.
2. **`base64_file_content` location** — assumed to live in the `Output` node's `execution_output` (`opus-api.md` §8). Confirm the node name is exactly `Output` in the production workflow; adjust the extraction in `getJobResultFile` if it differs.
3. **Status vocabulary completeness** — the observed values are `in_progress`/`completed`/`failed`/`timed_out`/`stopped` (`opus-api.md` §7.1). Any unrecognized future value is treated as `in_progress` and caught by the §7.4 timeout; extend the map if Opus adds states.
4. **`callbackUrl`** — currently optional/unused; the app polls (§7). Wiring a push `/opus/callback` route is future scope (`opus-api.md` §6).

Keep the boundary intact — *submission returns a job id; getJobStatus returns one of three normalized states; getJobResultFile returns one decoded file + its title + target folder* — and the scheduler algorithms need no changes.

**Implementation notes (verify at build time):**
- `FOR UPDATE OF ... SKIP LOCKED` (§6.1) is expected via Drizzle's `.for("update", { of: statementVerificationAttempt, skipLocked: true })`, supported in `drizzle-orm` 0.45.x (the installed version). Confirm the emitted SQL on first run.
- No test framework is added (§13 manual runbook). `dotenv` + `tsx` (already devDeps) are all the scripts need.

---

## 12. Files touched

| File                                                                  | Action  | Purpose                                                              |
|-----------------------------------------------------------------------|---------|----------------------------------------------------------------------|
| `src/db/schema/statementVerificationAttempt.ts`                       | Edit    | Add `remarks: text("remarks")` column.                               |
| `drizzle/0008_*.sql`                                                  | Generate| `ALTER TABLE ... ADD COLUMN "remarks" text` — latest existing is `0007_*`. |
| `src/lib/opus.ts`                                                     | New     | Opus HTTP client: `getUploadUrl`, `uploadFileToPresignedUrl`, `initiateJob`, `executeJob`, `getJobStatus`, `getJobResultFile`, `OpusError` (contract in `opus-api.md`). |
| `src/lib/verification.ts`                                             | New     | `finalizeAttempt` — terminal transition + statement mirror, in one transaction. |
| `src/lib/drive.ts`                                                    | Edit    | Add `downloadDriveFileAsBuffer` (§6.2) and `uploadDriveFileFromBuffer` with overwrite-by-name (§7.5). |
| `guidelines/spec/opus-api.md`                                         | New     | Opus Operator API wire contract (companion reference).              |
| `src/scripts/verification-submit.ts`                                  | New     | Submission scheduler (§6).                                          |
| `src/scripts/verification-poll.ts`                                    | New     | Update/poll scheduler (§7).                                         |
| `src/app/(app)/claims/statements/_components/VerificationHistoryAccordion.tsx` | Edit | Render `remarks`.                                          |
| `src/app/(app)/claims/statements/[id]/page.tsx`                       | Edit    | Select `remarks` and pass it to the accordion.                       |
| `package.json`                                                        | Edit    | Add `verification-submit` and `verification-poll` npm scripts.       |
| `.env.example`                                                        | Edit    | Document the new `OPUS_*` / `VERIFICATION_*` keys.                   |

---

## 13. Test checklist

**Manual runbook (decision 2026-06-15).** The repo has no test framework and none is added for this workstream (matching `fx-scheduler.ts`, which has no tests). Run these by hand against a sandbox Opus + a test claim; "stub" below means point `OPUS_API_URL` at a local mock or use a workflow/job known to produce that outcome. The pure helpers (status normalization, magic-byte detection) are simple enough to eyeball via a one-off `tsx` snippet.

1. **Migration** — `db:generate` + `db:migrate`; confirm `remarks` exists and existing rows are `NULL`.
2. **Happy path, submission** — create a `queued` attempt (upload a statement with the "Start verification immediately" box, or click "Start Verification"). Run `npm run verification-submit`. Stub GetUploadURL/PUT/Initiate/Execute. Expect: each file uploaded (GetUploadURL + PUT per file), `opusJobId` populated after Initiate, Execute called with the statement + receipt `fileUrl`s and `claim.driveNetsuiteFolderId`, attempt `in_progress`, `statement.verificationStatus = in_progress`, Detail accordion shows the In Progress panel.
3. **Happy path, poll + result upload** — with an `in_progress` attempt, run `npm run verification-poll`. Stub `getJobStatus` → `completed` and the audit log to return `base64_file_content`, `file_title`, and a Drive `netsuite_folder_id`. Expect: result file decoded, extension detected, uploaded as `file_title`+ext into the `netsuite_folder_id` folder; attempt `success`, `opusResponse` holds the **small status body** (not the audit log), `remarks` NULL, statement mirrored, accordion green.
3a. **Overwrite on retry** — re-verify the same statement so a second `completed` job returns the **same** `file_title`; run poll. Expect: the existing netsuite file's content is **updated in place** (one file, not two) — `opus-api.md` §8.2.
4. **Drive failure** — point a statement's `driveFileId` at a non-existent file; run submit. Expect: attempt `failed`, `remarks = "File/Folder is not found, please check in Google Drive."`, statement mirrored, accordion shows the remark in red.
5. **Opus submission failure** — stub Execute to return inner `statusCode: 500`; run submit. Expect: attempt `failed`, `remarks = "Error from OPUS, please check in OPUS or retry"` (note: `opusJobId` from Initiate remains set).
6. **Opus reports failed / timed_out / stopped** — stub `getJobStatus` to each raw value in turn; run poll. Expect: attempt `failed` with the matching remark (`Error from OPUS...` / `Verification timed out...` / `Verification was stopped...`).
7. **Transient getJobStatus error** — stub status to 503; run poll. Expect: attempt stays `in_progress`, no `remarks`, error logged; a second run with a `completed` stub finalizes it.
8. **Result file missing** — stub `completed` but an audit log with no `base64_file_content`; run poll. Expect: attempt `success` with `remarks = "Verification succeeded but no result file was returned by OPUS."`
9. **Result upload failure** — stub `completed` with a valid file, but force the Drive upload to throw; run poll. Expect: attempt **`success`** with `remarks = "Verification succeeded but the result file could not be uploaded to Google Drive."`, error logged.
10. **Extension detection** — feed `getJobResultFile` PDF, XLSX, and CSV byte samples; confirm `.pdf` / `.xlsx` / `.csv` are appended correctly and an unknown signature uploads with no extension.
11. **Batch cap** — queue 7 attempts; one submit run processes exactly 5 (oldest first by `createdAt`); the next run takes the remaining 2.
12. **Overlap** — start two submit runs concurrently against the same backlog; confirm no attempt is processed twice (`SKIP LOCKED`).
13. **24h timeout** — force an `in_progress` attempt **with an `opusJobId`** to have `updatedAt` older than `VERIFICATION_INPROGRESS_TIMEOUT_HOURS`; run poll. Expect: force-failed, `remarks = "Error from OPUS, please check in OPUS or retry"`.
14. **Soft-deleted statement** — soft-delete a claim with a `queued` attempt; run submit. Expect: the attempt is skipped, no error.
15. **Retry loop** — after a `failed` attempt, click "Retry Verification" (existing statement.md flow), confirm a fresh `queued` attempt is created and the schedulers pick it up.
16. **In-flight protection** — create an `in_progress` attempt with `opusJobId = NULL` and a *recent* `updatedAt`; run poll. Expect: the row is skipped untouched (not failed), confirming the poll job won't clobber an attempt a submission run is still processing.
17. **60-min crashed-submit timeout** — create an `in_progress` attempt with `opusJobId = NULL` and `updatedAt` older than `VERIFICATION_SUBMIT_STUCK_MINUTES`; run poll. Expect: force-failed, `remarks = "Verification did not start in time, please retry."`
18. **Zero receipts** — queue a verification for a statement whose claim has no receipt rows; run submit. Expect: attempt `failed` with **no** Opus call made, `remarks = "No receipts on the linked claim to verify against."`
