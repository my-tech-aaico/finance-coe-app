"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createClaim } from "../_actions";
import { ClaimFormFields } from "../_components/ClaimFormFields";

type Entity = {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
};

type UserOption = {
  id: string;
  name: string;
  status: "active" | "inactive";
};

interface Props {
  entities: Entity[];
  users: UserOption[];
}

type ActionState = { error: string } | { ok: true } | null;

export function CreateClaimForm({ entities, users }: Props) {
  const [state, formAction, pending] = useActionState(createClaim, null as ActionState);

  return (
    <div className="animate-in">
      <Link
        href="/claims/receipts"
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Claims
      </Link>

      <div style={{ maxWidth: 560 }}>
        <h2 className="text-xl font-bold text-surface-900 mb-1">Create Claim</h2>
        <p className="text-sm text-surface-400 mb-8">
          A Google Drive folder will be automatically provisioned for this claim.
        </p>

        <form action={formAction} autoComplete="off">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <ClaimFormFields entities={entities} users={users} />

            {state && "error" in state && (
              <div style={{
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
          </div>

          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 24, marginBottom: 16 }}>
            <span style={{ color: "#ef4444" }}>*</span> Indicates a mandatory field.
          </p>

          <div className="flex gap-3 items-center">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? (
                <>
                  <svg className="animate-spin" width="16" height="16" fill="none" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Creating claim and provisioning Drive folder…
                </>
              ) : (
                "Create Claim"
              )}
            </button>
            <Link href="/claims/receipts" className="btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
