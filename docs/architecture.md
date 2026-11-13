# Architecture

One Next.js app and one worker process share a Postgres database.

```
 student ──> Next.js public pages ──> src/briefs/read.ts (cached, published + not synthetic only)
                   │                         │
                   └─ forms ─> src/actions/public.ts ─> src/submissions ──┐
                                                                         ▼
 reviewer ─> /admin ─> src/actions/admin.ts (requireAdmin) ─> src/briefs/publish.ts ─> Postgres
                              │                                                       ▲
                              └─ queue run ─> research_runs ─> npm run research:worker │
                                                                └─> src/research/run.ts ┘
```

- **Public pages** (`src/app/(public)`) read only through `src/briefs/read.ts`, which wraps `src/briefs/public.ts` in `"use cache"` with the `public-briefs` tag. Publishing, unpublishing and adding a company call `updateTag("public-briefs")`, so the next visit sees the change. A lint rule stops public pages importing the database.
- **Review desk** (`src/app/admin`) signs in with one `ADMIN_PASSWORD`. The session is a signed, httpOnly cookie valid for 12 hours. `src/proxy.ts` only redirects signed-out visitors; `requireAdmin()` in every page and action is the real check. Server actions reject requests from other origins.
- **Research** runs outside the web process. The review desk and CLI insert a `queued` row; the worker claims it atomically, sends heartbeats, and runs `executeRun`. See [pipeline.md](pipeline.md).
- **One owner per state.** Only `run.ts` changes a run's status; only `publish.ts` changes a brief version's status; only `store.ts` reads and writes research data.
- **Synthetic data** (fixtures, the demo) carries `is_synthetic` on companies, programmes, sources, claims and briefs. Every public query filters it out.

## Rendering

Cache Components is on. Pages prerender a static shell; anything reading the request, the clock or the database sits behind `<Suspense>` and calls `connection()` first, so builds never touch the database.

## Known limits

- The e2e test covers research with recorded fixtures, not live adapters.
- No real research has run yet: the live evidence check (slice 3) needs `ANTHROPIC_API_KEY` and a web search key. Until then the public site has no briefs except those built from student reports.
- Extraction accuracy on real documents is unmeasured. The plan is to hand-label about 20 documents in the first live run.
- Reddit is not implemented (needs an approved API app); Glassdoor is excluded by its terms. See [sources.md](sources.md).
- One admin password, no per-reviewer accounts or audit by person (the `reviews` table logs actions, not who).
- Refresh is manual: queue a new run. There is no scheduler.
- The rate limiter and IP hashes live in Postgres; fine for low traffic, not for an attack.
