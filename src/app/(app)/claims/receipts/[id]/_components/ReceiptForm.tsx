"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createReceipt, updateReceipt } from "../_actions";

type Dept = { id: string; code: string; name: string; status: "active" | "inactive" };
type Cls = { id: string; code: string; name: string; status: "active" | "inactive" };
type Receipt = {
  id: string;
  receiptDate: string;
  amountLocal: string;
  currencyCode: string;
  departmentId: string;
  classId: string;
  fileName: string;
};

interface AddProps {
  mode: "add";
  claimId: string;
  claimDisplayId: string;
  entityCurrency: string;
  departments: Dept[];
  classes: Cls[];
}

interface EditProps {
  mode: "edit";
  claimId: string;
  claimDisplayId: string;
  entityCurrency: string;
  departments: Dept[];
  classes: Cls[];
  receipt: Receipt;
}

type Props = AddProps | EditProps;
type ActionState = { error: string } | { ok: true } | null;

export function ReceiptForm(props: Props) {
  const isEdit = props.mode === "edit";
  const receipt = isEdit ? (props as EditProps).receipt : undefined;
  const action = isEdit ? updateReceipt : createReceipt;
  const [state, formAction, pending] = useActionState(action, null as ActionState);

  return (
    <div className="bg-white rounded-xl border border-surface-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-surface-900">
            {isEdit ? "Edit Receipt" : "Add Receipt"}
          </h3>
          <p className="text-xs text-surface-400 mt-0.5">
            Claim <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{props.claimDisplayId}</span>
          </p>
        </div>
        <Link
          href={`/claims/receipts/${props.claimId}`}
          className="flex items-center gap-1 text-sm text-surface-400 hover:text-surface-700 transition-colors"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M19 12H5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Claim
        </Link>
      </div>

      <form action={formAction} autoComplete="off">
        {isEdit && <input type="hidden" name="receiptId" value={receipt!.id} />}
        {!isEdit && <input type="hidden" name="claimId" value={props.claimId} />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          <div>
            <label className="input-label">
              Receipt File {!isEdit && <span style={{ color: "#ef4444" }}>*</span>}
            </label>
            {isEdit && receipt && (
              <p className="text-xs text-surface-400 mb-2">
                Current: <span className="font-medium text-surface-700">{receipt.fileName}</span>. Leave empty to keep existing file.
              </p>
            )}
            <input
              name="file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic"
              required={!isEdit}
              className="input-field"
              style={{ height: "auto", padding: "10px 14px" }}
            />
            <p className="text-xs text-surface-400 mt-1">PDF, JPEG, PNG, or HEIC. Max 10 MiB.</p>
          </div>

          <div>
            <label className="input-label">
              Receipt Date <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              name="receiptDate"
              type="date"
              required
              className="input-field"
              defaultValue={receipt?.receiptDate ?? new Date().toISOString().split("T")[0]}
            />
          </div>

          <div>
            <label className="input-label">
              Amount <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <div style={{ position: "relative" }}>
              <span style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 13,
                fontWeight: 600,
                color: "#6b7280",
                fontFamily: "monospace",
                pointerEvents: "none",
              }}>
                {props.entityCurrency}
              </span>
              <input
                name="amountLocal"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="input-field"
                style={{ paddingLeft: 52 }}
                defaultValue={receipt?.amountLocal ?? ""}
                placeholder="0.00"
              />
            </div>
            <p className="text-xs text-surface-400 mt-1">Amount in {props.entityCurrency} (the entity&apos;s currency). USD equivalent is calculated automatically.</p>
          </div>

          <div>
            <label className="input-label">
              Department <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <select name="departmentId" required className="input-field" defaultValue={receipt?.departmentId ?? ""}>
              <option value="" disabled>Select department…</option>
              {props.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code}{d.status === "inactive" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="input-label">
              Class <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <select name="classId" required className="input-field" defaultValue={receipt?.classId ?? ""}>
              <option value="" disabled>Select class…</option>
              {props.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}{c.status === "inactive" ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

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

        <div className="flex gap-3 items-center mt-6">
          <button
            type="submit"
            disabled={pending}
            className="btn-primary"
          >
            {pending ? (
              <>
                <svg className="animate-spin" width="16" height="16" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0110 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                {isEdit ? "Saving…" : "Uploading…"}
              </>
            ) : isEdit ? "Save Changes" : "Add Receipt"}
          </button>
          <Link href={`/claims/receipts/${props.claimId}`} className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
