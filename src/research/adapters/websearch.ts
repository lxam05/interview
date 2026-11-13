import { z } from "zod";
import { errors } from "../errors";
import type { Candidate } from "../types";
import { fetchJson, type SourceAdapter } from "./types";

const MAX_RESULTS = 6;

const tavilySchema = z.object({
  results: z.array(
    z.object({
      url: z.string().url(),
      title: z.string().nullish(),
      content: z.string().nullish(),
      published_date: z.string().nullish(),
    }),
  ),
});

/** Tavily web search (official API, needs TAVILY_API_KEY). */
export const tavilyAdapter: SourceAdapter = {
  name: "tavily",
  kind: "web",
  costPerCallUsd: 0.008,
  enabled: (env) => Boolean(env.TAVILY_API_KEY),
  async search(query, ctx) {
    const raw = await fetchJson(
      ctx,
      "tavily",
      query,
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ctx.env.TAVILY_API_KEY}`,
        },
        body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: "basic" }),
      },
      "TAVILY_API_KEY",
    );
    const parsed = tavilySchema.safeParse(raw);
    if (!parsed.success) throw errors.adapterSchema("tavily", "search result shape changed");
    return parsed.data.results.map(
      (r): Candidate => ({
        url: r.url,
        title: r.title ?? null,
        snippet: r.content ?? null,
        platform: "web",
        publishedAt: toDate(r.published_date),
      }),
    );
  },
};

const braveSchema = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          url: z.string().url(),
          title: z.string().nullish(),
          description: z.string().nullish(),
          page_age: z.string().nullish(),
        }),
      ),
    })
    .optional(),
});

/** Brave web search (official API, needs BRAVE_SEARCH_API_KEY). */
export const braveAdapter: SourceAdapter = {
  name: "brave",
  kind: "web",
  costPerCallUsd: 0.005,
  enabled: (env) => Boolean(env.BRAVE_SEARCH_API_KEY),
  async search(query, ctx) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
      query,
    )}&count=${MAX_RESULTS}`;
    const raw = await fetchJson(
      ctx,
      "brave",
      query,
      url,
      {
        headers: {
          accept: "application/json",
          "x-subscription-token": ctx.env.BRAVE_SEARCH_API_KEY ?? "",
        },
      },
      "BRAVE_SEARCH_API_KEY",
    );
    const parsed = braveSchema.safeParse(raw);
    if (!parsed.success) throw errors.adapterSchema("brave", "search result shape changed");
    return (parsed.data.web?.results ?? []).map(
      (r): Candidate => ({
        url: r.url,
        title: r.title ?? null,
        snippet: r.description ?? null,
        platform: "web",
        publishedAt: toDate(r.page_age),
      }),
    );
  },
};

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
