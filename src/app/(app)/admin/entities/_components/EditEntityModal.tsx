"use client";

import { useActionState, useEffect, useState } from "react";
import { updateEntity } from "../_actions";
import { COUNTRIES } from "@/lib/countries";

type Entity = {
  id: string;
  code: string;
  name: string;
  country: string;
};

interface Props {
  entity: Entity;
  onClose: () => void;
}

type ActionState = { error: string } | { ok: true } | null;

export function EditEntityModal({ entity, onClose }: Props) {
  const [state, action, pending] = useActionState(updateEntity, null as ActionState);
  const [code, setCode] = useState(entity.code);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);

  useEffect(() => {
    if (state && "ok" in state) onClose();
  }, [state, onClose]);

  const codeChanged = code !== entity.code;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (codeChanged) {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setPendingFormData(fd);
      setShowConfirm(true);
    }
  }

  function confirmRename() {
    if (pendingFormData) {
      setShowConfirm(false);
      action(pendingFormData);
    }
  }

  if (showConfirm) {
    return (
      <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false); }}>
        <div className="modal-content bg-white rounded-2xl border border-surface-200 shadow-xl w-full max-w-sm mx-4 p-6">
          <h3 className="text-base font-bold text-surface-900 mb-2">
            Rename entity code?
          </h3>
          <p className="text-sm text-surface-500 mb-5">
            Rename <code className="bg-surface-100 px-1.5 py-0.5 rounded text-xs font-mono">{entity.code}</code> to{" "}
            <code className="bg-surface-100 px-1.5 py-0.5 rounded text-xs font-mono">{code}</code>? This code is displayed everywhere across the portal — existing claims will show the new code immediately. Existing data is preserved; only the displayed identifier changes.
          </p>

          {state && "error" in state && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
              {state.error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="btn-secondary flex-1 justify-center"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={confirmRename}
              className="btn-primary flex-1 justify-center"
            >
              {pending ? "Saving…" : "Continue"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="modal-overlay show"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content bg-white"
        style={{
          width: "100%",
          maxWidth: 500,
          margin: "0 16px",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 28px 20px" }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>Edit Entity</h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid #e4e7ed",
              borderRadius: 8,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#6b7280",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form action={action} onSubmit={handleSubmit} autoComplete="off">
          <input type="hidden" name="entityId" value={entity.id} />
          <div style={{ padding: "4px 28px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Entity Code <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                name="code"
                type="text"
                className="input-field"
                style={{ fontFamily: "monospace" }}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                required
              />
              <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 5, marginBottom: 0 }}>
                Lowercase, hyphen-separated. Used in claim IDs and dropdowns.
              </p>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Entity Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                name="name"
                type="text"
                className="input-field"
                defaultValue={entity.name}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Country <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select name="country" className="input-field" defaultValue={entity.country}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.label}
                  </option>
                ))}
              </select>
            </div>

            {state && "error" in state && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 13, borderRadius: 8, padding: "10px 14px" }}>
                {state.error}
              </div>
            )}

            <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
              <span style={{ color: "#ef4444" }}>*</span> Indicates a mandatory field.
            </p>
          </div>

          {/* Footer */}
          <div style={{ padding: "8px 28px 24px", display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" onClick={onClose} className="btn-secondary justify-center">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
