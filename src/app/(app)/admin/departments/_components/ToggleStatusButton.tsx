"use client";

import { useActionState, useTransition } from "react";
import { toggleDepartmentStatus, getDeactivationContext } from "../_actions";

interface Props {
  departmentId: string;
  departmentCode: string;
  currentStatus: "active" | "inactive";
}

export function ToggleStatusButton({ departmentId, departmentCode, currentStatus }: Props) {
  const [, formAction, pending] = useActionState(toggleDepartmentStatus, null);
  const [, startTransition] = useTransition();

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();

    if (currentStatus === "active") {
      const ctx = await getDeactivationContext(departmentId);
      if (!ctx) return;

      const lines: string[] = [`Deactivate "${departmentCode}"?`];
      if (ctx.isLastActive) {
        lines.push("⚠️ This is the last active department. Deactivating means no new receipts can be created until another department is added or reactivated.");
      }
      lines.push("Existing receipts are unaffected. Continue?");

      if (!window.confirm(lines.join("\n\n"))) return;
    } else {
      if (!window.confirm(`Reactivate "${departmentCode}"?`)) return;
    }

    const fd = new FormData();
    fd.set("departmentId", departmentId);
    startTransition(() => formAction(fd));
  }

  const isActivating = currentStatus === "inactive";

  return (
    <button
      className="btn-icon"
      title={isActivating ? "Reactivate department" : "Deactivate department"}
      disabled={pending}
      onClick={handleClick}
      style={isActivating ? { color: "#059669", borderColor: "#a7f3d0" } : { color: "#6b7280" }}
    >
      {isActivating ? (
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="22,4 12,14.01 9,11.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="15" height="15" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
          <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
