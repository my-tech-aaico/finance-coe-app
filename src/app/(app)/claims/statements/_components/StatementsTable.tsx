"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition, useActionState } from "react";
import Link from "next/link";
import { VerificationStatusBadge } from "./VerificationStatusBadge";
import {
  startVerification,
  deleteStatement,
} from "../_actions";
import type { StatementVerificationStatus } from "../_lib/mutability";
import { isStatementMutable } from "../_lib/mutability";

type StatementRow = {
  id: string;
  displayId: string;
  statementDate: string;
  uploadDate: Date;
  verificationStatus: StatementVerificationStatus;
  claimId: string;
  claimDisplayId: string;
  claimDescription: string;
};

type Filters = {
  q?: string;
  status?: string;
  dateField?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

interface Props {
  statements: StatementRow[];
  total: number;
  page: number;
  filters: Filters;
  isAdminOrFinance: boolean;
  notice?: string | null;
}

function SortIcon({ col, sort, dir }: { col: string; sort?: string; dir?: string }) {
  const active = sort === col;
  return (
    <span className="inline-flex flex-col ml-1" style={{ gap: 1, verticalAlign: "middle" }}>
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none" style={{ opacity: active && dir === "asc" ? 1 : 0.3 }}>
        <path d="M4 0L8 5H0L4 0Z" fill="currentColor" />
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" fill="none" style={{ opacity: active && dir === "desc" ? 1 : 0.3 }}>
        <path d="M4 5L0 0H8L4 5Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function StartButton({ statement }: { statement: StatementRow }) {
  const [, formAction, pending] = useActionState(startVerification, null);
  const [, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("statementId", statement.id);
    startTransition(() => formAction(fd));
  }

  return (
    <button
      className="btn-icon mx-auto"
      title="Start Verification"
      disabled={pending}
      onClick={handleClick}
    >
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
        <polygon points="5,3 19,12 5,21" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function DeleteButton({ statement }: { statement: StatementRow }) {
  const [, formAction, pending] = useActionState(deleteStatement, null);
  const [, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    const msg =
      `Permanently delete statement ${statement.displayId}?\n\n` +
      `This will:\n` +
      `• Remove the statement record and all its verification history.\n` +
      `• Move the file to Google Drive trash.\n` +
      `• Revert claim ${statement.claimDisplayId} to "Awaiting Statement"\n` +
      `  so a new statement can be uploaded.\n\n` +
      `This cannot be undone from the portal. The file in Drive trash\n` +
      `is recoverable for ~30 days.`;
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("statementId", statement.id);
    startTransition(() => formAction(fd));
  }

  return (
    <button
      className="btn-icon"
      title="Delete statement"
      disabled={pending}
      onClick={handleClick}
      style={{ color: "#ef4444", borderColor: "#fecaca" }}
    >
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
        <polyline points="3,6 5,6 21,6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const COLUMNS = [
  { key: "displayId", label: "Statement ID" },
  { key: "statementDate", label: "Statement Date" },
  { key: "linkedClaim", label: "Linked Claim" },
  { key: "uploadDate", label: "Upload Date" },
  { key: "verification", label: "Verification" },
] as const;

export function StatementsTable({
  statements,
  total,
  page,
  filters,
  isAdminOrFinance,
  notice,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(
        Object.entries({ ...filters, page: undefined }).filter(
          ([, v]) => v
        ) as [string, string][]
      );
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page");
      startTransition(() => router.replace(`/claims/statements?${params.toString()}`));
    },
    [filters, router]
  );

  const handleSort = useCallback(
    (col: string) => {
      const newDir =
        filters.sort === col && filters.dir === "asc" ? "desc" : "asc";
      const params = new URLSearchParams(
        Object.entries({ ...filters, page: undefined }).filter(
          ([, v]) => v
        ) as [string, string][]
      );
      params.set("sort", col);
      params.set("dir", newDir);
      params.delete("page");
      startTransition(() => router.replace(`/claims/statements?${params.toString()}`));
    },
    [filters, router]
  );

  const setPage = useCallback(
    (p: number) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v) as [string, string][]
      );
      params.set("page", String(p));
      startTransition(() => router.replace(`/claims/statements?${params.toString()}`));
    },
    [filters, router]
  );

  const dismissNotice = useCallback(() => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v) as [string, string][]
    );
    startTransition(() => router.replace(`/claims/statements?${params.toString()}`));
  }, [filters, router]);

  const totalPages = Math.max(1, Math.ceil(total / 20));
  const start = (page - 1) * 20 + 1;
  const end = Math.min(page * 20, total);

  const isEmptyDefault =
    statements.length === 0 &&
    !filters.q &&
    !filters.status &&
    !filters.from &&
    !filters.to;

  return (
    <>
      {notice === "locked" && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            color: "#b45309",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ marginTop: 2, flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
            <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div style={{ flex: 1, fontSize: 13 }}>
            Editing is locked while verification is queued or in progress. Wait for it to complete (or fail) before editing.
          </div>
          <button
            onClick={dismissNotice}
            aria-label="Dismiss"
            style={{ background: "transparent", border: "none", color: "#b45309", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Statements</h2>
          <p className="text-sm text-surface-400 mt-0.5">Upload and manage credit card statements.</p>
        </div>
        <Link href="/claims/statements/new" className="btn-primary">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <polyline points="17,8 12,3 7,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Upload Statement
        </Link>
      </div>

      {isEmptyDefault ? (
        <div className="bg-white rounded-xl border border-surface-200 shadow-sm">
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center mb-4">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="#4263eb" strokeWidth="1.8" strokeLinecap="round" />
                <polyline points="17,8 12,3 7,8" stroke="#91a7ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="3" x2="12" y2="15" stroke="#91a7ff" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-surface-900 font-semibold mb-1">No statements uploaded</p>
            <p className="text-sm text-surface-400 mb-5" style={{ maxWidth: 340 }}>
              Upload your first credit card statement to begin the verification process.
            </p>
            <Link href="/claims/statements/new" className="btn-primary">Upload First Statement</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="bg-white rounded-xl border border-surface-200 shadow-sm mb-4 px-4 py-3 flex flex-row flex-wrap items-center gap-3">
            <div style={{ position: "relative", flex: "1 1 180px", minWidth: 0 }}>
              <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#a1a8b8", pointerEvents: "none" }} width="16" height="16" fill="none" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <input
                className="input-field"
                style={{ paddingLeft: 36, width: "100%", boxSizing: "border-box" }}
                placeholder="Search statements…"
                defaultValue={filters.q ?? ""}
                onChange={(e) => updateFilter("q", e.target.value)}
              />
            </div>

            <select
              className="input-field"
              style={{ width: 200, flexShrink: 0 }}
              defaultValue={filters.status ?? ""}
              onChange={(e) => updateFilter("status", e.target.value)}
            >
              <option value="">All Verification Statuses</option>
              <option value="pending_verification">Pending Verification</option>
              <option value="queued">Queued</option>
              <option value="in_progress">In Progress</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>

            {/* Date field toggle + range */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <select
                className="input-field"
                style={{ width: 150 }}
                defaultValue={filters.dateField ?? "statement"}
                onChange={(e) => updateFilter("dateField", e.target.value === "statement" ? "" : e.target.value)}
              >
                <option value="statement">Statement Date</option>
                <option value="upload">Upload Date</option>
              </select>
              <input
                key={`from-${filters.from ?? ""}`}
                type="date"
                className="input-field"
                style={{ width: 140 }}
                value={filters.from ?? ""}
                onChange={(e) => updateFilter("from", e.target.value)}
              />
              <span className="text-surface-400 text-sm">—</span>
              <input
                key={`to-${filters.to ?? ""}`}
                type="date"
                className="input-field"
                style={{ width: 140 }}
                value={filters.to ?? ""}
                onChange={(e) => updateFilter("to", e.target.value)}
              />
              {(filters.from || filters.to) && (
                <button
                  className="btn-secondary"
                  style={{ padding: "0 12px", height: 42, fontSize: 13 }}
                  onClick={() => {
                    const params = new URLSearchParams(
                      Object.entries({ ...filters, from: undefined, to: undefined, page: undefined }).filter(
                        ([, v]) => v
                      ) as [string, string][]
                    );
                    startTransition(() => router.replace(`/claims/statements?${params.toString()}`));
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
            {statements.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                <p className="text-surface-900 font-semibold mb-1">No statements match your filters</p>
                <p className="text-sm text-surface-400">Try adjusting your search or filter criteria.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-100 bg-surface-50">
                        {COLUMNS.map(({ key, label }) => (
                          <th
                            key={key}
                            className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider cursor-pointer select-none hover:text-surface-600 transition-colors"
                            onClick={() => handleSort(key)}
                          >
                            {label}
                            <SortIcon col={key} sort={filters.sort} dir={filters.dir} />
                          </th>
                        ))}
                        <th className="px-5 py-3.5 text-center text-xs font-semibold text-surface-400 uppercase tracking-wider">Actions</th>
                        <th className="px-3 py-3.5 text-center text-xs font-semibold text-surface-400 uppercase tracking-wider">Start</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {statements.map((s) => {
                        const mutable = isStatementMutable(s.verificationStatus);
                        return (
                          <tr key={s.id} className="table-row">
                            <td className="px-5 py-4">
                              <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "#1d4ed8" }}>
                                {s.displayId}
                              </span>
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap text-surface-700">
                              {new Date(s.statementDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </td>
                            <td className="px-5 py-4" style={{ maxWidth: 320 }}>
                              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#1d4ed8" }}>
                                {s.claimDisplayId}
                              </span>
                              <span className="text-surface-400"> · </span>
                              <span title={s.claimDescription} className="text-surface-600" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {s.claimDescription.length > 40 ? `${s.claimDescription.slice(0, 40)}…` : s.claimDescription}
                              </span>
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap text-surface-500">
                              {new Date(s.uploadDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </td>
                            <td className="px-5 py-4">
                              <VerificationStatusBadge status={s.verificationStatus} />
                            </td>
                            <td className="px-5 py-4 text-center">
                              <div className="inline-flex items-center gap-2">
                                <Link
                                  href={`/claims/statements/${s.id}`}
                                  className="btn-secondary"
                                  style={{ padding: "6px 12px", fontSize: 12, height: "auto" }}
                                >
                                  View Details
                                </Link>
                                {isAdminOrFinance && mutable && <DeleteButton statement={s} />}
                              </div>
                            </td>
                            <td className="px-3 py-4 text-center">
                              {s.verificationStatus === "pending_verification" ? <StartButton statement={s} /> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="px-5 py-4 border-t border-surface-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <span className="text-sm text-surface-400">
                    Showing {start}–{end} of {total} statements · 20 per page
                  </span>
                  <div className="flex items-center gap-1">
                    <button className="btn-icon" style={{ width: 32, height: 32 }} onClick={() => setPage(page - 1)} disabled={page <= 1}>
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                        <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                      .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("...");
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((p, i) =>
                        p === "..." ? (
                          <span key={`ellipsis-${i}`} className="px-2 text-surface-400 text-sm">…</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setPage(p as number)}
                            className={`btn-icon ${page === p ? "bg-brand-600 text-white border-brand-600" : ""}`}
                            style={{ width: 32, height: 32, fontSize: 13 }}
                          >
                            {p}
                          </button>
                        )
                      )}
                    <button className="btn-icon" style={{ width: 32, height: 32 }} onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                        <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
