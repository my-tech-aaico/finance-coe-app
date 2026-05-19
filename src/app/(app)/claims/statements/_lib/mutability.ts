export type StatementVerificationStatus =
  | "pending_verification"
  | "queued"
  | "in_progress"
  | "success"
  | "failed";

export function isStatementMutable(
  status: StatementVerificationStatus
): boolean {
  return (
    status === "pending_verification" ||
    status === "success" ||
    status === "failed"
  );
}
