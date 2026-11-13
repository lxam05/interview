# Changelog

## 0.1.0 (2026-11-13)

- Research engine: GitHub, Hacker News, Tavily and Brave adapters; safe fetching with robots.txt; quote-checked extraction with Claude; de-duplication; rule-based evidence labels; deterministic ranking; cost limits; `research`, `inspect`, `worker`, `setup` and `demo` commands.
- Public site: company search with the fill-in-the-blank question, prep pages (ranked topics, interview stages, sources, limitations), insufficient-evidence state, method and privacy pages, report-an-error form.
- Review desk: password sign-in, claims beside their source text, draft editing, publish/unpublish with conflict checks, research runs, student report moderation, error report queue.
- Contributions: anonymous interview reports with consent, honeypot, timing and rate limits; contributor sees their report organised straight away; approved reports become evidence.
- End-to-end test (`npm run test:e2e`): search, report, sign-in, add internship, queue research, worker, claim review, moderation, publish, public brief, error report, unpublish, and phone-width checks.
- Source policy (`src/research/source-policy.ts`): Glassdoor, Indeed, LinkedIn, Taro and people-lookup sites are dropped at discovery and refused by the fetcher (`RESEARCH_SOURCE_EXCLUDED`). Found by the first live run.
- Fixed: review-desk redirects after a claim decision put the outcome message inside the `#anchor`, so the page did not refresh.
- Migration `0001_submission_topics`: topic choices, matched internship and moderator note on submissions.
