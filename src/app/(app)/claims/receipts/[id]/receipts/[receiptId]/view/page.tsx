import { requireRole } from "@/lib/session";
import { db } from "@/db";
import { receipt } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { resolveDetailViewMode } from "../../../_lib/access";
import { FileViewer } from "../../../_components/FileViewer";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function ReceiptViewPage({
  params,
}: {
  params: Promise<{ id: string; receiptId: string }>;
}) {
  const actor = await requireRole(["admin", "finance", "employee"]);
  const { id: claimId, receiptId } = await params;

  const row = await db.query.receipt.findFirst({
    where: eq(receipt.id, receiptId),
    with: {
      claim: { with: { entity: true } },
      uploadedByUser: true,
    },
  });
  if (!row || row.claimId !== claimId) notFound();
  if (row.claim.deletedAt) notFound();

  const mode = await resolveDetailViewMode(actor, row.claim);
  if (mode === "employee_other" && row.uploadedBy !== actor.id) redirect("/dashboard");

  const fileStreamUrl = `/api/receipts/${receiptId}/file`;

  return (
    <div className="animate-in" style={{ maxWidth: 900, margin: "0 auto" }}>
      <Link
        href={`/claims/receipts/${claimId}`}
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to claim {row.claim.displayId}
      </Link>

      <div className="bg-white rounded-xl border border-surface-200 shadow-sm p-6 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-surface-900 mb-3">{row.fileName}</h2>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div>
                <dt className="text-xs font-semibold text-surface-400 uppercase tracking-wide mb-0.5">Date</dt>
                <dd className="text-surface-800">{formatDate(row.receiptDate)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-surface-400 uppercase tracking-wide mb-0.5">Amount</dt>
                <dd className="text-surface-800">
                  {row.currencyCode} {Number(row.amountLocal).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  {" "}<span className="text-surface-400">≈ ${Number(row.amountUsd).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-surface-400 uppercase tracking-wide mb-0.5">Uploaded By</dt>
                <dd className="text-surface-800">{row.uploadedByUser?.name ?? "—"}</dd>
              </div>
            </dl>
          </div>
          {(actor.role === "admin" || actor.role === "finance") && (
            <a
              href={row.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ whiteSpace: "nowrap", flexShrink: 0 }}
            >
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="15,3 21,3 21,9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Open in Drive
            </a>
          )}
        </div>
      </div>

      <FileViewer src={fileStreamUrl} fileName={row.fileName} />
    </div>
  );
}
