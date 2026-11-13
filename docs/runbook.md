# Runbook

## Daily review

1. Open `/admin`. "Waiting for you" lists what needs a person.
2. **Error reports**: removal requests first. To fix a brief, reject the claim behind it (the published brief is flagged), then build and publish a new draft.
3. **Student reports**: check it reads as a real interview, remove names of other people, choose the internship, approve. Then build a new draft for that internship.
4. **Claims**: on an internship's page each claim sits beside its source text with the quote highlighted. Approve, reword or reject.
5. **Drafts**: read the version page, reword explanations if needed, save, then publish. If it says claims are no longer approved, build a new draft.

## Research

- Queue from an internship's page or `npm run research -- --company "<name>" --queue`.
- `npm run research:worker` must be running to carry runs out (`--once` to drain the queue and exit).
- Keys live in the macOS Keychain through Keysmith; `.env` only holds `keysmith://` placeholders. Run anything that needs them through Keysmith: `keysmith run -- npm run research:worker`, `keysmith run -- npm run research -- --company "<name>"`. Without `keysmith run` the placeholders count as unset.
- Connected: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `GITHUB_TOKEN` (read-only). Check with Keysmith's status, never by printing values.
- Start with `--dry-run`, and keep `--max-cost` low. The first real run (Workday, Dublin) cost $0.065 for 29 sources and 33 claims.
- A run page lists every source with its status, every skipped source with its error code, and the cost.

## Error codes

Each code has a fix in [errors.md](errors.md). The most common:

- `RESEARCH_LLM_KEY_MISSING`: the worker has no `ANTHROPIC_API_KEY`.
- `RESEARCH_ADAPTER_RATE_LIMITED` on GitHub: add `GITHUB_TOKEN` or wait an hour.
- `RESEARCH_RUN_STALE`: the worker died mid-run; restart it and continue with `--run <id>`.

## Privacy housekeeping

The worker deletes IP hashes and rate-limit rows older than 30 days once an hour. If no worker runs, nothing is deleted, so keep one running in production.

## Postgres will not start

On some Macs Homebrew's `postgresql@17` has no service file, so `brew services start` fails. Start it by hand:

```bash
export LC_ALL=en_US.UTF-8
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /opt/homebrew/var/postgresql@17 -l /opt/homebrew/var/log/postgresql@17.log start
```

If `initdb` cannot find `postgres.bki`, link the support files first:

```bash
ln -s /opt/homebrew/opt/postgresql@17/share/postgresql /opt/homebrew/share/postgresql@17
ln -s /opt/homebrew/opt/postgresql@17/lib/postgresql /opt/homebrew/lib/postgresql@17
```

Started this way, Postgres does not restart after a reboot; run the `pg_ctl` line again.

## Health

`GET /api/health` returns `{"ok":true,"database":"up"}` or 503. Logs are JSON lines with an `event` field and, for research, the run id.
