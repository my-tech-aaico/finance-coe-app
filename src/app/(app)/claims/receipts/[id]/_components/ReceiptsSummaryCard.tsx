import { DetailViewMode } from "../_lib/access";

interface Summary {
  count: number;
  totalLocal: number;
  totalUsd: number;
  currency: string;
}

interface Props {
  summary: Summary;
  mode: DetailViewMode;
}

function formatAmount(amount: number, decimals = 2): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function ReceiptsSummaryCard({ summary, mode }: Props) {
  const isFiltered = mode === "employee_other";

  return (
    <div className="bg-white rounded-xl border border-surface-200 shadow-sm p-6 mb-4">
      <h3 className="text-sm font-semibold text-surface-900 mb-4">Receipts Summary</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-4 rounded-lg bg-surface-50 border border-surface-100">
          <div className="text-2xl font-bold text-surface-900">{summary.count}</div>
          <div className="text-xs text-surface-400 mt-1 uppercase tracking-wide">Receipts</div>
        </div>
        <div className="text-center p-4 rounded-lg bg-surface-50 border border-surface-100">
          <div className="text-lg font-bold text-surface-900">
            {summary.currency} {formatAmount(summary.totalLocal)}
          </div>
          <div className="text-xs text-surface-400 mt-1 uppercase tracking-wide">Total ({summary.currency})</div>
        </div>
        <div className="text-center p-4 rounded-lg bg-surface-50 border border-surface-100">
          <div className="text-lg font-bold text-surface-900">
            ${formatAmount(summary.totalUsd)}
          </div>
          <div className="text-xs text-surface-400 mt-1 uppercase tracking-wide">Total (USD)</div>
        </div>
      </div>
      {isFiltered && (
        <div style={{
          marginTop: 12,
          padding: "8px 12px",
          background: "#f0f9ff",
          border: "1px solid #bae6fd",
          borderRadius: 8,
          fontSize: 13,
          color: "#0369a1",
        }}>
          Showing your receipts only. Other team members may have added receipts you can&apos;t see.
        </div>
      )}
    </div>
  );
}
