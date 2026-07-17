import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";

export default async function DashboardPage() {
  const user = await requireUser();
  // v2: Employees have no dashboard — send them straight to Receipts (spec §4.3).
  if (user.role === "employee") redirect("/claims/receipts");

  return (
    <div className="animate-in flex flex-col items-center justify-center py-24 text-center">
      <div className="w-20 h-20 rounded-2xl bg-brand-50 flex items-center justify-center mb-6">
        <svg width="36" height="36" fill="none" viewBox="0 0 24 24">
          <path
            d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
            stroke="#4263eb"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-surface-900 mb-2">
        Dashboard — Coming soon
      </h2>
      <p className="text-surface-400 max-w-md leading-relaxed">
        This section will be developed in a later phase after the initial MVP
        release. In the meantime, you can manage claims, statements, and users
        from the sidebar.
      </p>
    </div>
  );
}
