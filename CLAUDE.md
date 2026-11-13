@AGENTS.md

# Working on this project

Next.js 16 (App Router, Cache Components) + TypeScript + Tailwind 4, Postgres via Drizzle.
Read `node_modules/next/dist/docs/` before using a Next.js API: this version differs from older ones
(`proxy.ts` not middleware, `connection()` before request-time values, `updateTag` in actions).

## Commands
- `npm run demo`: whole pipeline on fixtures, no keys or database
- `npm test` (PGlite, no services) and `npm run test:pg` (real Postgres, run `npm run setup` first)
- `npm run test:e2e`: Playwright journey on port 3100 with its own `interview_e2e` database (reset each run) and test-only secrets; research uses `e2e/fixture-worker.ts`, never the network
- `npm run typecheck`, `npm run lint`, `npm run build`: all must pass before a commit

## Layout
- `src/research/`: pipeline. Stage logic is plain functions; `store.ts` owns all research reads/writes; `run.ts#executeRun` is the only orchestrator and the only writer of run status.
- `src/briefs/`: `content.ts` (brief JSON schema), `publish.ts` (the only writer of brief version status), `public.ts` + `read.ts` (the only way public pages read data).
- `src/submissions/`: student reports and error reports. `src/admin/`: session tokens, admin queries.
- `src/actions/`: server actions. Every admin action calls `requireAdmin()` first.
- `src/app/(public)/`: student pages. `src/app/admin/`: review desk.
- `src/domain/constants.ts`: every closed list (labels, stages, topics). Add values there only.
- `docs/errors.md`: one heading per code in `ERROR_CODES`; a test enforces it.

## Rules
- Never show synthetic data publicly. Fixtures are `is_synthetic`; every public query filters it, and lint blocks `src/app/(public)` from importing the database directly.
- Nothing is published without a person approving it. Synthesis only writes drafts.
- Never read secret values (`.env` keys, Keychain). Read keys from `process.env` in code only.
- Migrations are additive and forward-only (`npm run db:generate`, then commit the SQL).
