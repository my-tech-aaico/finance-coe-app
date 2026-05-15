"use client";

import { useActionState, useEffect, useState } from "react";
import { toggleUserStatus } from "../_actions";

interface Props {
  userId: string;
  userName: string;
  currentStatus: "active" | "inactive";
}

type ActionState = { error: string } | { ok: true } | null;

export function ToggleStatusButton({ userId, userName, currentStatus }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [state, action, pending] = useActionState(toggleUserStatus, null as ActionState);

  useEffect(() => {
    if (state && "ok" in state) setConfirm(false);
  }, [state]);

  const deactivating = currentStatus === "active";

  if (deactivating && confirm) {
    return (
      <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) setConfirm(false); }}>
        <div className="modal-content bg-white rounded-2xl border border-surface-200 shadow-xl w-full max-w-sm mx-4 p-6">
          <h3 className="text-base font-bold text-surface-900 mb-2">
            Deactivate user?
          </h3>
          <p className="text-sm text-surface-500 mb-5">
            <strong className="text-surface-800">{userName}</strong> will be unable
            to sign in to the portal.
          </p>

          {state && "error" in state && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
              {state.error}
            </div>
          )}

          <form action={action}>
            <input type="hidden" name="userId" value={userId} />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirm(false)}
                className="btn-secondary flex-1"
              >
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
    <form
      action={action}
      onSubmit={(e) => {
        if (deactivating) {
          e.preventDefault();
          setConfirm(true);
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className="btn-icon"
        title={deactivating ? "Deactivate user" : "Reactivate user"}
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
    </form>
  );
}
