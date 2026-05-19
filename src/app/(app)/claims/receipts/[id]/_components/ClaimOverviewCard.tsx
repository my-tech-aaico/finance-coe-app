import Link from "next/link";
import { DetailViewMode } from "../_lib/access";

type Claim = {
  id: string;
  displayId: string;
  description: string;
  claimMonth: number;
  claimYear: number;
  status: "awaiting_statement" | "statement_attached";
  createdAt: Date;
  driveReceiptsUrl: string;
  entity: { code: string; name: string; currency: string };
  claimant: { name: string } | null;
  createdByUser: { name: string } | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  awaiting_statement: { bg: "#fffbeb", color: "#92400e", label: "Awaiting Statement" },
  statement_attached: { bg: "#f0fdf4", color: "#166534", label: "Statement Attached" },
};

interface Props {
  claim: Claim;
  mode: DetailViewMode;
}

export function ClaimOverviewCard({ claim, mode }: Props) {
  const isAdminFinance = mode === "admin_finance";
  const status = STATUS_STYLES[claim.status] ?? STATUS_STYLES.awaiting_statement;

  return (
    <div className="bg-white rounded-xl border border-surface-200 shadow-sm p-6 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span style={{
              fontFamily: "monospace",
              fontSize: 14,
              fontWeight: 700,
              background: "#eff6ff",
              color: "#1d4ed8",
              padding: "3px 10px",
              borderRadius: 6,
            }}>
              {claim.displayId}
            </span>
            <span style={{
              fontSize: 12,
              fontWeight: 500,
              background: status.bg,
              color: status.color,
              padding: "3px 10px",
              borderRadius: 9999,
            }}>
              {status.label}
            </span>
          </div>
          <h2 className="text-xl font-bold text-surface-900 mb-4">Claim Details</h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-surface-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Period</dt>
              <dd className="text-surface-800 font-medium">{MONTHS[claim.claimMonth - 1]} {claim.claimYear}</dd>
            </div>
            <div>
              <dt className="text-surface-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Entity</dt>
              <dd>
                <span style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  padding: "2px 8px",
                  borderRadius: 6,
                }}>
                  {claim.entity.code}
                </span>
                <span className="ml-2 text-surface-600 text-xs">{claim.entity.name}</span>
              </dd>
            </div>
            <div>
              <dt className="text-surface-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Claimant</dt>
              <dd className="text-surface-800">
                {claim.claimant?.name ?? <span className="text-surface-400">Unassigned</span>}
              </dd>
            </div>
            <div>
              <dt className="text-surface-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Created</dt>
              <dd className="text-surface-600 text-xs">
                {claim.createdByUser?.name ?? "—"} · {new Date(claim.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-surface-400 text-xs font-semibold uppercase tracking-wide mb-0.5">Description</dt>
              <dd className="text-surface-700">{claim.description}</dd>
            </div>
          </dl>
        </div>

        {isAdminFinance && (
          <div className="flex gap-2 flex-shrink-0">
            <Link href={`/claims/receipts/${claim.id}/edit`} className="btn-secondary" style={{ whiteSpace: "nowrap" }}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Edit
            </Link>
            <a href={claim.driveReceiptsUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ whiteSpace: "nowrap" }}>
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="15,3 21,3 21,9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Open in Drive
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
