# Errors

Every error the research engine, worker and CLI report has a stable code and
prints one line: `error[CODE]: what failed. fix: what to do (retry advice; what was written)`.
Env var names are shown; their values never are. Unexpected failures also write
a full trace under `traces/` and print its path.

A test (`test/docs/errors.test.ts`) fails if a code in `src/research/errors.ts` has no heading here.

## RESEARCH_COMPANY_NOT_FOUND
No company matches the name. Run `npm run research -- --list-companies`, or add it with `--add-company "<name>"`. Nothing written.

## RESEARCH_PROGRAMME_NOT_FOUND
The company has no internship for that role and location. Add one in the review desk (Overview, Add an internship) or with `--add-company`. Nothing written.

## RESEARCH_RUN_NOT_FOUND
No run has that id. List runs with `npm run research:inspect -- --list`.

## RESEARCH_RUN_ACTIVE
A run for this internship is already queued or running; only one is allowed at a time. Wait for it, or continue it with `--run <id>`. If it is stuck, the worker marks it failed after 10 minutes without a heartbeat (see RESEARCH_RUN_STALE).

## RESEARCH_BUDGET_EXCEEDED
The run reached its cost limit and stopped. Everything found so far is kept and the run ends `partial`. Continue with `npm run research -- --run <id> --max-cost <higher>`.

## RESEARCH_ADAPTER_TIMEOUT
A search source did not answer in time. The run continues with the other sources and ends `partial`. Safe to retry later.

## RESEARCH_ADAPTER_RATE_LIMITED
A search source refused more requests. GitHub without `GITHUB_TOKEN` allows very few searches an hour; add a token, or retry after the window resets.

## RESEARCH_ADAPTER_AUTH
A search key is missing or rejected. Check `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY` or `GITHUB_TOKEN` is set for the process (with Keysmith: `keysmith run -- <command>`). Needs a person.

## RESEARCH_ADAPTER_SCHEMA
A search API answered in a shape the adapter does not recognise, usually because the API changed. The adapter is skipped for this run. Fix the adapter in `src/research/adapters/` and add a recorded response to its test.

## RESEARCH_ROBOTS_DISALLOWED
The site's robots.txt does not allow fetching the page. It is recorded as `not_permitted` and never fetched. Nothing to retry.

## RESEARCH_FETCH_STATUS
The page answered with an error status (404, 500 and so on). The source is marked `unavailable` or `failed`; a later run tries again.

## RESEARCH_UNSUPPORTED_CONTENT
The page is not text or is larger than the size cap. Skipped. If the content matters, add it as an employer URL that points at an HTML page.

## RESEARCH_BLOCKED_ADDRESS
The URL is not public http(s): it resolves to a private, loopback or link-local address, or uses another scheme. It is never fetched. This protects the server; nothing to retry.

## RESEARCH_SOURCE_EXCLUDED
The site is on the excluded list in `src/research/source-policy.ts`: its terms forbid collection, its terms are not reviewed yet, or it is a people-lookup site. Search results from it are dropped before anything is stored, and the fetcher refuses it. Nothing to retry. See [sources.md](sources.md).

## RESEARCH_LLM_KEY_MISSING
`ANTHROPIC_API_KEY` is not set, so no claims can be extracted. Discovery and retrieval still run and the run ends `partial`. Set the key (with Keysmith: `keysmith run -- npm run research:worker`).

## RESEARCH_LLM_TRANSIENT
The model API was overloaded, rate limited or timed out after retries. The document is left unextracted; re-running picks it up.

## RESEARCH_LLM_REFUSAL
The model declined to process a document. It is skipped and recorded. Look at the source in the run page; usually it is not an interview report.

## RESEARCH_LLM_MALFORMED
The model returned empty or unparseable output. Skipped; re-running retries it.

## RESEARCH_EXTRACTION_SCHEMA
The model's output did not match the extraction schema. Skipped. If it happens often, check the prompt version in `src/research/extract.ts`.

## RESEARCH_RUN_STALE
A running run stopped sending heartbeats (the worker crashed or was stopped) and was marked failed. Its stored results are kept. Continue with `npm run research -- --run <id>`.

## BRIEF_INVALID_TRANSITION
The brief version changed after the screen loaded, or it is not a draft. Reload the version page and decide again. In the review desk this shows as "This draft changed after you opened it" or "only drafts can be approved".

## BRIEF_UNSUPPORTED_TOPIC
A topic in a brief has no approved claim behind it. Build a new draft from the current claims.

## DB_URL_MISSING
`DATABASE_URL` is not set. Run `npm run setup`, which creates `.env`. `npm run demo` needs no database.

## DB_UNREACHABLE
The database did not answer. Check Postgres is running (`pg_isready -h localhost`) and see [the runbook](runbook.md#postgres-will-not-start).

## WORKER_UNEXPECTED
The worker hit an error nobody planned for. The run is marked failed and a trace is written; the path is printed. Read the trace, fix the cause, then continue the run with `--run <id>`.
