import type { Db } from "@/db/client";
import { log } from "@/lib/log";
import type { AdapterContext, SourceAdapter } from "./adapters";
import { errors, ResearchError } from "./errors";
import { extractClaims, EXTRACTOR_VERSION, type ExtractionLlm } from "./extract";
import { buildKeywordQueries, buildQueries } from "./queries";
import type { Retriever } from "./retrieve";
import * as store from "./store";
import { EXTRACTION_CONCURRENCY } from "./thresholds";
import type { Candidate } from "./types";

export interface RunDeps {
  adapters: SourceAdapter[];
  adapterContext: AdapterContext;
  retriever: Retriever;
  /** null when no model key is configured: discovery and retrieval still run. */
  llm: ExtractionLlm | null;
  /** Extra candidates to include (employer pages, fixtures). */
  extraCandidates?: Candidate[];
  defaultMaxCostUsd?: number;
  now?: () => Date;
}

export interface RunSummary {
  runId: number;
  status: "succeeded" | "partial" | "failed";
  stats: Record<string, number>;
  costUsd: number;
  problems: { code: string; message: string }[];
}

/*
 * One research run, start to finish. The worker, the CLI and the demo all
 * call this and nothing else changes a run's status.
 *
 *   queued ──claim──> running ──> succeeded   every source handled
 *                        │──────> partial     some sources or adapters failed,
 *                        │                    budget reached, or no model key
 *                        └──────> failed      unexpected error (trace written)
 *
 * Re-running is safe: sources are stored once, unchanged pages make no new
 * document, and a document already extracted for this programme is skipped.
 */
