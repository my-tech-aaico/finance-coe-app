"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toggleEntityStatus, getDeactivationContext } from "../_actions";

interface Props {
  entityId: string;
  entityCode: string;
  currentStatus: "active" | "inactive";
}

type ActionState = { error: string } | { ok: true } | null;
type DeactivationContext = Awaited<ReturnType<typeof getDeactivationContext>>;

export function ToggleStatusButton({ entityId, entityCode, currentStatus }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [context, setContext] = useState<DeactivationContext>(null);
  const [state, action, pending] = useActionState(toggleEntityStatus, null as ActionState);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (state && "ok" in state) setConfirm(false);
  }, [state]);

  const deactivating = currentStatus === "active";

  function handleClick() {
    if (deactivating) {
      startTransition(async () => {
        const ctx = await getDeactivationContext(entityId);
        setContext(ctx);
        setConfirm(true);
      });
    } else {
      setConfirm(true);
    }
  }

  if (confirm) {
    if (deactivating) {
      return (
        <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) setConfirm(false); }}>
          <div className="modal-content bg-white rounded-2xl border border-surface-200 shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-bold text-surface-900 mb-2">
              Deactivate entity?
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {context?.isLastActive && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13, borderRadius: 8, padding: "10px 14px" }}>
                  ⚠️ This is the last active entity. Deactivating means no new claims can be created until another entity is added or reactivated.
                </div>
              )}
              {context && context.claimCount > 0 ? (
                <p className="text-sm text-surface-500">
                  <code className="bg-surface-100 px-1.5 py-0.5 rounded text-xs font-mono">{entityCode}</code> has{" "}
                  {context.claimCount} claim{context.claimCount !== 1 ? "s" : ""} linked
                  {context.openClaimCount > 0 ? ` (${context.openClaimCount} in progress)` : ""}. Deactivating means it won&apos;t appear in the dropdown for new claims; existing claims are unaffected.
                </p>
              ) : (
                <p className="text-sm text-surface-500">
                  Deactivate <code className="bg-surface-100 px-1.5 py-0.5 rounded text-xs font-mono">{entityCode}</code>? It will no longer appear in the claim creation dropdown.
                </p>
              )}
            </div>

            {state && "error" in state && (
              <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
                {state.error}
              </div>
            )}

            <form action={action}>
              <input type="hidden" name="entityId" value={entityId} />
              <div className="flex gap-3">
                <button type="button" onClick={() => setConfirm(false)} className="btn-secondary flex-1 justify-center">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="btn-primary flex-1 justify-center !bg-red-600 hover:!bg-red-700"
                >
                  {pending ? "Deactivating…" : "Deactivate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) setConfirm(false); }}>
        <div className="modal-content bg-white rounded-2xl border border-surface-200 shadow-xl w-full max-w-sm mx-4 p-6">
          <h3 className="text-base font-bold text-surface-900 mb-2">
            Reactivate entity?
          </h3>
          <p className="text-sm text-surface-500 mb-5">
            Reactivate <code className="bg-surface-100 px-1.5 py-0.5 rounded text-xs font-mono">{entityCode}</code>? It will be selectable again in the Claim creation dropdown.
          </p>

          {state && "error" in state && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
              {state.error}
            </div>
          )}

          <form action={action}>
            <input type="hidden" name="entityId" value={entityId} />
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirm(false)} className="btn-secondary flex-1 justify-center">
                Cancel
              </button>
              <button type="submit" disabled={pending} className="btn-primary flex-1 justify-center">
                {pending ? "Reactivating…" : "Reactivate"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="btn-icon"
      title={deactivating ? "Deactivate entity" : "Reactivate entity"}
    >
      {deactivating ? (
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="1.8" />
          <line x1="15" y1="9" x2="9" y2="15" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="9" y1="9" x2="15" y2="15" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
          <polyline points="20,6 9,17 4,12" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
