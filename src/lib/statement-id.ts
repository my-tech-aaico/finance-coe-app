export function formatStatementDisplayId(sequence: number): string {
  return `STM-${String(sequence).padStart(3, "0")}`;
}
