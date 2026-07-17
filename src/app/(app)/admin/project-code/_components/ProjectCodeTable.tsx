"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

type ProjectCode = { id: string; code: string; name: string };

interface Props {
  projectCodes: ProjectCode[];
  filters: { q?: string };
}

export function ProjectCodeTable({ projectCodes, filters }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter(([, v]) => v) as [string, string][]
      );
      if (value) params.set(key, value);
      else params.delete(key);
      startTransition(() => router.replace(`/admin/project-code?${params.toString()}`));
    },
    [filters, router]
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-surface-900">Project Code</h2>
          <p className="text-sm text-surface-400 mt-0.5">Reference list of project codes used on receipts.</p>
        </div>
      </div>

      {/* Read-only info banner */}
      <div
        className="mb-4 flex items-start gap-2.5 rounded-lg px-4 py-3"
        style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 2, color: "#1d4ed8" }}>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
          <line x1="12" y1="16" x2="12" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="12" y1="8" x2="12.01" y2="8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <p className="text-xs leading-relaxed" style={{ color: "#1d4ed8" }}>
          This list is maintained by a scheduled sync job and is <strong>read-only</strong> in the portal — there is no Add, Edit, or Delete.
        </p>
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
            placeholder="Search project codes…"
            defaultValue={filters.q ?? ""}
            onChange={(e) => updateFilter("q", e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
        {projectCodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <p className="text-surface-900 font-semibold mb-1">No project codes yet</p>
            <p className="text-sm text-surface-400">The sync job populates this list. Check back once it has run.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Project Code</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Project Name</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {projectCodes.map((p) => (
                  <tr key={p.id} className="table-row">
                    <td className="px-5 py-4">
                      <span style={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        background: "#f0f4ff",
                        color: "#4263eb",
                        padding: "2px 8px",
                        borderRadius: 6,
                        whiteSpace: "nowrap",
                      }}>
                        {p.code}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-medium text-surface-800">{p.name}</td>
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
