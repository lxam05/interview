/*
 * The e2e run gets its own database, port and test-only secrets, so it never
 * touches the development database or real keys.
 */
export const E2E_PORT = 3100;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/interview_e2e";
export const E2E_ADMIN_PASSWORD = "e2e-admin-password-not-secret";
export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  ADMIN_PASSWORD: E2E_ADMIN_PASSWORD,
  SESSION_SECRET: "e2e-session-secret-not-for-production",
  // Research keys are blanked so nothing paid or live can run.
  ANTHROPIC_API_KEY: "",
  TAVILY_API_KEY: "",
  BRAVE_SEARCH_API_KEY: "",
  GITHUB_TOKEN: "",
  LOG_SILENT: "1",
};
