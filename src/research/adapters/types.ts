import { errors, ResearchError } from "../errors";
import type { Candidate } from "../types";

export type Env = Record<string, string | undefined>;

export interface AdapterContext {
  fetch: typeof fetch;
  env: Env;
}

/**
 * A place research can look for sources. The whole interface is one method:
 * give it a query, get candidates back. Everything about the source's API
 * (URLs, auth, response shape) stays inside the adapter.
 */
export interface SourceAdapter {
  name: string;
  /** "web" adapters take natural-language queries, "keyword" ones short terms. */
  kind: "web" | "keyword";
  /** Rough price of one search call, for dry runs and budgets. */
  costPerCallUsd: number;
  enabled(env: Env): boolean;
  search(query: string, ctx: AdapterContext): Promise<Candidate[]>;
}

const TIMEOUT_MS = 15_000;

/** GET/POST JSON with a timeout, mapping failures to named research errors. */
export async function fetchJson(
  ctx: AdapterContext,
  adapter: string,
  query: string,
  url: string,
  init: RequestInit = {},
  keyEnvVar?: string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    if (cause instanceof ResearchError) throw cause;
    throw errors.adapterTimeout(adapter, query);
  }
  if (res.status === 401 || (res.status === 403 && keyEnvVar && !isRateLimit(res))) {
    throw errors.adapterAuth(adapter, keyEnvVar ?? "the API key");
  }
  if (res.status === 429 || isRateLimit(res)) throw errors.adapterRateLimited(adapter);
  if (!res.ok) throw errors.adapterSchema(adapter, `HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw errors.adapterSchema(adapter, "response was not JSON");
  }
}

function isRateLimit(res: Response): boolean {
  return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
}

/** Strip tags and decode the handful of entities API text fields contain. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .trim();
}
