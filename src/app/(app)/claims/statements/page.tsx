import { requireRole } from "@/lib/session";

export default async function StatementsPage() {
  await requireRole(["admin", "finance", "employee"]);

  return (
    <div className="animate-in flex flex-col items-center justify-center py-24 text-center">
      <div className="w-20 h-20 rounded-2xl bg-brand-50 flex items-center justify-center mb-6">
        <svg width="36" height="36" fill="none" viewBox="0 0 24 24">
          <path
            d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
            stroke="#4263eb"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="17,8 12,3 7,8"
            stroke="#4263eb"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="12"
            y1="3"
            x2="12"
            y2="15"
            stroke="#4263eb"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-surface-900 mb-2">
        Statements — Coming soon
      </h2>
      <p className="text-surface-400 max-w-md leading-relaxed">
        This section will be developed in a later phase after the initial MVP
        release. In the meantime, you can manage claims and receipts from the
        sidebar.
      </p>
    </div>
  );
}
