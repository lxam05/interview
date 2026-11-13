/** Refuse to start in production without the admin secrets. */
export function register() {
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const missing = ["ADMIN_PASSWORD", "SESSION_SECRET", "DATABASE_URL"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Refusing to start: ${missing.join(", ")} not set. See docs/deployment.md.`);
  }
  if ((process.env.SESSION_SECRET ?? "").length < 16) {
    throw new Error("Refusing to start: SESSION_SECRET must be at least 16 characters.");
  }
}
