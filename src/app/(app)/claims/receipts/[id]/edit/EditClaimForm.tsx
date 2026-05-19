"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { updateClaim } from "../../_actions";
import { ClaimFormFields } from "../../_components/ClaimFormFields";
import { formatDisplayId } from "@/lib/claim-id";

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

type Claim = {
  id: string;
  displayId: string;
  claimMonth: number;
  claimYear: number;
  entityId: string;
  description: string;
  claimantId: string | null;
  sequenceNumber: number;
};

interface Props {
  claim: Claim;
  entities: Entity[];
  users: UserOption[];
}

type ActionState = { error: string } | { ok: true } | null;

export function EditClaimForm({ claim, entities, users }: Props) {
  const [state, formAction, pending] = useActionState(updateClaim, null as ActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmed, setConfirmed] = useState(false);

  function handleSubmitClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (confirmed) return;
    const form = formRef.current;
    if (!form) return;

    const newMonth = Number((form.elements.namedItem("claimMonth") as HTMLSelectElement)?.value);
    const newYear = Number((form.elements.namedItem("claimYear") as HTMLSelectElement)?.value);
    const newEntityId = (form.elements.namedItem("entityId") as HTMLSelectElement)?.value;

    const periodChanged = newMonth !== claim.claimMonth || newYear !== claim.claimYear;
    const entityChanged = newEntityId !== claim.entityId;

    if (!periodChanged && !entityChanged) return;

    e.preventDefault();

    const lines: string[] = [];

    if (periodChanged) {
      const newDisplayId = formatDisplayId(newMonth, newYear, claim.sequenceNumber);
      lines.push(
        `Period change: This claim will be renumbered from ${claim.displayId} to ${newDisplayId}, and its Drive folder will be renamed. Receipt and statement files inside the folder are preserved.`
      );
    }

    if (entityChanged) {
      const oldEntity = entities.find((en) => en.id === claim.entityId);
      const newEntity = entities.find((en) => en.id === newEntityId);
      lines.push(
        `Entity change: The entity will change from ${oldEntity?.code ?? "unknown"} to ${newEntity?.code ?? "unknown"}. Existing receipts and the Drive folder are preserved — only the entity association changes.`
      );
    }

    const message = lines.join("\n\n") + "\n\nContinue?";
    const ok = window.confirm(message);
    if (ok) {
      setConfirmed(true);
      setTimeout(() => {
        form.requestSubmit();
        setConfirmed(false);
      }, 0);
    }
  }

  return (
    <div className="animate-in">
      <Link
        href={`/claims/receipts/${claim.id}`}
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Claim Details
      </Link>

      <div style={{ maxWidth: 560 }}>
        <h2 className="text-xl font-bold text-surface-900 mb-1">Edit Claim</h2>
        <p className="text-sm text-surface-400 mb-2">
          Claim ID: <span style={{
            fontFamily: "monospace",
            fontWeight: 600,
            background: "#eff6ff",
            color: "#1d4ed8",
            padding: "2px 8px",
            borderRadius: 6,
          }}>{claim.displayId}</span>
        </p>

        {/* Info banner */}
        <div style={{
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          color: "#1e40af",
          fontSize: 13,
          borderRadius: 8,
          padding: "10px 14px",
          marginBottom: 24,
        }}>
          Changing the Claim Month or Year will renumber this claim and rename its Drive folder. Changing the Entity updates the claim&apos;s attribution but doesn&apos;t affect the Drive folder. Description and Claimant can be edited freely.
        </div>

        <form ref={formRef} action={formAction} autoComplete="off">
          <input type="hidden" name="claimId" value={claim.id} />

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <ClaimFormFields
              entities={entities}
              users={users}
              defaultValues={{
                claimMonth: claim.claimMonth,
                claimYear: claim.claimYear,
                entityId: claim.entityId,
                description: claim.description,
                claimantId: claim.claimantId,
              }}
              currentEntityId={claim.entityId}
              currentClaimantId={claim.claimantId}
            />

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
            <button
              type="submit"
              disabled={pending}
              className="btn-primary"
              onClick={handleSubmitClick}
            >
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
            <Link href={`/claims/receipts/${claim.id}`} className="btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
