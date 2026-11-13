import { z } from "zod";
import { errors } from "../errors";
import type { Candidate } from "../types";
import { fetchJson, htmlToPlain, type SourceAdapter } from "./types";

const schema = z.object({
  hits: z.array(
    z.object({
      objectID: z.string(),
      title: z.string().nullish(),
      story_title: z.string().nullish(),
      url: z.string().nullish(),
      author: z.string().nullish(),
      created_at: z.string().nullish(),
      story_text: z.string().nullish(),
      comment_text: z.string().nullish(),
    }),
  ),
});

/**
 * Hacker News through the public Algolia search API (no key). Comments and
 * text posts come back with their full text, so nothing else is fetched.
 */
export const hackerNewsAdapter: SourceAdapter = {
  name: "hackernews",
  kind: "keyword",
  costPerCallUsd: 0,
  enabled: () => true,
  async search(query, ctx) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
      query,
    )}&tags=(story,comment)&hitsPerPage=5`;
    const parsed = schema.safeParse(await fetchJson(ctx, "hackernews", query, url));
    if (!parsed.success) throw errors.adapterSchema("hackernews", "search result shape changed");

    const out: Candidate[] = [];
    for (const hit of parsed.data.hits) {
      const body = hit.comment_text ?? hit.story_text;
      const title = hit.title ?? hit.story_title ?? null;
      const publishedAt = hit.created_at ? new Date(hit.created_at) : null;
      if (body) {
        out.push({
          url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          title,
          snippet: null,
          platform: "hackernews",
          author: hit.author ?? null,
          publishedAt,
          text: htmlToPlain(body),
          reuseNote: "User comment on Hacker News; quote briefly and link",
        });
      } else if (hit.url) {
        // A link post: the linked page is the source, fetched like any web page.
        out.push({ url: hit.url, title, snippet: null, platform: "web", publishedAt });
      }
    }
    return out;
  },
};
