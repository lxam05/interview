/**
 * Structured logs: one JSON object per line on stderr, so stdout stays clean
 * for command results. Never pass secret values in `fields`.
 */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.LOG_SILENT === "1") return;
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}
