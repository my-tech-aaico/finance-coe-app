"use client";

import { useActionState, useTransition } from "react";
import Link from "next/link";
import { deleteReceipt } from "../_actions";
import { DetailViewMode } from "../_lib/access";

type Receipt = {
  id: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: Date;
  projectCode: string | null;
  department: { code: string; name: string } | null;
  class_: { code: string; name: string } | null;
  teamSplit: { code: string; name: string } | null;
  uploadedByUser: { name: string } | null;
};

interface Props {
  receipts: Receipt[];
  mode: DetailViewMode;
  actorId: string;
  claimId: string;
}

function canEdit(mode: DetailViewMode, actorId: string, receipt: Receipt): boolean {
  if (mode === "admin_finance") return true;
  return receipt.uploadedBy === actorId;
}

function formatUploaded(d: Date): string {
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Chip({ text, bg, color }: { text: string; bg: string; color: string }) {
  return (
    <span style={{
      fontFamily: "monospace",
      fontSize: 11,
      fontWeight: 600,
      background: bg,
      color,
      padding: "2px 7px",
      borderRadius: 5,
    }}>
      {text}
    </span>
  );
}

function DeleteButton({ receiptId, fileName }: { receiptId: string; fileName: string }) {
  const [, formAction, pending] = useActionState(deleteReceipt, null);
  const [, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!window.confirm(`Delete this receipt? The file "${fileName}" will be permanently removed from Google Drive. This cannot be undone.`)) return;
    const fd = new FormData();
    fd.set("receiptId", receiptId);
    startTransition(() => formAction(fd));
  }

  return (
    <button
      className="btn-icon"
      title="Delete receipt"
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

export function ReceiptsTable({ receipts, mode, actorId, claimId }: Props) {
  if (receipts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 border-b border-surface-100">
          <h3 className="text-sm font-semibold text-surface-900">Receipts</h3>
          <Link href={`?action=add-receipt`} className="btn-primary mt-3 sm:mt-0" style={{ fontSize: 13, padding: "8px 16px" }}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Add Receipt
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <div className="w-12 h-12 rounded-full bg-surface-100 flex items-center justify-center mb-4">
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="#a1a8b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="14,2 14,8 20,8" stroke="#a1a8b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-surface-900 font-semibold mb-1">No receipts yet</p>
          <p className="text-sm text-surface-400 mb-5" style={{ maxWidth: 320 }}>
            Add your first receipt to start building this claim.
          </p>
          <Link href="?action=add-receipt" className="btn-primary">Add Receipt</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 border-b border-surface-100">
        <h3 className="text-sm font-semibold text-surface-900">Receipts</h3>
        <Link href="?action=add-receipt" className="btn-primary mt-3 sm:mt-0" style={{ fontSize: 13, padding: "8px 16px" }}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Add Receipt
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-100 bg-surface-50">
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Uploaded</th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Department</th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Class</th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Team Split</th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Project Code</th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">File</th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Uploaded By</th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {receipts.map((r) => {
              const editable = canEdit(mode, actorId, r);
              return (
                <tr key={r.id} className="table-row">
                  <td className="px-5 py-4 whitespace-nowrap text-surface-700">{formatUploaded(r.uploadedAt)}</td>
                  <td className="px-5 py-4">
                    {r.department ? <Chip text={r.department.code} bg="#eff6ff" color="#1d4ed8" /> : <span className="text-surface-400">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    {r.class_ ? <Chip text={r.class_.code} bg="#f0fdf4" color="#166534" /> : <span className="text-surface-400">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    {r.teamSplit ? <Chip text={r.teamSplit.code} bg="#f1f3f7" color="#374151" /> : <span className="text-surface-300">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    {r.projectCode ? <Chip text={r.projectCode} bg="#f0f4ff" color="#4263eb" /> : <span className="text-surface-300">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    <a
                      href={`/claims/receipts/${claimId}/receipts/${r.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-icon"
                      title="View receipt file"
                    >
                      <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                      </svg>
                    </a>
                  </td>
                  <td className="px-5 py-4 text-surface-600 text-sm">{r.uploadedByUser?.name ?? "—"}</td>
                  <td className="px-5 py-4">
                    {editable ? (
                      <div className="flex items-center gap-2">
                        <Link
                          href={`?action=edit-receipt&rid=${r.id}`}
                          className="btn-icon"
                          title="Edit receipt"
                        >
                          <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </Link>
                        <DeleteButton receiptId={r.id} fileName={r.fileName} />
                      </div>
                    ) : (
                      <span className="text-surface-300 text-sm">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
