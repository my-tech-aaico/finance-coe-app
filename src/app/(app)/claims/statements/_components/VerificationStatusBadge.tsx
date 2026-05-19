import type { StatementVerificationStatus } from "../_lib/mutability";

interface Props {
  status: StatementVerificationStatus;
  faded?: boolean;
}

// Colors mirror the UI mock (HTML lines 1393, 1403, 1413, 1428, 1438):
//   success           ecfdf5 / 047857
//   in_progress       eff6ff / 1d4ed8
//   pending_verif.    eef2ff / 4338ca
//   queued            f5f3ff / 6d28d9
//   failed            fef2f2 / b91c1c
const CONFIG: Record<
  StatementVerificationStatus,
  { label: string; background: string; color: string }
> = {
  pending_verification: {
    label: "Pending Verification",
    background: "#eef2ff",
    color: "#4338ca",
  },
  queued: { label: "Queued", background: "#f5f3ff", color: "#6d28d9" },
  in_progress: {
    label: "In Progress",
    background: "#eff6ff",
    color: "#1d4ed8",
  },
  success: { label: "Success", background: "#ecfdf5", color: "#047857" },
  failed: { label: "Failed", background: "#fef2f2", color: "#b91c1c" },
};

const FADED = { background: "#f3f4f6", color: "#9ca3af" };

export function VerificationStatusBadge({ status, faded }: Props) {
  const cfg = CONFIG[status];
  const style = faded ? FADED : { background: cfg.background, color: cfg.color };
  return (
    <span className="badge" style={{ ...style, whiteSpace: "nowrap" }}>
      {cfg.label}
    </span>
  );
}
