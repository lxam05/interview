# Deployment

Not deployed yet. What any host must provide:

- **Node 22+** for `npm run build && npm start`.
- **Postgres 15+** reachable through `DATABASE_URL`.
- **A long-running worker** (`npm run research:worker`) next to the web process, or a scheduled job running `npm run research:worker -- --once` every few minutes. Serverless-only hosts cannot run research by themselves. Hosts that fit: Render, Railway or Fly.io (web service plus worker), or any VM.
- **Secrets:** `ADMIN_PASSWORD` (long and random), `SESSION_SECRET` (32+ random characters), `DATABASE_URL`; for research, `ANTHROPIC_API_KEY` and optionally `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `GITHUB_TOKEN`. The app refuses to start in production without the first three (`src/instrumentation.ts`).
- **HTTPS**: the admin cookie is `Secure` in production.

## Releasing

1. CI must be green (typecheck, lint, tests, build, real-Postgres tests).
2. Run `npm run db:migrate` against production **before** starting the new version. Migrations are additive only, so the old version keeps working while they apply.
3. Deploy web and worker.
4. Smoke checks:
   - `curl -fsS https://<host>/api/health` returns `"database":"up"`.
   - `/` loads and a search for a published company returns it.
   - A published brief page loads with sources.
   - `/admin` redirects to the login page when signed out.
   - The worker log shows `worker.started`.
