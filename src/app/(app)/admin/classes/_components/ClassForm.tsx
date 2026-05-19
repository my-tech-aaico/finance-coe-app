"use client";

import { useActionState, useRef, useState } from "react";
import { createClass, updateClass } from "../_actions";

type Cls = {
  id: string;
  code: string;
  name: string;
};

interface Props {
  editClass?: Cls;
}

type ActionState = { error: string } | { ok: true } | null;

export function ClassForm({ editClass }: Props) {
  const isEdit = !!editClass;
  const action = isEdit ? updateClass : createClass;
  const [state, formAction, pending] = useActionState(action, null as ActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmed, setConfirmed] = useState(false);

  function handleSubmitClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!isEdit || confirmed) return;
    const form = formRef.current;
    if (!form) return;

    const newCode = (form.elements.namedItem("code") as HTMLInputElement)?.value.trim();
    if (newCode === editClass!.code) return;

    e.preventDefault();
    const ok = window.confirm(
      `Rename "${editClass!.code}" to "${newCode}"? This code is displayed everywhere receipts use it — existing receipts will show the new code immediately. Continue?`
    );
    if (ok) {
      setConfirmed(true);
      setTimeout(() => {
        form.requestSubmit();
        setConfirmed(false);
      }, 0);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h2 className="text-xl font-bold text-surface-900 mb-1">
        {isEdit ? "Edit Class" : "Add Class"}
      </h2>
      <p className="text-sm text-surface-400 mb-6">
        {isEdit ? "Update the class code or name." : "Create a new expense class for receipt categorization."}
      </p>

      <form ref={formRef} action={formAction} autoComplete="off">
        {isEdit && <input type="hidden" name="classId" value={editClass!.id} />}

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <label className="input-label">
              Code <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              name="code"
              className="input-field"
              defaultValue={editClass?.code ?? ""}
              placeholder="e.g. travel"
              required
              style={{ fontFamily: "monospace" }}
            />
            <p className="text-xs text-surface-400 mt-1">
              Lowercase, hyphen-separated. Used in receipt records and dropdowns. Convention: short keyword (e.g. <code>travel</code>, <code>software</code>).
            </p>
          </div>

          <div>
            <label className="input-label">
              Name <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              name="name"
              className="input-field"
              defaultValue={editClass?.name ?? ""}
              placeholder="e.g. Travel & Transport"
              required
            />
          </div>

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
            ) : isEdit ? "Save Changes" : "Add Class"}
          </button>
          <a href="/admin/classes" className="btn-secondary">Cancel</a>
        </div>
      </form>
    </div>
  );
}
