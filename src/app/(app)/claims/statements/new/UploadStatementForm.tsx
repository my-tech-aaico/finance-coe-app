"use client";

import { useActionState } from "react";
import Link from "next/link";
import { uploadStatement } from "../_actions";
import { StatementFormFields } from "../_components/StatementFormFields";

type ClaimOption = {
  id: string;
  displayId: string;
  description: string;
  claimantName: string | null;
};

interface Props {
  claims: ClaimOption[];
}

type ActionState = { error: string } | { ok: true } | null;

export function UploadStatementForm({ claims }: Props) {
  const [state, formAction, pending] = useActionState(uploadStatement, null as ActionState);

  return (
    <div className="animate-in">
      <Link
        href="/claims/statements"
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Statements
      </Link>

      <div style={{ maxWidth: 560 }}>
        <h2 className="text-xl font-bold text-surface-900 mb-1">Upload Statement</h2>
        <p className="text-sm text-surface-400 mb-8">
          Upload your credit card statement and link it to an existing claim.
        </p>

        <form action={formAction} autoComplete="off">
          <StatementFormFields mode="upload" claims={claims} />

          {state && "error" in state && (
            <div style={{
              marginTop: 16,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#dc2626",
              fontSize: 13,
              borderRadius: 8,
              padding: "10px 14px",
            }}>
              {state.error}
            </div>
          )}

          <p className="text-xs text-surface-400 mt-5">
            <span style={{ color: "#ef4444" }}>*</span> Indicates a mandatory field.
          </p>

          <div className="flex gap-3 items-center mt-4">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? (
                <>
                  <svg className="animate-spin" width="16" height="16" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Uploading…
                </>
              ) : (
                "Upload Statement"
              )}
            </button>
            <Link href="/claims/statements" className="btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
