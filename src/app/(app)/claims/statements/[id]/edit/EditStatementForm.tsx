"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateStatement } from "../../_actions";
import { StatementFormFields } from "../../_components/StatementFormFields";

type ClaimOption = {
  id: string;
  displayId: string;
  description: string;
  claimantName: string | null;
};

interface Props {
  statementId: string;
  statementDisplayId: string;
  claims: ClaimOption[];
  current: {
    statementDate: string;
    claimId: string;
    fileName: string;
    fileSizeBytes: number;
    fileUrl: string;
    uploadDate: Date;
  };
}

type ActionState = { error: string } | { ok: true } | null;

export function EditStatementForm({
  statementId,
  statementDisplayId,
  claims,
  current,
}: Props) {
  const [state, formAction, pending] = useActionState(updateStatement, null as ActionState);

  return (
    <div className="animate-in">
      <Link
        href={`/claims/statements/${statementId}`}
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Statement
      </Link>

      <div style={{ maxWidth: 560 }}>
        <h2 className="text-xl font-bold text-surface-900 mb-1">Edit Statement</h2>
        <p className="text-sm text-surface-400 mb-6">
          <span style={{ fontFamily: "monospace", color: "#1d4ed8" }}>{statementDisplayId}</span>
        </p>

        {/* Edit-mode warning banner */}
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: 24,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 2, color: "#b45309" }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
            <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.6 }}>
            <p style={{ marginBottom: 6 }}>
              <strong>Re-uploading a file</strong> will permanently delete the existing statement file from Google Drive.
            </p>
            <p style={{ marginBottom: 6 }}>
              <strong>Changing the linked claim</strong> will move the file from the previous claim&rsquo;s folder to the new claim&rsquo;s folder, and revert the old claim to &ldquo;Awaiting Statement&rdquo;.
            </p>
            <p>
              Either change will reset the verification status to <strong>Pending Verification</strong>.
            </p>
          </div>
        </div>

        <form action={formAction} autoComplete="off">
          <input type="hidden" name="statementId" value={statementId} />

          <StatementFormFields mode="edit" claims={claims} current={current} />

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
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </button>
            <Link href={`/claims/statements/${statementId}`} className="btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
