export function formatDisplayId(month: number, year: number, sequence: number): string {
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, "0");
  const xxx = String(sequence).padStart(3, "0");
  return `${yy}${mm}-CLM-${xxx}`;
}
