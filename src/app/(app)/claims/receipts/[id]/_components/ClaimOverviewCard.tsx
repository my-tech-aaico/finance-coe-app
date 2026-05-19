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
  awaiting_statement: { bg: "#fffbeb", color: "#b45309", label: "Awaiting Statement" },
  statement_attached: { bg: "#f0fdf4", color: "#166534", label: "Statement Attached" },
};

interface Props {
  claim: Claim;
  mode: DetailViewMode;
}

export function ClaimOverviewCard({ claim, mode }: Props) {
  const isAdminFinance = mode === "admin_finance";
  const status = STATUS_STYLES[claim.status] ?? STATUS_STYLES.awaiting_statement;
  const createdDate = new Date(claim.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-surface-900 mb-1">Claim Details</h2>
            <p className="font-mono text-sm text-brand-700">{claim.displayId}</p>
          </div>
          <span
            className="badge"
            style={{ background: status.bg, color: status.color }}
          >
            {status.label}
          </span>
        </div>
        {isAdminFinance && (
          <div className="flex flex-wrap gap-2 self-start">
            <Link
              href={`/claims/receipts/${claim.id}/edit`}
              className="btn-secondary flex-shrink-0"
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Edit
            </Link>
            <a
              href={claim.driveReceiptsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex-shrink-0"
            >
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="15,3 21,3 21,9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Open in Drive
            </a>
          </div>
        )}
      </div>

      {/* Overview Card */}
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm mb-6">
        <div className="px-6 py-4 border-b border-surface-100">
          <h3 className="text-sm font-semibold text-surface-900">Overview</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
          <div className="px-6 py-4 border-b border-surface-100 sm:border-r">
            <p className="text-xs text-surface-400 mb-1">Period</p>
            <p className="text-sm font-medium text-surface-800">
              {MONTHS[claim.claimMonth - 1]} {claim.claimYear}
            </p>
          </div>
          <div className="px-6 py-4 border-b border-surface-100">
            <p className="text-xs text-surface-400 mb-1">Entity</p>
            <p className="text-sm">
              <span className="px-2 py-0.5 bg-brand-50 text-brand-700 text-xs font-mono font-medium rounded">
                {claim.entity.code}
              </span>
              <span className="ml-2 text-surface-600 text-xs">{claim.entity.name}</span>
            </p>
          </div>
          <div className="px-6 py-4 border-b border-surface-100 sm:border-r">
            <p className="text-xs text-surface-400 mb-1">Claimant</p>
            {claim.claimant?.name ? (
              <p className="text-sm font-medium text-surface-800">{claim.claimant.name}</p>
            ) : (
              <p className="text-sm text-surface-400 italic">Unassigned</p>
            )}
          </div>
          <div className="px-6 py-4 border-b border-surface-100">
            <p className="text-xs text-surface-400 mb-1">Description</p>
            <p className="text-sm font-medium text-surface-800">{claim.description}</p>
          </div>
          <div className="px-6 py-4 border-b border-surface-100 sm:border-r">
            <p className="text-xs text-surface-400 mb-1">Created Date</p>
            <p className="text-sm font-medium text-surface-800">{createdDate}</p>
          </div>
          <div className="px-6 py-4 border-b border-surface-100">
            <p className="text-xs text-surface-400 mb-1">Created By</p>
            <p className="text-sm font-medium text-surface-800">
              {claim.createdByUser?.name ?? "—"}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
