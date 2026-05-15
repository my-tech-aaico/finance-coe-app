import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { GoogleSignInButton } from "./login-button";

export default async function LoginPage() {
  const u = await getCurrentUser();
  if (u) redirect("/dashboard");

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-brand-50 via-white to-surface-50 flex flex-col items-center justify-center">

      {/* Login card */}
      <div className="w-full max-w-sm bg-white rounded-2xl border border-surface-200 shadow-xl shadow-surface-900/5 p-8">
        <div className="text-center mb-7">
          <h2 className="text-lg font-bold text-surface-900 mb-1.5">
            Welcome back
          </h2>
          <p className="text-sm text-surface-500">
            Sign in with your company Google account to continue
          </p>
        </div>

        <GoogleSignInButton />

        {/* Access info */}
        <div className="mt-6 flex items-start gap-2.5 text-xs text-surface-400 bg-surface-50 border border-surface-100 rounded-lg px-3.5 py-3">
          <svg
            width="14"
            height="14"
            fill="none"
            viewBox="0 0 24 24"
            className="flex-shrink-0 mt-0.5 text-surface-400"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
            <line
              x1="12"
              y1="16"
              x2="12"
              y2="12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <line
              x1="12"
              y1="8"
              x2="12.01"
              y2="8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <p className="leading-relaxed">
            Only company email addresses pre-registered by an administrator can
            access this portal.
          </p>
        </div>
      </div>
    </div>
  );
}
