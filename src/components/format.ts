const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "March 2026", "2026", or null. Never a guessed day. */
export function yearMonth(year: number | null, month: number | null): string | null {
  if (!year) return null;
  return month ? `${MONTHS[month - 1]} ${year}` : String(year);
}

export function shortDate(d: Date | string | null | undefined): string {
  if (!d) return "unknown date";
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
