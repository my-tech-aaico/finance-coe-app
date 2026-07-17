"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition, useActionState } from "react";
import { StatusBadge } from "./StatusBadge";
import { DriveLinkButton } from "./DriveLinkButton";
import Link from "next/link";
import { deleteClaim, restoreClaim } from "../_actions";

type ClaimRow = {
  id: string;
  displayId: string;
  description: string;
  claimMonth: number;
  claimYear: number;
  status: "awaiting_statement" | "statement_attached";
  createdAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  driveReceiptsUrl: string;
  entityCode: string;
  entityName: string;
  claimantName: string | null;
  claimantStatus: string | null;
  deletedByName: string | null;
};

type Filters = {
  q?: string;
  status?: string;
  claimant?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
  page?: string;
  showDeleted?: string;
};

interface Props {
  claims: ClaimRow[];
  total: number;
  page: number;
  filters: Filters;
  isAdmin: boolean;
  isAdminOrFinance: boolean;
  showDeleted: boolean;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatPeriod(month: number, year: number) {
  return `${MONTHS[month - 1]} ${year}`;
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

function DeleteButton({ claim }: { claim: ClaimRow }) {
  const [, formAction, pending] = useActionState(deleteClaim, null);
  const [, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    const msg = claim.status === "statement_attached"
      ? `Delete claim ${claim.displayId}? The linked statement will also be soft-deleted. Both can be restored later from the 'Show deleted' view. The Drive folder is unaffected.`
      : `Delete claim ${claim.displayId}? It will be hidden from the list. You can restore it later from the 'Show deleted' view. The Drive folder is unaffected.`;
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("claimId", claim.id);
    startTransition(() => formAction(fd));
  }

  return (
    <button
      className="btn-icon"
      title="Delete claim"
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

function RestoreButton({ claim }: { claim: ClaimRow }) {
  const [, formAction, pending] = useActionState(restoreClaim, null);
  const [, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!window.confirm(`Restore claim ${claim.displayId}? It will reappear in the active list, along with any statement that was cascade-deleted with it.`)) return;
    const fd = new FormData();
    fd.set("claimId", claim.id);
    startTransition(() => formAction(fd));
  }

  return (
    <button
      className="btn-secondary"
      style={{ padding: "6px 12px", fontSize: 12, height: "auto" }}
      disabled={pending}
      onClick={handleClick}
    >
      {pending ? "Restoring…" : "Restore"}
    </button>
  );
}

export function ClaimsTable({ claims, total, page, filters, isAdmin, isAdminOrFinance, showDeleted }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(
        Object.entries({ ...filters, page: undefined })
          .filter(([, v]) => v) as [string, string][]
      );
      if (value) params.set(key, value);
      else params.delete(key);
      params.delete("page");
      startTransition(() => router.replace(`/claims/receipts?${params.toString()}`));
    },
    [filters, router]
  );

  const handleSort = useCallback(
    (col: string) => {
      const newDir = filters.sort === col && filters.dir === "asc" ? "desc" : "asc";
      const params = new URLSearchParams(
        Object.entries({ ...filters, page: undefined })
          .filter(([, v]) => v) as [string, string][]
      );
      params.set("sort", col);
      params.set("dir", newDir);
      params.delete("page");
      startTransition(() => router.replace(`/claims/receipts?${params.toString()}`));
    },
    [filters, router]
  );

  const setPage = useCallback(
    (p: number) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v) as [string, string][]
      );
      params.set("page", String(p));
      startTransition(() => router.replace(`/claims/receipts?${params.toString()}`));
    },
    [filters, router]
  );

  const toggleShowDeleted = useCallback(() => {
    const params = new URLSearchParams(
      Object.entries({ ...filters, page: undefined })
        .filter(([, v]) => v) as [string, string][]
    );
    if (showDeleted) params.delete("showDeleted");
    else params.set("showDeleted", "true");
    params.delete("page");
    startTransition(() => router.replace(`/claims/receipts?${params.toString()}`));
  }, [filters, showDeleted, router]);

  const totalPages = Math.max(1, Math.ceil(total / 20));
  const start = (page - 1) * 20 + 1;
  const end = Math.min(page * 20, total);

  const isEmptyDefault = claims.length === 0 && !filters.q && !filters.status && !filters.claimant && !filters.from && !filters.to && !showDeleted;

  if (isEmptyDefault) {
    return (
      <>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-surface-900">Receipts</h2>
            <p className="text-sm text-surface-400 mt-0.5">Manage claim records and Google Drive folder links.</p>
          </div>
          {isAdminOrFinance && (
            <Link href="/claims/receipts/new" className="btn-primary">
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              New Claim
            </Link>
          )}
        </div>
        <div className="bg-white rounded-xl border border-surface-200 shadow-sm">
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-14 h-14 rounded-full bg-surface-100 flex items-center justify-center mb-4">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="#a1a8b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-surface-900 font-semibold mb-1">No claims yet</p>
            <p className="text-sm text-surface-400 mb-5" style={{ maxWidth: 340 }}>
              {isAdminOrFinance
                ? "Create your first claim to generate a receipt folder and start the verification process."
                : "No claims are assigned to you yet."}
            </p>
            {isAdminOrFinance && (
              <Link href="/claims/receipts/new" className="btn-primary">Create First Claim</Link>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Receipts</h2>
          <p className="text-sm text-surface-400 mt-0.5">Manage claim records and Google Drive folder links.</p>
        </div>
        {isAdminOrFinance && (
          <Link href="/claims/receipts/new" className="btn-primary">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New Claim
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm mb-4 px-4 py-3 flex flex-row flex-wrap items-center gap-3">
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 180px", minWidth: 0 }}>
          <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#a1a8b8", pointerEvents: "none" }} width="16" height="16" fill="none" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input className="input-field" style={{ paddingLeft: 36, width: "100%", boxSizing: "border-box" }} placeholder="Search claims…" defaultValue={filters.q ?? ""} onChange={(e) => updateFilter("q", e.target.value)} />
        </div>

        {/* Status filter */}
        <select className="input-field" style={{ width: 180, flexShrink: 0 }} defaultValue={filters.status ?? ""} onChange={(e) => updateFilter("status", e.target.value)}>
          <option value="">All Statuses</option>
          <option value="awaiting_statement">Awaiting Statement</option>
          <option value="statement_attached">Statement Attached</option>
        </select>

        {/* Claimant filter */}
        <select className="input-field" style={{ width: 160, flexShrink: 0 }} defaultValue={filters.claimant ?? ""} onChange={(e) => updateFilter("claimant", e.target.value)}>
          <option value="">All Claimants</option>
          <option value="unassigned">Unassigned</option>
        </select>

        {/* Date range */}
        <div className="flex items-center gap-2 flex-shrink-0">
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
                  Object.entries({ ...filters, from: undefined, to: undefined, page: undefined })
                    .filter(([, v]) => v) as [string, string][]
                );
                startTransition(() => router.replace(`/claims/receipts?${params.toString()}`));
              }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Show deleted toggle — admin only */}
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm text-surface-600 cursor-pointer flex-shrink-0 select-none">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={toggleShowDeleted}
              className="w-4 h-4 rounded"
              style={{ accentColor: "#4263eb" }}
            />
            Show deleted
          </label>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
        {claims.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <p className="text-surface-900 font-semibold mb-1">No claims match your filters</p>
            <p className="text-sm text-surface-400">Try adjusting your search or filter criteria.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-100 bg-surface-50">
                    {[
                      { key: "displayId", label: "Claim ID" },
                      { key: "description", label: "Description" },
                      { key: "period", label: "Period" },
                      { key: "entity", label: "Entity" },
                      { key: "claimant", label: "Claimant" },
                      { key: "status", label: "Status" },
                      { key: "createdAt", label: "Created Date" },
                    ].map(({ key, label }) => (
                      <th
                        key={key}
                        className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider cursor-pointer select-none hover:text-surface-600 transition-colors"
                        onClick={() => handleSort(key)}
                      >
                        {label}
                        <SortIcon col={key} sort={filters.sort} dir={filters.dir} />
                      </th>
                    ))}
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Details</th>
                    {isAdminOrFinance && <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Drive</th>}
                    {isAdminOrFinance && <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {claims.map((c) => {
                    const isDeleted = !!c.deletedAt;
                    return (
                      <tr key={c.id} className="table-row" style={isDeleted ? { background: "#f9fafb" } : undefined}>
                        <td className="px-5 py-4">
                          <span style={{
                            fontFamily: "monospace",
                            fontSize: 12,
                            fontWeight: 600,
                            background: isDeleted ? "#f3f4f6" : "#eff6ff",
                            color: isDeleted ? "#9ca3af" : "#1d4ed8",
                            padding: "2px 8px",
                            borderRadius: 6,
                            whiteSpace: "nowrap",
                            textDecoration: isDeleted ? "line-through" : undefined,
                          }}>
                            {c.displayId}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-surface-700" style={{ maxWidth: 240 }}>
                          <span title={c.description} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isDeleted ? "#9ca3af" : undefined }}>
                            {c.description}
                          </span>
                          {isDeleted && c.deletedAt && (
                            <span style={{ fontSize: 11, color: "#9ca3af", display: "block", marginTop: 2 }}>
                              Deleted on {new Date(c.deletedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                              {c.deletedByName ? ` by ${c.deletedByName}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap" style={{ color: isDeleted ? "#9ca3af" : "#4b5563" }}>
                          {formatPeriod(c.claimMonth, c.claimYear)}
                        </td>
                        <td className="px-5 py-4">
                          <span style={{
                            fontFamily: "monospace",
                            fontSize: 12,
                            fontWeight: 600,
                            background: isDeleted ? "#f3f4f6" : "#eff6ff",
                            color: isDeleted ? "#9ca3af" : "#1d4ed8",
                            padding: "2px 8px",
                            borderRadius: 6,
                          }}>
                            {c.entityCode}
                          </span>
                        </td>
                        <td className="px-5 py-4" style={{ color: isDeleted ? "#9ca3af" : "#4b5563" }}>
                          {c.claimantName ? (
                            <span>
                              {c.claimantName}
                              {c.claimantStatus === "inactive" && <span className="ml-1 text-xs text-surface-400">(inactive)</span>}
                            </span>
                          ) : (
                            <span className="badge" style={{ background: "#f3f4f6", color: "#9ca3af", fontSize: 11 }}>Unassigned</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={c.status} faded={isDeleted} />
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap" style={{ color: isDeleted ? "#9ca3af" : "#6b7280" }}>
                          {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-5 py-4">
                          <Link href={`/claims/receipts/${c.id}`} className="btn-icon" title="View claim details">
                            <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                            </svg>
                          </Link>
                        </td>
                        {isAdminOrFinance && (
                          <td className="px-5 py-4">
                            <DriveLinkButton url={c.driveReceiptsUrl} />
                          </td>
                        )}
                        {isAdminOrFinance && (
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              {!isDeleted && (
                                <>
                                  <Link href={`/claims/receipts/${c.id}/edit`} className="btn-icon" title="Edit claim">
                                    <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </Link>
                                  {isAdmin && <DeleteButton claim={c} />}
                                </>
                              )}
                              {isDeleted && isAdmin && <RestoreButton claim={c} />}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-5 py-4 border-t border-surface-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-sm text-surface-400">
                Showing {start}–{end} of {total} claims · 20 per page
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
                      <button key={p} onClick={() => setPage(p as number)} className={`btn-icon ${page === p ? "bg-brand-600 text-white border-brand-600" : ""}`} style={{ width: 32, height: 32, fontSize: 13 }}>
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
  );
}
