import Link from "next/link";

export default function LoginErrorPage() {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-brand-50 via-white to-surface-50 flex flex-col items-center justify-center px-4 py-8">
      {/* Logo mark */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24">
            <path
              d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="font-bold text-xl text-surface-900 tracking-tight">
          COE Finance
        </span>
      </div>

      {/* Error card */}
      <div className="w-full max-w-sm bg-white rounded-2xl border border-surface-200 shadow-xl shadow-surface-900/5 p-8 text-center">
        {/* Error icon */}
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
          <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="1.8" />
            <line
              x1="15"
              y1="9"
              x2="9"
              y2="15"
              stroke="#ef4444"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <line
              x1="9"
              y1="9"
              x2="15"
              y2="15"
              stroke="#ef4444"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h2 className="text-lg font-bold text-surface-900 mb-2">
          Access Denied
        </h2>
        <p className="text-sm text-surface-500 leading-relaxed mb-6">
          We&apos;re sorry — you&apos;re not registered for access to this portal.
          Please contact an administrator if you believe this is a mistake.
        </p>

        <Link
          href="/login"
          className="btn-primary w-full justify-center"
        >
          Try a different account
        </Link>
      </div>
    </div>
  );
}
