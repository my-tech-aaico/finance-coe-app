// Server-only Opus Operator API client. No DB access — pure Opus I/O — so it is
// reusable by both scheduler scripts (verification-submit, verification-poll).
// Wire contract: guidelines/spec/opus-api.md. Auth is the `x-service-key` header.

const API_URL = process.env.OPUS_API_URL ?? "https://operator.opus.com";
const SERVICE_KEY = process.env.OPUS_SERVICE_KEY ?? "";
const WORKFLOW_ID = process.env.OPUS_WORKFLOW_ID ?? "";
const WORKSPACE_ID = process.env.OPUS_WORKSPACE_ID ?? "";
const WORKFLOW_VERSION = process.env.OPUS_WORKFLOW_VERSION ?? "";
const CALLBACK_URL = process.env.OPUS_CALLBACK_URL; // optional, future use
const VAR_STATEMENT = process.env.OPUS_VAR_STATEMENT ?? "";
const VAR_RECEIPTS = process.env.OPUS_VAR_RECEIPTS ?? "";
const VAR_DESTINATION = process.env.OPUS_VAR_DESTINATION ?? "";
const VAR_NETSUITE_FOLDER = process.env.OPUS_VAR_NETSUITE_FOLDER ?? "";
const VAR_METADATA = process.env.OPUS_VAR_METADATA ?? "";
const TIMEOUT_MS = Number(process.env.OPUS_REQUEST_TIMEOUT_MS ?? 60_000);

export class OpusError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "http" | "malformed" | "network"
  ) {
    super(message);
    this.name = "OpusError";
  }
}

/** Wrap an unknown thrown value (fetch/abort) as a transport-level OpusError. */
function toTransportError(err: unknown): OpusError {
  if (err instanceof OpusError) return err;
  // AbortSignal.timeout() rejects with a DOMException named "TimeoutError"
  // (or "AbortError"); DOMException is not reliably an Error in Node, so match by name.
  const name = (err as { name?: unknown })?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new OpusError("Opus request timed out", "timeout");
  }
  return new OpusError(
    `Opus network error: ${err instanceof Error ? err.message : String(err)}`,
    "network"
  );
}

