import { z } from "zod";
import { errors } from "../errors";
import type { Candidate } from "../types";
import { fetchJson, type SourceAdapter } from "./types";

const searchSchema = z.object({
  items: z.array(
    z.object({
      full_name: z.string(),
      html_url: z.string().url(),
      description: z.string().nullable(),
      pushed_at: z.string().nullable(),
      license: z.object({ spdx_id: z.string().nullable() }).nullable(),
    }),
  ),
});

const MAX_REPOS = 3;

/**
 * GitHub repository search (official REST API). Works without a key at a low
 * rate limit; GITHUB_TOKEN raises it. Returns each repo's README as the text,
 * with the repo's licence recorded as the reuse note.
 */
export const githubAdapter: SourceAdapter = {
  name: "github",
  kind: "keyword",
  costPerCallUsd: 0,
  enabled: () => true,
  async search(query, ctx) {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "interview-prep-research",
    };
    if (ctx.env.GITHUB_TOKEN) headers.authorization = `Bearer ${ctx.env.GITHUB_TOKEN}`;

    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
      `${query} in:name,description,readme`,
    )}&per_page=${MAX_REPOS}`;
    const parsed = searchSchema.safeParse(
      await fetchJson(ctx, "github", query, url, { headers }, "GITHUB_TOKEN"),
    );
    if (!parsed.success) throw errors.adapterSchema("github", "search result shape changed");

    const out: Candidate[] = [];
    for (const repo of parsed.data.items) {
      let text: string | undefined;
      try {
        const res = await ctx.fetch(`https://api.github.com/repos/${repo.full_name}/readme`, {
          headers: { ...headers, accept: "application/vnd.github.raw" },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) text = await res.text();
      } catch {
        // README unavailable: keep the candidate, it is recorded without text.
      }
      out.push({
        url: repo.html_url,
        title: repo.full_name,
        snippet: repo.description,
        platform: "github",
        publishedAt: repo.pushed_at ? new Date(repo.pushed_at) : null,
        text,
        reuseNote: repo.license?.spdx_id
          ? `Repository licence: ${repo.license.spdx_id}`
          : "No licence stated; quote briefly and link",
      });
    }
    return out;
  },
};
