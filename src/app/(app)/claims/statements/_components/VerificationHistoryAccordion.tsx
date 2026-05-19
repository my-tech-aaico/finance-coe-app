"use client";

import { useState } from "react";
import { VerificationStatusBadge } from "./VerificationStatusBadge";

type AttemptStatus = "queued" | "in_progress" | "success" | "failed";
type TriggerSource =
  | "upload_checkbox"
  | "manual_start"
  | "manual_retry"
  | "scheduler";

export type AttemptRow = {
  id: string;
  status: AttemptStatus;
  opusJobId: string | null;
  opusResponse: unknown;
  triggeredByName: string | null;
  triggerSource: TriggerSource;
  createdAt: Date;
};

interface Props {
  attempts: AttemptRow[];
  lastDestructiveEditAt: Date | null;
}

const TRIGGER_LABEL: Record<TriggerSource, string> = {
  upload_checkbox: "Auto-queued at upload",
  manual_start: "Manually started",
  manual_retry: "Retry",
  scheduler: "Scheduler",
};

const STATUS_PANEL_STYLE: Record<
  AttemptStatus,
  { background: string; border: string; color: string; mutedColor: string }
> = {
  queued: {
    background: "#f5f3ff",
    border: "#ddd6fe",
    color: "#5b21b6",
    mutedColor: "#7c3aed",
  },
  in_progress: {
    background: "#eff6ff",
    border: "#bfdbfe",
    color: "#1e40af",
    mutedColor: "#3b82f6",
  },
  success: {
    background: "#ecfdf5",
    border: "#a7f3d0",
    color: "#065f46",
    mutedColor: "#10b981",
  },
  failed: {
    background: "#fef2f2",
    border: "#fecaca",
    color: "#991b1b",
    mutedColor: "#ef4444",
  },
};

function formatTimestamp(d: Date): string {
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function isStale(
  attempt: AttemptRow,
  lastDestructiveEditAt: Date | null
): boolean {
  if (!lastDestructiveEditAt) return false;
  return new Date(attempt.createdAt) < new Date(lastDestructiveEditAt);
}

function AttemptItem({
  attempt,
  stale,
  lastDestructiveEditAt,
}: {
  attempt: AttemptRow;
  stale: boolean;
  lastDestructiveEditAt: Date | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerLabel = TRIGGER_LABEL[attempt.triggerSource];
  const subLabel = attempt.triggeredByName
    ? `${triggerLabel} by ${attempt.triggeredByName}`
    : triggerLabel;
  const panel = STATUS_PANEL_STYLE[attempt.status];

  return (
    <div
      className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-4 hover:bg-surface-50 transition-colors"
        type="button"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <VerificationStatusBadge status={attempt.status} />
          <span style={{ fontFamily: "monospace", fontSize: 13, color: "#6b7280" }}>
            {attempt.opusJobId ?? "—"}
          </span>
          {stale && (
            <span
              className="badge"
              style={{ background: "#fef3c7", color: "#92400e", fontSize: 11 }}
              title="This attempt was generated before the statement was last edited."
            >
              Stale
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{formatTimestamp(new Date(attempt.createdAt))}</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            style={{
              transition: "transform 150ms",
              transform: open ? "rotate(180deg)" : undefined,
              color: "#9ca3af",
            }}
          >
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      <div style={{ padding: open ? "0 20px 20px" : 0, maxHeight: open ? undefined : 0, overflow: "hidden" }}>
        {open && (
          <div style={{ paddingLeft: 0 }}>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>{subLabel}</p>

            {stale && (
              <div
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  color: "#92400e",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                This response was generated against an earlier version of the statement. The current file or claim link was updated on {lastDestructiveEditAt && formatTimestamp(new Date(lastDestructiveEditAt))}.
              </div>
            )}

            <div
              style={{
                background: panel.background,
                border: `1px solid ${panel.border}`,
                borderRadius: 8,
                padding: "14px 16px",
              }}
            >
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: panel.color,
                  marginBottom: 8,
                }}
              >
                Opus Response
              </p>
              {attempt.opusResponse !== null && attempt.opusResponse !== undefined ? (
                <pre
                  style={{
                    fontSize: 12,
                    color: panel.color,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  }}
                >
                  {typeof attempt.opusResponse === "string"
                    ? attempt.opusResponse
                    : JSON.stringify(attempt.opusResponse, null, 2)}
                </pre>
              ) : (
                <p style={{ fontSize: 13, color: panel.color }}>
                  Awaiting scheduler pickup. This attempt was queued at {formatTimestamp(new Date(attempt.createdAt))}. Opus hasn&rsquo;t started processing it yet.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function VerificationHistoryAccordion({ attempts, lastDestructiveEditAt }: Props) {
  if (attempts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm px-5 py-8 text-center">
        <p className="text-sm text-surface-400">
          No verification attempts yet. Click <span className="font-semibold text-surface-600">Start Verification</span> to begin.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {attempts.map((a) => (
        <AttemptItem
          key={a.id}
          attempt={a}
          stale={isStale(a, lastDestructiveEditAt)}
          lastDestructiveEditAt={lastDestructiveEditAt}
        />
      ))}
    </div>
  );
}
