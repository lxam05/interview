# Schema

Defined in `src/db/schema.ts`; migrations in `drizzle/` (additive, forward-only). Closed lists
(labels, stages, statuses, topics) come from `src/domain/constants.ts`.

- **Who/what/where:** `companies`, `company_aliases`, `roles`, `locations`, `programmes` (company + role + optional location and cycle; one interview process).
- **Evidence:** `sources` (unique canonical URL), `source_documents` (one row per retrieved version, unique per hash), `claims` (statement, verbatim quote, stage, intern/graduate, Ireland/international, firsthand, year and month, review status, extractor version and model), `topics`, `claim_topics`, `resources`.
- **Published content:** `briefs` (one per programme, `needs_review` flag), `brief_versions` (content is one validated JSON document; `row_version` detects stale screens), `brief_version_claims` (which claims a version cites).
- **Operations:** `research_runs`, `research_run_sources`, `research_run_events`, `research_queries`, `usage_events`, `reviews` (audit log).
- **Community:** `submissions` (reports, with chosen topics and the internship a moderator matched), `corrections`, `rate_limits`.

## Rules the database enforces

- One queued or running run per programme (partial unique index).
- At most one published version per brief (partial unique index).
- Unique canonical URL per source; unique content hash per source document; unique idempotency key per submission.
- Every claim belongs to a source document, so every claim can be traced to text.
