"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUser, updateUser } from "../_actions";

type UserForEdit = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "finance" | "employee";
};

interface Props {
  onBack: () => void;
  editUser?: UserForEdit;
}

type ActionState = { error: string } | { ok: true } | null;

export function AddUserForm({ onBack, editUser }: Props) {
  const isEdit = !!editUser;
  const [state, action, pending] = useActionState(
    isEdit ? updateUser : createUser,
    null as ActionState
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state && "ok" in state) onBack();
  }, [state, onBack]);

  return (
    <div className="animate-in">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-700 mb-6 transition-colors"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to Users
      </button>

      <div style={{ maxWidth: 512 }}>
        <h2 className="text-xl font-bold text-surface-900 mb-1">
          {isEdit ? "Edit User" : "Add New User"}
        </h2>
        <p className="text-sm text-surface-400 mb-8">
          {isEdit
            ? "Update the user's name, email, or role."
            : "Pre-register a user so they can sign in with their company Google account."}
        </p>

        <form ref={formRef} action={action} autoComplete="off">
          {isEdit && <input type="hidden" name="userId" value={editUser.id} />}

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Full Name <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                name="name"
                type="text"
                className="input-field"
                placeholder="e.g. Ahmad Razak"
                defaultValue={editUser?.name ?? ""}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Email Address <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                name="email"
                type="email"
                className="input-field"
                placeholder="e.g. ahmad@company.com"
                defaultValue={editUser?.email ?? ""}
                autoComplete="off"
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Role <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select name="role" className="input-field" required defaultValue={editUser?.role ?? ""}>
                {!isEdit && <option value="" disabled>Select role…</option>}
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
          </div>

          <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 24, marginBottom: 16 }}>
            <span style={{ color: "#ef4444" }}>*</span> Indicates a mandatory field.
          </p>

          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save Changes" : "Add User")}
            </button>
            <button type="button" onClick={onBack} className="btn-secondary justify-center">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
