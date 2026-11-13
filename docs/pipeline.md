# Research pipeline

`executeRun(db, runId, deps)` in `src/research/run.ts` is the only orchestrator. Stage
logic is plain functions over values; `store.ts` does every read and write.

| Stage | Code | What it does |
|---|---|---|
| Queries | `queries.ts` | Builds search queries from company, aliases, role, location and year. Queries run in the last 14 days are skipped (`research_queries`). |
| Discover | `adapters/` | Each enabled adapter returns candidate URLs. GitHub and Hacker News need no key; Tavily and Brave run only with their key. Employer URLs are added directly. |
| Retrieve | `retrieve.ts`, `fetch-guard.ts` | One request per host at a time with a 1 second gap, robots.txt checked, public http(s) addresses only (checked after DNS and on every redirect), 2 MB and 20 s caps. A changed page becomes a new `source_documents` row. |
| Extract | `extract.ts`, `llm/anthropic.ts` | One Claude call per document returns relevance and claims against a Zod schema. Source text is passed as quoted data with no tools. **Any claim whose quote is not in the stored text is dropped** (`quote.ts` normalises whitespace, quote marks, dashes and case first). At most 3 documents at once. |
| De-duplicate | `dedupe.ts` | Canonical URLs, content hashes and shingle similarity (0.8). Copies of one report count as one source. |
| Label | `evaluate.ts`, `thresholds.ts` | Fixed rules: official, multiple reports (two or more firsthand, independent, Ireland, internship), single report, historical (older than 24 months), international (other country or graduate role), unverified, insufficient. |
| Rank and draft | `synthesise.ts`, `briefs/publish.ts` | Strongest label first, then most recent, then number of reports. Writes a **draft**; a person publishes it. |

## Models and cost

- Extraction: `EXTRACTION_MODEL` (default `claude-haiku-5-5`). Rationale sentences: `RATIONALE_MODEL` (default `claude-opus-5-5`); without a key a template sentence is used, and no model output can add a topic or fact.
- Every call is recorded in `usage_events` with tokens and cost. Prices live in `src/research/llm/anthropic.ts`; check them against current Anthropic pricing when you change models.
- `--dry-run` prints queries and an estimate without calling anything; `--max-cost` (default `RESEARCH_MAX_COST_USD`, 2) stops a run that would exceed it.
- Every claim stores the extractor prompt version and model id, so a prompt change can be traced and re-run.
