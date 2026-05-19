"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface Props {
  notice: "locked" | string;
}

export function NoticeBanner({ notice }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function dismiss() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("notice");
    const next = params.toString();
    startTransition(() => router.replace(next ? `${pathname}?${next}` : pathname));
  }

  if (notice !== "locked") return null;

  return (
    <div
      style={{
        background: "#fffbeb",
        border: "1px solid #fde68a",
        color: "#b45309",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 16,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ marginTop: 2, flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
        <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <div style={{ flex: 1, fontSize: 13 }}>
        Editing is locked while verification is queued or in progress. Wait for it to complete (or fail) before editing.
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{ background: "transparent", border: "none", color: "#b45309", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}
      >
        ×
      </button>
    </div>
  );
}
