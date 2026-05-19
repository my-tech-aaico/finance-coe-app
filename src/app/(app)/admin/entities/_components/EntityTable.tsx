"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { AddEntityForm } from "./AddEntityForm";
import { ToggleStatusButton } from "./ToggleStatusButton";
import { getCountry } from "@/lib/countries";

type Entity = {
  id: string;
  code: string;
  name: string;
  country: string;
  currency: string;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
  createdByName: string;
  updatedByName: string | null;
};

type FormMode = { mode: "add" } | { mode: "edit"; entity: Entity };

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
  entities: Entity[];
  filters: { q?: string; status?: string };
}

export function EntityTable({ entities, filters }: Props) {
  const router = useRouter();
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [, startTransition] = useTransition();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v) as [string, string][]
      );
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => router.replace(`/admin/entities?${params.toString()}`));
    },
    [filters, router]
  );

  if (formMode) {
    return (
      <AddEntityForm
        onBack={() => setFormMode(null)}
        editEntity={formMode.mode === "edit" ? formMode.entity : undefined}
      />
    );
  }

  return (
    <>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 page-header">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Entities</h2>
          <p className="text-sm text-surface-400 mt-0.5">
            Configure legal entities that can own claims.
          </p>
        </div>
        <button onClick={() => setFormMode({ mode: "add" })} className="btn-primary">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Add Entity
        </button>
      </div>

      {/* Filters */}
      <div
        className="bg-white rounded-xl border border-surface-200 shadow-sm mb-4 px-4 py-3"
        style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <div style={{ position: "relative", flex: "1 1 180px", minWidth: 0 }}>
          <svg
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#a1a8b8", pointerEvents: "none" }}
            width="16" height="16" fill="none" viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            className="input-field"
            style={{ paddingLeft: 36, width: "100%", boxSizing: "border-box" }}
            placeholder="Search entities…"
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

      {/* Table */}
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
        {entities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-full bg-surface-100 flex items-center justify-center mb-4">
              <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
                <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" stroke="#a1a8b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-surface-900 font-semibold mb-1">No entities found</p>
            <p className="text-sm text-surface-400 mb-5">Add your first entity to get started.</p>
            <button onClick={() => setFormMode({ mode: "add" })} className="btn-primary">
              Add your first entity
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Entity Code</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Entity Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Country</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Currency</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Date Added</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Created By</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Last Updated By</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-surface-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {entities.map((e) => {
                  const country = getCountry(e.country);
                  return (
                    <tr key={e.id} className="table-row">
                      <td className="px-5 py-4">
                        <span style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          fontWeight: 600,
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          padding: "2px 8px",
                          borderRadius: 6,
                          whiteSpace: "nowrap",
                        }}>
                          {e.code}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-medium text-surface-800">{e.name}</td>
                      <td className="px-5 py-4 text-surface-600">
                        {country ? `${country.flag} ${country.label}` : e.country}
                      </td>
                      <td className="px-5 py-4">
                        <span style={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          fontWeight: 600,
                          background: "#fefce8",
                          color: "#854d0e",
                          padding: "2px 8px",
                          borderRadius: 6,
                        }}>
                          {e.currency}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`badge justify-center ${STATUS_COLORS[e.status] ?? ""}`} style={{ textTransform: "capitalize" }}>
                          {e.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-surface-500">
                        {new Date(e.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-5 py-4 text-surface-500">{e.createdByName}</td>
                      <td className="px-5 py-4 text-surface-500">
                        {e.updatedByName ? (
                          <span>
                            {e.updatedByName}
                            <span className="text-surface-400 text-xs block">{formatRelative(e.updatedAt)}</span>
                          </span>
                        ) : (
                          <span className="text-surface-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setFormMode({ mode: "edit", entity: e })}
                            className="btn-icon"
                            title="Edit entity"
                          >
                            <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <ToggleStatusButton entityId={e.id} entityCode={e.code} currentStatus={e.status} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
