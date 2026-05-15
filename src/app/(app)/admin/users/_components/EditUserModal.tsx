"use client";

import { useActionState, useEffect } from "react";
import { updateUser } from "../_actions";

type User = {
  id: string;
  name: string;
  role: "admin" | "finance" | "employee";
};

interface Props {
  user: User;
  onClose: () => void;
}

type ActionState = { error: string } | { ok: true } | null;

export function EditUserModal({ user, onClose }: Props) {
  const [state, action, pending] = useActionState(updateUser, null as ActionState);

  useEffect(() => {
    if (state && "ok" in state) onClose();
  }, [state, onClose]);

  return (
    <div className="modal-overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: 0 }}>Edit User</h3>
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

        {/* Form body */}
        <form action={action} autoComplete="off">
          <input type="hidden" name="userId" value={user.id} />
          <div style={{ padding: "4px 28px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                name="name"
                type="text"
                className="input-field"
                defaultValue={user.name}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Role <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select name="role" className="input-field" defaultValue={user.role}>
                <option value="admin">Admin</option>
                <option value="finance">Finance</option>
                <option value="employee">Employee</option>
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
            <button type="button" onClick={onClose} className="btn-secondary">
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
