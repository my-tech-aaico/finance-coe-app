import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projectCode } from "@/db/schema";
import { readSheetRows } from "@/lib/sheets";

/**
 * Reconciles the `project_code` table from the master Google Sheet.
 * Callable from the /api/cron/project-code-sync route and from a standalone tsx script.
 * Does NOT call process.exit — that is the caller's responsibility.
 *
 * Contract (guidelines/spec/project-code.md §15.5):
 *   - Insert codes present in the sheet but not the table, as `active`, with
 *     created_at = the sheet's parsed timestamp (fallback now()).
 *   - Update the name of codes whose sheet name differs from the table.
 *   - Never deactivate/delete, and never touch status/created_at of existing rows.
 */

const LOG = "[project-code-sync]";

const HEADER_CODE = process.env.PROJECT_CODE_HEADER_CODE ?? "Project Code Ref";
const HEADER_TIMESTAMP = process.env.PROJECT_CODE_HEADER_TIMESTAMP ?? "Timestamp";
const HEADER_NAME = process.env.PROJECT_CODE_HEADER_NAME ?? "Project Name";

export interface ProjectCodeSyncResult {
  ok: boolean;
  inserted: number;
  renamed: number;
  unchanged: number;
  skipped: number; // rows with a blank code
  duplicates: number; // duplicate codes within the sheet
  totalSheetRows: number; // data rows (excluding the header)
  ms: number;
}

type SheetEntry = { code: string; name: string; timestamp: string };

// Locate a header column by name (case-insensitive, trimmed). Returns -1 if absent.
function findHeaderIndex(headers: string[], wanted: string): number {
  const w = wanted.trim().toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === w);
}

// Parse the sheet timestamp; return null when blank/unparseable so the caller falls back to now().
function parseTimestamp(raw: string): Date | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function runProjectCodeSync(): Promise<ProjectCodeSyncResult> {
  const start = Date.now();

  const spreadsheetId = process.env.PROJECT_CODE_SHEET_ID;
  const tab = process.env.PROJECT_CODE_SHEET_TAB;
  if (!spreadsheetId) throw new Error("PROJECT_CODE_SHEET_ID is not set.");
  if (!tab) throw new Error("PROJECT_CODE_SHEET_TAB is not set.");

  // ── Read the sheet ──
  const rows = await readSheetRows(spreadsheetId, tab);
  if (rows.length === 0) throw new Error(`Sheet tab "${tab}" is empty (no header row).`);

  const headers = rows[0];
  const idxCode = findHeaderIndex(headers, HEADER_CODE);
  const idxName = findHeaderIndex(headers, HEADER_NAME);
  const idxTimestamp = findHeaderIndex(headers, HEADER_TIMESTAMP);

  const missing: string[] = [];
  if (idxCode < 0) missing.push(`code ("${HEADER_CODE}")`);
  if (idxName < 0) missing.push(`name ("${HEADER_NAME}")`);
  if (idxTimestamp < 0) missing.push(`timestamp ("${HEADER_TIMESTAMP}")`);
  if (missing.length > 0) {
    throw new Error(
      `${LOG} Missing required header(s): ${missing.join(", ")}. Found headers: ${headers.join(" | ")}`
    );
  }

  // ── Build the temp object from data rows ──
  const bySheetCode = new Map<string, SheetEntry>();
  let skipped = 0;
  let duplicates = 0;
  const dataRows = rows.slice(1);
  for (const row of dataRows) {
    const code = (row[idxCode] ?? "").trim().toUpperCase();
    if (!code) {
      skipped += 1;
      continue;
    }
    if (bySheetCode.has(code)) {
      duplicates += 1;
      console.warn(`${LOG} Duplicate code in sheet, keeping first occurrence: ${code}`);
      continue;
    }
    const name = (row[idxName] ?? "").trim();
    bySheetCode.set(code, {
      code,
      name: name || code, // name is NOT NULL — fall back to the code if the cell is blank
      timestamp: (row[idxTimestamp] ?? "").trim(),
    });
  }

  // ── Load the current table ──
  const existingRows = await db
    .select({ id: projectCode.id, code: projectCode.code, name: projectCode.name })
    .from(projectCode);
  const byTableCode = new Map(existingRows.map((r) => [r.code, r]));

  // ── Diff ──
  const toInsert: { code: string; name: string; createdAt?: Date }[] = [];
  const toRename: { id: string; name: string }[] = [];
  let unchanged = 0;

  for (const entry of bySheetCode.values()) {
    const existing = byTableCode.get(entry.code);
    if (!existing) {
      const createdAt = parseTimestamp(entry.timestamp);
      toInsert.push(createdAt ? { code: entry.code, name: entry.name, createdAt } : { code: entry.code, name: entry.name });
    } else if (existing.name !== entry.name) {
      toRename.push({ id: existing.id, name: entry.name });
    } else {
      unchanged += 1;
    }
  }

  // ── Apply (single transaction; the list is small even at 1000+ rows) ──
  if (toInsert.length > 0 || toRename.length > 0) {
    await db.transaction(async (tx) => {
      if (toInsert.length > 0) {
        await tx.insert(projectCode).values(
          toInsert.map((r) => ({
            code: r.code,
            name: r.name,
            status: "active" as const,
            ...(r.createdAt ? { createdAt: r.createdAt } : {}),
          }))
        );
      }
      for (const r of toRename) {
        await tx
          .update(projectCode)
          .set({ name: r.name, updatedAt: new Date() })
          .where(eq(projectCode.id, r.id));
      }
    });
  }

  const result: ProjectCodeSyncResult = {
    ok: true,
    inserted: toInsert.length,
    renamed: toRename.length,
    unchanged,
    skipped,
    duplicates,
    totalSheetRows: dataRows.length,
    ms: Date.now() - start,
  };
  console.log(
    `${LOG} Done in ${result.ms}ms. Inserted: ${result.inserted}, Renamed: ${result.renamed}, ` +
      `Unchanged: ${result.unchanged}, Skipped(blank): ${result.skipped}, Duplicates: ${result.duplicates}.`
  );
  return result;
}
