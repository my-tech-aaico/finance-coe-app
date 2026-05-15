interface Props {
  status: "awaiting_statement" | "statement_attached";
  faded?: boolean;
}

const CONFIG = {
  awaiting_statement: {
    label: "Awaiting Statement",
    style: { background: "#fef9c3", color: "#854d0e" },
    fadedStyle: { background: "#f3f4f6", color: "#9ca3af" },
  },
  statement_attached: {
    label: "Statement Attached",
    style: { background: "#dbeafe", color: "#1e40af" },
    fadedStyle: { background: "#f3f4f6", color: "#9ca3af" },
  },
};

export function StatusBadge({ status, faded }: Props) {
  const { label, style, fadedStyle } = CONFIG[status];
  return (
    <span className="badge" style={{ ...(faded ? fadedStyle : style), whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}