/** POST/GET JSON against the Opus API with auth + timeout. Returns parsed JSON. */
async function opusJson(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<unknown> {
  let resp: Response;
  try {
    resp = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "x-service-key": SERVICE_KEY,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw toTransportError(err);
  }

  const text = await resp.text();
  if (!resp.ok) {
    throw new OpusError(
      `Opus ${method} ${path} → HTTP ${resp.status}: ${text.slice(0, 500)}`,
      "http"
    );
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new OpusError(
      `Opus ${method} ${path} returned non-JSON: ${text.slice(0, 200)}`,
      "malformed"
    );
  }
}

// ───────────────────────── Submission-side (verification-submit) ─────────────────────────

/** opus-api.md §3 — get a presigned upload URL for one file. */
export async function getUploadUrl(input: {
  fileExtension: string;
  originalName: string;
}): Promise<{ presignedUrl: string; fileUrl: string }> {
  const data = (await opusJson("POST", "/job/file/upload", {
    fileExtension: input.fileExtension,
    originalName: input.originalName,
    accessScope: "workspace",
    workflowId: WORKFLOW_ID,
    workspaceId: WORKSPACE_ID,
  })) as { presignedUrl?: unknown; fileUrl?: unknown };

  if (typeof data.presignedUrl !== "string" || typeof data.fileUrl !== "string") {
    throw new OpusError(
      `Opus /job/file/upload missing presignedUrl/fileUrl for ${input.originalName}`,
      "malformed"
    );
  }
  return { presignedUrl: data.presignedUrl, fileUrl: data.fileUrl };
}

/** opus-api.md §4 — PUT the buffered file to the presigned URL (no x-service-key). */
export async function uploadFileToPresignedUrl(input: {
  presignedUrl: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(input.presignedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": input.contentType,
        "Content-Length": String(input.body.byteLength),
      },
      body: input.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw toTransportError(err);
  }
  if (!resp.ok) {
    const text = await resp.text();
    throw new OpusError(
      `Presigned PUT → HTTP ${resp.status}: ${text.slice(0, 300)}`,
      "http"
    );
  }
}

/** opus-api.md §5 — start a job. */
export async function initiateJob(): Promise<{ jobExecutionId: string }> {
  const data = (await opusJson("POST", "/job/initiate", {
    workflowId: WORKFLOW_ID,
    version: WORKFLOW_VERSION,
  })) as { jobExecutionId?: unknown };

  if (typeof data.jobExecutionId !== "string" || !data.jobExecutionId) {
    throw new OpusError("Opus /job/initiate returned no jobExecutionId", "malformed");
  }
  return { jobExecutionId: data.jobExecutionId };
}

/** Per-receipt data for the ${OPUS_VAR_RECEIPTS} array + ${OPUS_VAR_METADATA} (opus-api.md §6.1). */
export type ReceiptMeta = {
  fileUrl: string; // Opus fileUrl from GetUploadURL; metadata filename = its basename
  department: string; // department.name ("" if null)
  class: string; // class.name ("" if null)
  projectCode: string; // receipt.projectCode snapshot ("" if null)
  teamSplit: string; // team_split.name ("" if null)
};

/** Basename of an Opus media fileUrl (last path segment; query/fragment stripped, no decode). */
function fileUrlBasename(fileUrl: string): string {
  const noQuery = fileUrl.split(/[?#]/, 1)[0];
  const segment = noQuery.slice(noQuery.lastIndexOf("/") + 1);
  return segment;
}

/** opus-api.md §6 — run the job against the uploaded fileUrls. */
export async function executeJob(input: {
  jobExecutionId: string;
  statementFileUrl: string;
  receipts: ReceiptMeta[];
  netsuiteFolderId: string;
}): Promise<{ raw: unknown }> {
  const jobPayloadSchemaInstance: Record<string, unknown> = {
    [VAR_STATEMENT]: {
      value: input.statementFileUrl,
      type: "file",
      displayName: "Statement File",
    },
    [VAR_RECEIPTS]: {
      value: input.receipts.map((r) => r.fileUrl),
      type: "array",
      displayName: "Supporting Receipts",
    },
    [VAR_DESTINATION]: {
      value: "netsuite",
      type: "str",
      displayName: "Folder Name",
    },
    [VAR_NETSUITE_FOLDER]: {
      value: input.netsuiteFolderId,
      type: "str",
      displayName: "Netsuite Folder ID",
    },
  };

  // opus-api.md §6.1 — per-receipt metadata as a JSON *string* (double-encoded).
  // Omitted entirely when OPUS_VAR_METADATA is unset (mirrors callbackUrl below).
  if (VAR_METADATA) {
    const metadata = {
      file: input.receipts.map((r) => ({
        filename: fileUrlBasename(r.fileUrl),
        department: r.department,
        class: r.class,
        projectCode: r.projectCode,
        "team-split": r.teamSplit,
      })),
    };
    jobPayloadSchemaInstance[VAR_METADATA] = {
      value: JSON.stringify(metadata),
      type: "str",
      displayName: "metadata",
    };
  }

  const body: Record<string, unknown> = {
    jobExecutionId: input.jobExecutionId,
    jobPayloadSchemaInstance,
  };
  if (CALLBACK_URL) body.callbackUrl = CALLBACK_URL;

  console.log("[opus] executeJob payload:", JSON.stringify(body, null, 2));

  const raw = (await opusJson("POST", "/job/execute", body)) as {
    statusCode?: unknown;
  };

  // The error envelope still returns HTTP 200 with an inner statusCode >= 400.
  if (typeof raw.statusCode === "number" && raw.statusCode >= 400) {
    throw new OpusError(
      `Opus /job/execute failed: ${JSON.stringify(raw).slice(0, 500)}`,
      "http"
    );
  }
  return { raw };
}

// ───────────────────────── Update-side (verification-poll) ─────────────────────────

export type OpusJobState = "in_progress" | "success" | "failed";

/**
 * Normalize Opus's raw status vocabulary to an internal state.
 * opus-api.md §7.1 — the SINGLE place this mapping lives.
 *   completed                  → success
 *   failed | timed_out | stopped → failed
 *   in_progress | <unknown>    → in_progress (caught by the §7.4 timeout)
 */
function normalizeStatus(rawStatus: string): OpusJobState {
  const v = rawStatus.trim().toLowerCase().replace(/\s+/g, "_");
  switch (v) {
    case "completed":
      return "success";
    case "failed":
    case "timed_out":
    case "stopped":
      return "failed";
    case "in_progress":
      return "in_progress";
    default:
      return "in_progress";
  }
}

/** opus-api.md §7 — GET status, normalized. */
export async function getJobStatus(jobExecutionId: string): Promise<{
  state: OpusJobState;
  rawStatus: string;
  raw: unknown;
}> {
  const raw = (await opusJson(
    "GET",
    `/job/${encodeURIComponent(jobExecutionId)}/status`
  )) as { status?: unknown };

  if (typeof raw.status !== "string") {
    throw new OpusError(
      `Opus status response missing 'status' for ${jobExecutionId}`,
      "malformed"
    );
  }
  return { state: normalizeStatus(raw.status), rawStatus: raw.status, raw };
}

type AuditOutputVar = { variable_name?: unknown; value?: unknown };

/**
 * opus-api.md §8 — fetch the audit log and extract the single result file.
 * The audit log is NOT returned for storage (it embeds the file as base64).
 * Returns null when no base64_file_content is present.
 */
export async function getJobResultFile(jobExecutionId: string): Promise<{
  buffer: Buffer;
  fileTitle: string;
  netsuiteFolderId: string;
} | null> {
  const audit = (await opusJson(
    "GET",
    `/job/${encodeURIComponent(jobExecutionId)}/audit`
  )) as {
    audit?: {
      nodes_execution_data?: {
        Output?: { execution_output?: unknown };
      };
    };
  };

  const outputs = audit.audit?.nodes_execution_data?.Output?.execution_output;
  if (!Array.isArray(outputs)) return null;

  const pick = (name: string): unknown =>
    (outputs as AuditOutputVar[]).find((o) => o?.variable_name === name)?.value;

  const base64 = pick("workflow_output_zb1vn5pc6"); //base64_file_content
  if (typeof base64 !== "string" || !base64) return null;

  const fileTitleRaw = pick("workflow_output_7mir3wue6"); //file_title
  const folderIdRaw = pick("workflow_output_fv0g3naiu"); //netsuite_folder_id

  return {
    buffer: Buffer.from(base64, "base64"),
    fileTitle: typeof fileTitleRaw === "string" ? fileTitleRaw : "",
    netsuiteFolderId: typeof folderIdRaw === "string" ? folderIdRaw : "",
  };
}
