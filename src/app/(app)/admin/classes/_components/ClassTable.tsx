"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import Link from "next/link";
import { ToggleStatusButton } from "./ToggleStatusButton";

type Cls = {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
  createdByName: string;
  updatedByName: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-gray-100 text-gray-500",
};

function formatRelative(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

interface Props {
  classes: Cls[];
  filters: { q?: string; status?: string };
}

export function ClassTable({ classes, filters }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v) as [string, string][]
      );
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => router.replace(`/admin/classes?${params.toString()}`));
    },
    [filters, router]
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Classes</h2>
          <p className="text-sm text-surface-400 mt-0.5">Configure expense categories for receipt classification.</p>
        </div>
        <Link href="/admin/classes/new" className="btn-primary">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Add Class
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 shadow-sm mb-4 px-4 py-3 flex flex-row flex-wrap items-center gap-3">
        <div style={{ position: "relative", flex: "1 1 180px", minWidth: 0 }}>
          <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#a1a8b8", pointerEvents: "none" }} width="16" height="16" fill="none" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            className="input-field"
            style={{ paddingLeft: 36, width: "100%", boxSizing: "border-box" }}
            placeholder="Search classes…"
            defaultValue={filters.q ?? ""}
            onChange={(e) => updateFilter("q", e.target.value)}
          />
        </div>
        <select
          className="input-field"
          style={{ width: 148, flexShrink: 0 }}
          defaultValue={filters.status ?? ""}
          onChange={(e) => updateFilter("status", e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
        {classes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="w-14 h-14 rounded-full bg-surface-100 flex items-center justify-center mb-4">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
                <rect x="2" y="7" width="20" height="14" rx="2" stroke="#a1a8b8" strokeWidth="1.8" />
                <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" stroke="#a1a8b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-surface-900 font-semibold mb-1">No classes yet</p>
            <p className="text-sm text-surface-400 mb-5">Add your first class to get started.</p>
            <Link href="/admin/classes/new" className="btn-primary">Add your first class</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Code</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Date Added</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Created By</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Last Updated By</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-surface-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {classes.map((c) => (
                  <tr key={c.id} className="table-row">
                    <td className="px-5 py-4">
                      <span style={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        background: "#f0fdf4",
                        color: "#166534",
                        padding: "2px 8px",
                        borderRadius: 6,
                        whiteSpace: "nowrap",
                      }}>
                        {c.code}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-medium text-surface-800">{c.name}</td>
                    <td className="px-5 py-4">
                      <span className={`badge ${STATUS_COLORS[c.status] ?? ""}`} style={{ textTransform: "capitalize" }}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-surface-500">
                      {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-5 py-4 text-surface-500">{c.createdByName}</td>
                    <td className="px-5 py-4 text-surface-500">
                      {c.updatedByName ? (
                        <span>
                          {c.updatedByName}
                          <span className="text-surface-400 text-xs block">{formatRelative(c.updatedAt)}</span>
                        </span>
                      ) : (
                        <span className="text-surface-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/admin/classes/${c.id}/edit`} className="btn-icon" title="Edit class">
                          <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Link>
                        <ToggleStatusButton classId={c.id} classCode={c.code} currentStatus={c.status} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
