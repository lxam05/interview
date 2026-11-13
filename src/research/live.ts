import { enabledAdapters, type Env } from "./adapters";
import { guardedFetchPage } from "./fetch-guard";
import { createAnthropicExtractor } from "./llm/anthropic";
import { createRetriever } from "./retrieve";
import type { RunDeps } from "./run";

/** The real dependencies for a research run, built from the environment. */
export function liveDeps(env: Env): RunDeps {
  const max = Number(env.RESEARCH_MAX_COST_USD);
  return {
    adapters: enabledAdapters(env),
    adapterContext: { fetch, env },
    retriever: createRetriever(guardedFetchPage),
    llm: env.ANTHROPIC_API_KEY ? createAnthropicExtractor({ model: env.EXTRACTION_MODEL }) : null,
    defaultMaxCostUsd: Number.isFinite(max) && max > 0 ? max : 2,
  };
}
