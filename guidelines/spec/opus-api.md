# Reference — Opus Operator API contract

**Companion to `scheduler.md`.** This file is the concrete wire contract for the Opus
Operator API used by the two verification schedulers (`scheduler.md` §6 submission, §7
update). `scheduler.md` describes *when* and *why* each call is made; this file describes
*exactly what goes over the wire*. When the real API drifts, correct it **here** — the
scheduler algorithms depend only on the named functions/fields below, so a wire change is a
localized edit inside `src/lib/opus.ts`.

All shapes below are taken from the verified `new-new.md` workflow notes and a real
`GetJobAuditLog` capture. They are **no longer assumptions** (they supersede the original
`scheduler.md` §11 assumption list).

---

## 1. Base URL & auth

| | |
|---|---|
| Base URL | `https://operator.opus.com` (`OPUS_API_URL`) |
| Auth | header `x-service-key: ${OPUS_SERVICE_KEY}` on **every** call **except** the presigned-URL PUT |
| Content-Type | `application/json` on all calls except the presigned PUT (which uses the file's MIME) |
| Timeout | `AbortSignal.timeout(OPUS_REQUEST_TIMEOUT_MS)` on every call |

> The presigned-URL `PUT` (§4) goes to a storage host, **not** to `operator.opus.com`, and
> carries **no** `x-service-key` — the presigned URL is itself the credential.

---

## 2. Submission call sequence (used by `scheduler.md` §6)

Per attempt, in this order:

1. **For each file** (1 statement + N receipts): `GetUploadURL` (§3) → `uploadFileToPresignedUrl` (§4).
2. `Initiate` (§5) → `jobExecutionId`. **Persist `opusJobId` immediately**, before step 3.
3. `Execute` (§6) with the `jobExecutionId` and the collected `fileUrl`s.

File constraints: exactly **1** statement file; **up to ~20** receipt files (not a hard cap);
**≤ 10 MB per file**.

---

## 3. GetUploadURL

```
POST https://operator.opus.com/job/file/upload
headers: { "Content-Type": "application/json", "x-service-key": "${OPUS_SERVICE_KEY}" }
body:
{
  "fileExtension": ".pdf",
  "originalName": "receipt_2.pdf",
  "accessScope": "all"
}
response:
{ "presignedUrl": "{PRESIGNED_URL}", "fileUrl": "{FILE_URL}" }
```

- `fileExtension` / `originalName` come from the statement's / receipt's stored `fileName`.
- Keep the returned `fileUrl` (stable Opus media URL); it is what `Execute` references.

## 4. File Upload (presigned PUT)

```
PUT {PRESIGNED_URL}
headers: { "Content-Type": "{file MIME type}" }
body: <binary file streamed from Google Drive>
response: HTTP 200, empty body
```

- **No `x-service-key`** here.
- MIME source: `statement.fileMimeType` for the statement; for receipts the `receipt` table
  stores **no** MIME, so use the `mimeType` returned by `downloadDriveFile` (Drive metadata).
- **Buffer the file, then PUT** (decision 2026-06-15). Read the Drive stream fully into a
  `Buffer` (files are ≤10 MB) and PUT it with a known `Content-Length`. A chunked
  `ReadableStream` body would need `duplex: "half"` and can trip presigned hosts that require
  an upfront `Content-Length` (HTTP 411). One file at a time, sequential.

## 5. Initiate

```
POST https://operator.opus.com/job/initiate
headers: { "Content-Type": "application/json", "x-service-key": "${OPUS_SERVICE_KEY}" }
body:
{ "workflowId": "${OPUS_WORKFLOW_ID}", "version": "${OPUS_WORKFLOW_VERSION}" }
response:
{ "jobExecutionId": "{JOB_EXECUTION_ID}" }
```

`workflowId` / `version` are configuration (env). Example values: `d1fa11aa-f1c1-4d94-b077-897263143ee5`, `"37.0"`.

## 6. Execute

```
POST https://operator.opus.com/job/execute
headers: { "Content-Type": "application/json", "x-service-key": "${OPUS_SERVICE_KEY}" }
body:
{
  "jobExecutionId": "{JOB_EXECUTION_ID}",
  "callbackUrl": "${OPUS_CALLBACK_URL}",            // OPTIONAL — see note
  "jobPayloadSchemaInstance": {
    "${OPUS_VAR_STATEMENT}": {
      "value": "{statement fileUrl}",
      "type": "file",
      "displayName": "Statement File"
    },
    "${OPUS_VAR_RECEIPTS}": {
      "value": ["{receipt fileUrl}", ...],
      "type": "array",
      "displayName": "Supporting Receipts"
    },
    "${OPUS_VAR_DESTINATION}": "netsuite",
    "${OPUS_VAR_NETSUITE_FOLDER}": {
      "value": "{claim.driveNetsuiteFolderId}",
      "type": "str",
      "displayName": "Netsuite Folder ID"
    }
  }
}
success: { "statusCode": 200, "message": "Job Started", ... }
error:   { "statusCode": 500, "message": "Request failed with status code 422", ... }
```

- The four `OPUS_VAR_*` keys are the workflow's fixed input-variable names; carry them as
  config because they are workflow-version-specific. (In the captured audit log the live
  names were `workflow_input_2b3t71ss6` = statement file, `workflow_input_mwkb503th` =
  receipts array, `workflow_input_635kk6x2s` = netsuite folder id.)
- **`callbackUrl` is optional and reserved for future use.** For now Opus completion is
  detected by **polling** (`scheduler.md` §7), not by a callback. Send the field only when
  `OPUS_CALLBACK_URL` is set; the app exposes **no** `/opus/callback` route yet. (Wiring a
  push callback is future scope.)
- Note the `error` envelope still carries HTTP 200-style JSON with an inner `statusCode`.
  Treat any inner `statusCode >= 400` (or a non-2xx HTTP status) as a failed Execute.

---

## 7. GetJobExecutionStatus (used by `scheduler.md` §7)

```
GET https://operator.opus.com/job/{jobExecutionId}/status
headers: { "x-service-key": "${OPUS_SERVICE_KEY}" }
response:
{ "status": "in_progress" }
```

### 7.1 Observed Opus status vocabulary → internal attempt status

Opus returns one of these (values observed in the live environment). Normalize in **one
commented block** in `opus.ts`:

| Opus `status` | Internal attempt `status` | Notes |
|---------------|---------------------------|-------|
| `in_progress` | `in_progress` (no write)  | keep polling, bounded by `scheduler.md` §7.4 timeout |
| `completed`   | `success`                 | triggers the result-fetch + Drive upload (§8) |
| `failed`      | `failed`                  | remark: `Error from OPUS, please check in OPUS or retry` |
| `timed_out`   | `failed`                  | remark: `Verification timed out in OPUS, please retry.` |
| `stopped`     | `failed`                  | remark: `Verification was stopped in OPUS, please check in OPUS or retry.` |

- Match case-insensitively and tolerate spacing (`IN PROGRESS`, `IN_PROGRESS`, `in_progress`
  have all appeared). Any **unrecognized** value → treat as still `in_progress` (no write),
  let §7.4 timeout catch a stuck job; log the unknown value.
- The internal `statement_verification_attempt_status` enum stays `queued|in_progress|success|failed`
  — `timed_out`/`stopped` are **not** added as internal states; they collapse to `failed`
  with distinct remarks.

---

## 8. GetJobAuditLog + result extraction (used by `scheduler.md` §7, success branch)

On `completed`, fetch the audit log and pull the single output file Opus produced.

```
GET https://operator.opus.com/job/{jobExecutionId}/audit
headers: { "x-service-key": "${OPUS_SERVICE_KEY}" }
```

Response is large (full per-node execution trace). **The audit log is never persisted** —
it embeds `base64_file_content` (the whole result file), so storing it into `opusResponse`
would bloat the DB and break the accordion's JSON renderer. On success, `opusResponse`
holds the small **GetJobExecutionStatus** body only (decision 2026-06-15). Extraction steps:

1. Read `audit.nodes_execution_data["Output"].execution_output` — an array of
   `{ variable_name, value, type, ... }`. Pull three entries:
   - `base64_file_content` — the result file, base64-encoded.
   - `file_title` — the result file's name **without** extension.
   - `netsuite_folder_id` — the **Google Drive** folder id to upload into (Opus echoes back
     the Drive folder id; it is *not* the NetSuite numeric id seen on the Region-to-Vendor
     node).
2. Decode `base64_file_content` to a `Buffer`. **Exactly one** output file is expected.
3. Detect the file extension from the decoded bytes (magic bytes — §8.1). Final filename =
   `file_title` + `_` + a **per-attempt timestamp** + detected extension (§8.2).
4. Upload the buffer to the `netsuite_folder_id` Drive folder (fall back to
   `claim.driveNetsuiteFolderId` if the audit value is missing) — see §8.2.

`getJobResultFile` therefore returns `{ buffer, fileTitle, netsuiteFolderId }` (no `raw`
for storage). If the `Output` node / `base64_file_content` entry is missing or empty: the
verification still counts as **success**, but record the problem in `remarks` (see
`scheduler.md` §8.2 error table) — do **not** flip the attempt to `failed`.

### 8.1 Extension detection (magic bytes)

Replicate this logic in TypeScript (reference is the workflow's Python):

| Signature (first bytes) | Extension |
|-------------------------|-----------|
| `25 50 44 46` (`%PDF`)  | `.pdf`    |
| `50 4B 03 04` (`PK..`)  | `.xlsx`   |
| first ~15 bytes decode as UTF-8 containing `EXTERNALID` / `ID,` / `DATE,` | `.csv` |
| otherwise               | `` (none) — log the first 4 bytes as hex |

Final filename: take a base name (e.g. `file_title`, falling back to the statement
`displayId`), append a per-attempt timestamp postfix (§8.2), then the detected extension.

### 8.2 Drive upload of the result

Upload the decoded buffer into the `netsuite_folder_id` folder using a new Drive helper
`uploadDriveFileFromBuffer(folderId, name, buffer, mimeType)` (`scheduler.md` §7.5 / §12).
This is the **only** Drive *write* the schedulers do.

**Timestamped history — one file per successful attempt (decision 2026-07-14).** The
result filename is `<base>_<timestamp><ext>`, where `<base>` is `file_title` (fallback:
statement `displayId`) and `<timestamp>` is a **per-attempt** marker derived from the
verification attempt's `updatedAt` (formatted `YYYYMMDDHHMMSS`, e.g. `20260714153045`).
Because the postfix is distinct per attempt, each successful verification writes a
**distinct file** — so a re-verify (Retry Verification, e.g. after adding a receipt) leaves
the prior result in place and **adds a second file**. The netsuite folder therefore
**accumulates a history of results, one per successful attempt**, rather than a single
current file.

The helper still uses **overwrite-by-name** (`drive.files.list` by name → `update` if
found, else `create`), but its role is now narrower: because the timestamp is sourced from
the attempt's stable `updatedAt` (not wall-clock at upload), **concurrent re-polls of the
same attempt** produce the same filename and collapse to one file (idempotency preserved),
while **separate attempts** get distinct timestamps and thus separate files.

> ⚠️ **Downstream consumers must handle multiple files.** Whatever reads the netsuite
> folder (the out-of-scope NetSuite import) can no longer assume exactly one result file
> per statement — it must pick the latest (or process each) accordingly.
>
> *Supersedes the earlier 2026-06-15 decision* ("overwrite-by-name keeps exactly one
> current result per statement; re-verify refreshes the file in place"), which is no longer
> in effect.

`mimeType` is derived from the detected extension (`.pdf`→`application/pdf`,
`.xlsx`→`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`.csv`→`text/csv`, none→`application/octet-stream`).

> **Ownership note:** the Opus workflow itself contains an `Upload to Google Drive [Request
> Builder]` node, but that Opus-side upload fails intermittently, so the **app** owns this
> upload instead (decision 2026-06-15). Do not rely on Opus to place the file.

---

## 9. Config keys (mirror `scheduler.md` §3.2 / `.env.example`)

| Variable | Example | Purpose |
|----------|---------|---------|
| `OPUS_API_URL` | `https://operator.opus.com` | Base URL |
| `OPUS_SERVICE_KEY` | `svc-...` | `x-service-key` header value |
| `OPUS_WORKFLOW_ID` | `d1fa11aa-...` | Initiate `workflowId` |
| `OPUS_WORKFLOW_VERSION` | `37.0` | Initiate `version` |
| `OPUS_CALLBACK_URL` | *(unset)* | Optional, future use; omit `callbackUrl` when unset |
| `OPUS_VAR_STATEMENT` | `workflow_input_...` | Execute payload key for the statement file |
| `OPUS_VAR_RECEIPTS` | `workflow_input_...` | Execute payload key for the receipts array |
| `OPUS_VAR_DESTINATION` | `workflow_input_...` | Execute payload key holding the literal `"netsuite"` |
| `OPUS_VAR_NETSUITE_FOLDER` | `workflow_input_...` | Execute payload key for the netsuite folder id |
| `OPUS_REQUEST_TIMEOUT_MS` | `60000` | Per-request timeout |
