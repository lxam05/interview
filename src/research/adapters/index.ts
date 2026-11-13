import { githubAdapter } from "./github";
import { hackerNewsAdapter } from "./hackernews";
import type { Env, SourceAdapter } from "./types";
import { braveAdapter, tavilyAdapter } from "./websearch";

export const ALL_ADAPTERS: SourceAdapter[] = [
  tavilyAdapter,
  braveAdapter,
  githubAdapter,
  hackerNewsAdapter,
];

/** Adapters that can run with the keys present. */
export function enabledAdapters(env: Env): SourceAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.enabled(env));
}

export type { AdapterContext, Env, SourceAdapter } from "./types";
