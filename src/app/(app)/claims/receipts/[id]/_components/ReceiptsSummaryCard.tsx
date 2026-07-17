interface Summary {
  count: number;
}

interface Props {
  summary: Summary;
}

// v2: receipts carry no amount — the summary is a simple count (spec §5.5).
export function ReceiptsSummaryCard({ summary }: Props) {
  return (
    <div className="bg-white rounded-xl border border-surface-200 shadow-sm p-6 mb-4">
      <h3 className="text-sm font-semibold text-surface-900 mb-4">Receipts Summary</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="text-center p-4 rounded-lg bg-surface-50 border border-surface-100">
          <div className="text-2xl font-bold text-surface-900">{summary.count}</div>
          <div className="text-xs text-surface-400 mt-1 uppercase tracking-wide">Total Receipts</div>
        </div>
      </div>
    </div>
  );
}
