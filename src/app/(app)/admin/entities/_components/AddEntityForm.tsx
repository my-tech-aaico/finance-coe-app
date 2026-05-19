"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createEntity, updateEntity } from "../_actions";
import { COUNTRIES } from "@/lib/countries";

const COMMON_CURRENCIES = [
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "CNY", label: "CNY — Chinese Yuan" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "HKD", label: "HKD — Hong Kong Dollar" },
  { code: "IDR", label: "IDR — Indonesian Rupiah" },
  { code: "INR", label: "INR — Indian Rupee" },
  { code: "JPY", label: "JPY — Japanese Yen" },
  { code: "KRW", label: "KRW — South Korean Won" },
  { code: "MYR", label: "MYR — Malaysian Ringgit" },
  { code: "NZD", label: "NZD — New Zealand Dollar" },
  { code: "PHP", label: "PHP — Philippine Peso" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
  { code: "THB", label: "THB — Thai Baht" },
  { code: "TWD", label: "TWD — Taiwan Dollar" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "VND", label: "VND — Vietnamese Dong" },
];

type EntityForEdit = {
  id: string;
  code: string;
  name: string;
  country: string;
  currency: string;
};

interface Props {
  onBack: () => void;
  editEntity?: EntityForEdit;
}

type ActionState = { error: string } | { ok: true } | null;

export function AddEntityForm({ onBack, editEntity }: Props) {
  const isEdit = !!editEntity;
  const [state, formAction, pending] = useActionState(
    isEdit ? updateEntity : createEntity,
    null as ActionState
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (state && "ok" in state) onBack();
  }, [state, onBack]);

  function handleSubmitClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!isEdit || !editEntity || confirmed) return;
    const form = formRef.current;
    if (!form) return;
    const newCode = (form.elements.namedItem("code") as HTMLInputElement)?.value?.trim();
    if (newCode && newCode !== editEntity.code) {
      e.preventDefault();
      const ok = window.confirm(
        `Changing the entity code from "${editEntity.code}" to "${newCode}" will update how this entity appears in all claim references. This cannot be undone. Continue?`
      );
      if (ok) {
        setConfirmed(true);
        setTimeout(() => {
          form.requestSubmit();
          setConfirmed(false);
        }, 0);
      }
    }
  }

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
        Back to Entities
      </button>

      <div style={{ maxWidth: 512 }}>
        <h2 className="text-xl font-bold text-surface-900 mb-1">
          {isEdit ? "Edit Entity" : "Add New Entity"}
        </h2>
        <p className="text-sm text-surface-400 mb-8">
          {isEdit
            ? "Update the entity code, name, or country."
            : "Configure a new legal entity that can own claim records."}
        </p>

        <form ref={formRef} action={formAction} autoComplete="off">
          {isEdit && <input type="hidden" name="entityId" value={editEntity.id} />}

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Entity Code <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                name="code"
                type="text"
                className="input-field"
                placeholder="e.g. apd-my"
                defaultValue={editEntity?.code ?? ""}
                style={{ fontFamily: "monospace" }}
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                required
              />
              <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 0 }}>
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
                placeholder="e.g. APD Malaysia"
                defaultValue={editEntity?.name ?? ""}
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
              <select name="country" className="input-field" required defaultValue={editEntity?.country ?? ""}>
                {!isEdit && <option value="" disabled>Select country…</option>}
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Currency <span style={{ color: "#ef4444" }}>*</span>
              </label>
              <select name="currency" className="input-field" required defaultValue={editEntity?.currency ?? ""}>
                {!isEdit && <option value="" disabled>Select currency…</option>}
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6 }}>
                The local currency for this entity. Used to derive the currency of receipts.
              </p>
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
            <button type="submit" disabled={pending} className="btn-primary" onClick={handleSubmitClick}>
              {pending ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save Changes" : "Add Entity")}
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
