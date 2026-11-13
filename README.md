# Interview prep for Irish internships

A student searches a company and gets a short, sourced brief: what to study,
what the interview looks like, and how strong the evidence is for each point.
Every claim keeps the exact words it came from, a person approves every claim
and every brief, and nothing is published automatically.

## Quick start (no keys, no database)

Needs Node 22 or newer (`.nvmrc` names the LTS line; Node 23 works but is not an LTS release).

```bash
npm install
npm run demo
```

`npm run demo` runs the whole pipeline (quote check, de-duplication, evidence
labels, ranking) on invented fixtures in an in-memory database and prints a
brief. Real output, trimmed:

```
SYNTHETIC DEMO DATA: this company and every document below are invented.

Northwind Labs (synthetic): Software Engineering Intern, Dublin

WHAT SHOULD I STUDY?

1. Online assessment format  [Officially confirmed]
   Why: The employer's own recruitment material mentions online assessment format in the online assessment.
   Evidence: "Every applicant who meets the eligibility criteria is invited to complete an online coding assessment."
...
3. Algorithms  [Multiple independent reports]
   Why: 2 separate candidate reports of this internship in Ireland mention algorithms in the online assessment and technical interview, most recently in 2026.

Run: succeeded. 7 documents, 19 claims kept, 1 dropped (quote not in source), 1 irrelevant document, cost $0.00, 1.6s.
```

## Running the site

Needs Postgres 17 on `localhost:5432` (`brew install postgresql@17`; see
[docs/runbook.md](docs/runbook.md) if Homebrew cannot start it as a service).

```bash
npm run setup      # creates .env, the databases, runs migrations; safe to re-run
npm run dev        # http://localhost:3000, review desk at /admin
npm run research:worker   # carries out research runs queued from /admin
```

`npm run setup` writes a random local `ADMIN_PASSWORD` into `.env`; open the
file to read it. Real research needs `ANTHROPIC_API_KEY` and, for web search,
`TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY`. Without them, discovery through
GitHub and Hacker News still runs but no claims are extracted.

## Commands

| Command | What it does |
|---|---|
| `npm run demo` | Sample brief from synthetic fixtures. No keys, no Postgres. |
| `npm run setup` | One-time local setup. Never prompts. |
| `npm run dev` / `build` / `start` | The website. |
| `npm run research -- --company "<name>"` | Queue and run research for one internship. `--help` for options, `--dry-run` to see queries without paying. |
| `npm run research:inspect -- --list` | Read-only view of runs, sources and claims. |
| `npm run research:worker` | Carries out queued runs; also deletes 30-day-old IP hashes. |
| `npm run db:migrate` | Applies migrations and reference data. |
| `npm test` | Unit and integration tests on in-memory Postgres (PGlite). |
| `npm run test:pg` | Concurrency tests on real Postgres (`TEST_DATABASE_URL`). |
| `npm run typecheck` / `lint` | Static checks. |

## Documentation

- [Architecture](docs/architecture.md): how the pieces fit, and known limits
- [Pipeline](docs/pipeline.md): research stages, models and cost
- [Sources](docs/sources.md): what we collect from where, and what we never touch
- [Schema](docs/schema.md): tables and the rules they enforce
- [Errors](docs/errors.md): every error code and its fix
- [Runbook](docs/runbook.md): operating it day to day
- [Deployment](docs/deployment.md): hosting, secrets and smoke checks
- [Validation](docs/validation.md): how to test whether students find it useful