export async function executeRun(db: Db, runId: number, deps: RunDeps): Promise<RunSummary> {
  const claimed = await store.claimRun(db, runId);
  if (!claimed) {
    const run = await store.getRun(db, runId);
    throw errors.runActive(run.programmeId);
  }
  const run = await store.getRun(db, runId);
  const input = await store.loadResearchInput(db, run.programmeId);
  const maxCost = run.maxCostUsd != null ? Number(run.maxCostUsd) : (deps.defaultMaxCostUsd ?? null);

  const stats: Record<string, number> = {
    queries: 0,
    queriesCached: 0,
    sources: 0,
    documents: 0,
    documentsFailed: 0,
    documentsSkipped: 0,
    claims: 0,
    claimsDropped: 0,
    irrelevant: 0,
  };
  const problems: { code: string; message: string }[] = [];
  let costUsd = Number(run.costUsd ?? 0);
  let stage = "discover";

  const note = (err: ResearchError, sourceId?: number) => {
    problems.push({ code: err.code, message: err.message });
    return store.recordEvent(db, {
      runId,
      stage,
      sourceId: sourceId ?? null,
      outcome: "error",
      errorCode: err.code,
      message: err.message,
    });
  };
  const spend = (amount: number) => {
    costUsd += amount;
    if (maxCost != null && costUsd >= maxCost) throw errors.budgetExceeded(runId, costUsd, maxCost);
  };

  try {
    // ── Discover ───────────────────────────────────────────────────────────
    await store.linkKnownSources(db, runId, run.programmeId);
    // Employer pages named on the company count as official sources.
    const extras: Candidate[] = [
      ...(deps.extraCandidates ?? []),
      ...(input.officialUrls ?? []).map(
        (url): Candidate => ({ url, title: null, snippet: null, platform: "official" }),
      ),
    ];
    const pending = new Map<string, Candidate>();
    for (const candidate of extras) {
      const source = await store.upsertSource(db, candidate, { runId, isSynthetic: run.isSynthetic });
      pending.set(source.canonicalUrl, candidate);
    }

    for (const adapter of deps.adapters) {
      const queries = adapter.kind === "web" ? buildQueries(input) : buildKeywordQueries(input);
      for (const query of queries) {
        if (await store.queryIsFresh(db, adapter.name, query, deps.now?.())) {
          stats.queriesCached++;
          continue;
        }
        const started = Date.now();
        try {
          spend(adapter.costPerCallUsd);
          const found = await adapter.search(query, deps.adapterContext);
          stats.queries++;
          await store.markQuery(db, adapter.name, query, found.length);
          for (const candidate of found) {
            try {
              const source = await store.upsertSource(db, candidate, { runId });
              if (candidate.text !== undefined) pending.set(source.canonicalUrl, candidate);
            } catch {
              // A malformed URL from a search result is not worth failing over.
            }
          }
          await store.recordEvent(db, {
            runId,
            stage,
            outcome: "ok",
            message: `${adapter.name}: ${found.length} result(s) for "${query}"`,
            durationMs: Date.now() - started,
          });
        } catch (err) {
          if (!(err instanceof ResearchError)) throw err;
          if (err.code === "RESEARCH_BUDGET_EXCEEDED") throw err;
          await note(err);
          // Auth and schema problems will not fix themselves on the next query.
          if (err.code !== "RESEARCH_ADAPTER_TIMEOUT") break;
        }
      }
      await store.heartbeat(db, runId);
    }

    // ── Retrieve ───────────────────────────────────────────────────────────
    stage = "retrieve";
    const sources = await store.runSources(db, runId);
    stats.sources = sources.length;
    const toExtract: { sourceId: number; documentId: number; text: string }[] = [];

    for (const source of sources) {
      const existing = await store.latestDocument(db, source.id);
      if (existing) {
        toExtract.push({ sourceId: source.id, documentId: existing.id, text: existing.text });
        continue;
      }
      if (source.status === "not_permitted" || source.status === "blocked") continue;
      const started = Date.now();
      try {
        const candidate: Candidate = pending.get(source.canonicalUrl) ?? {
          url: source.canonicalUrl,
          title: source.title,
          snippet: null,
          platform: source.platform,
          publishedAt: source.publishedAt,
        };
        const doc = await deps.retriever.retrieve(candidate);
        const saved = await store.saveDocument(db, source.id, doc.text, doc.truncated);
        await store.setSourceStatus(db, source.id, "retrieved", null, {
          title: doc.title,
          publishedAt: doc.publishedAt,
        });
        toExtract.push({ sourceId: source.id, documentId: saved.document.id, text: doc.text });
        await store.recordEvent(db, {
          runId,
          stage,
          sourceId: source.id,
          outcome: "ok",
          durationMs: Date.now() - started,
        });
      } catch (err) {
        if (!(err instanceof ResearchError)) throw err;
        stats.documentsFailed++;
        const status =
          err.code === "RESEARCH_ROBOTS_DISALLOWED"
            ? "not_permitted"
            : err.code === "RESEARCH_BLOCKED_ADDRESS"
              ? "blocked"
              : err.code === "RESEARCH_FETCH_STATUS" || err.code === "RESEARCH_UNSUPPORTED_CONTENT"
                ? "unavailable"
                : "failed";
        await store.setSourceStatus(db, source.id, status, err.message);
        await note(err, source.id);
      }
      await store.heartbeat(db, runId);
    }
    stats.documents = toExtract.length;

    // ── Extract ────────────────────────────────────────────────────────────
    stage = "extract";
    const todo: typeof toExtract = [];
    for (const item of toExtract) {
      if (await store.documentAlreadyExtracted(db, item.documentId, run.programmeId, EXTRACTOR_VERSION)) {
        stats.documentsSkipped++;
      } else todo.push(item);
    }

    if (todo.length && !deps.llm) {
      await note(errors.llmKeyMissing(todo.length));
    } else if (deps.llm) {
      const llm = deps.llm;
      const sourceById = new Map(sources.map((s) => [s.id, s]));
      let budgetError: ResearchError | null = null;

      const work = async (item: (typeof toExtract)[number]) => {
        if (budgetError) return;
        const source = sourceById.get(item.sourceId)!;
        const started = Date.now();
        try {
          const result = await extractClaims(
            {
              url: source.canonicalUrl,
              platform: source.platform,
              title: source.title,
              publishedAt: source.publishedAt,
              text: item.text,
            },
            input,
            llm,
          );
          await store.recordUsage(db, { runId, provider: "anthropic", kind: "extract", usage: result.usage });
          await store.saveClaims(db, {
            documentId: item.documentId,
            programmeId: run.programmeId,
            runId,
            claims: result.claims,
            extractorVersion: result.extractorVersion,
            model: result.model,
            isSynthetic: run.isSynthetic,
          });
          stats.claims += result.claims.length;
          stats.claimsDropped += result.droppedForQuote;
          if (!result.relevant) stats.irrelevant++;
          await store.recordEvent(db, {
            runId,
            stage,
            sourceId: source.id,
            outcome: "ok",
            message: `document:${item.documentId}:${EXTRACTOR_VERSION}`,
            durationMs: Date.now() - started,
          });
          spend(result.usage.costUsd);
        } catch (err) {
          if (!(err instanceof ResearchError)) throw err;
          if (err.code === "RESEARCH_BUDGET_EXCEEDED") {
            budgetError = err;
            return;
          }
          stats.documentsFailed++;
          await note(err, source.id);
        }
        await store.heartbeat(db, runId);
      };

      // At most EXTRACTION_CONCURRENCY documents in flight.
      const queue = [...todo];
      await Promise.all(
        Array.from({ length: Math.min(EXTRACTION_CONCURRENCY, queue.length) }, async () => {
          for (let item = queue.shift(); item; item = queue.shift()) await work(item);
        }),
      );
      if (budgetError) throw budgetError;
    }

    const status = problems.length ? "partial" : "succeeded";
    await store.finishRun(db, runId, { status, stats, costUsd });
    log("research.run.finished", { runId, status, ...stats, costUsd });
    return { runId, status, stats, costUsd, problems };
  } catch (err) {
    if (err instanceof ResearchError) {
      // A named, expected stop (budget reached): keep what was done.
      await note(err);
      await store.finishRun(db, runId, { status: "partial", stats, costUsd, error: err.code });
      log("research.run.finished", { runId, status: "partial", code: err.code, costUsd });
      return { runId, status: "partial", stats, costUsd, problems };
    }
    await store.finishRun(db, runId, { status: "failed", stats, costUsd, error: "WORKER_UNEXPECTED" });
    await store.recordEvent(db, {
      runId,
      stage,
      outcome: "error",
      errorCode: "WORKER_UNEXPECTED",
      message: err instanceof Error ? err.message : String(err),
    });
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { runId, stage });
  }
}
