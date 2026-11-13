import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import robotsParser from "robots-parser";
import { errors, ResearchError } from "./errors";
import { type PageFetcher, USER_AGENT } from "./fetch-guard";
import type { Candidate, SourceDoc } from "./types";

/** Text beyond this is cut for extraction and the document is marked truncated. */
export const MAX_DOC_CHARS = 60_000;
const MIN_DOC_CHARS = 200;

export interface Retriever {
  retrieve(candidate: Candidate): Promise<SourceDoc & { truncated: boolean }>;
}

/**
 * Turns a candidate into text. Candidates that already carry text (API
 * results) are used as they are. Web pages are fetched only when the site's
 * robots.txt allows it, one request at a time per host with a short pause.
 */
export function createRetriever(
  fetchPage: PageFetcher,
  opts: { delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Retriever {
  const delayMs = opts.delayMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const robotsByOrigin = new Map<string, Promise<ReturnType<typeof robotsParser> | null>>();
  const queueByHost = new Map<string, Promise<unknown>>();

  /** Serialise requests per host, with a pause between them. */
  function polite<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = queueByHost.get(host);
    const run = (async () => {
      if (previous) {
        await previous.catch(() => undefined);
        await sleep(delayMs);
      }
      return task();
    })();
    queueByHost.set(host, run);
    return run;
  }

  function robotsFor(url: URL) {
    const origin = url.origin;
    let cached = robotsByOrigin.get(origin);
    if (!cached) {
      cached = polite(url.host, async () => {
        try {
          const page = await fetchPage(`${origin}/robots.txt`);
          // No robots.txt (404) means nothing is disallowed.
          if (page.status >= 400) return null;
          return robotsParser(`${origin}/robots.txt`, page.body);
        } catch (err) {
          if (err instanceof ResearchError && err.code === "RESEARCH_BLOCKED_ADDRESS") throw err;
          return null;
        }
      });
      robotsByOrigin.set(origin, cached);
    }
    return cached;
  }

  return {
    async retrieve(candidate) {
      if (candidate.text !== undefined) {
        return finish(candidate, candidate.title, candidate.publishedAt ?? null, candidate.text);
      }

      const url = new URL(candidate.url);
      const robots = await robotsFor(url);
      if (robots && robots.isAllowed(url.href, USER_AGENT) === false) {
        throw errors.robotsDisallowed(url.href);
      }

      const page = await polite(url.host, () => fetchPage(url.href));
      if (page.status >= 400) throw errors.fetchStatus(url.href, page.status);

      const parsed = /html/i.test(page.contentType)
        ? htmlToArticle(page.body)
        : { title: null, text: page.body, publishedAt: null };
      return finish(
        candidate,
        parsed.title ?? candidate.title,
        candidate.publishedAt ?? parsed.publishedAt,
        parsed.text,
      );
    },
  };
}

function finish(
  candidate: Candidate,
  title: string | null,
  publishedAt: Date | null,
  rawText: string,
): SourceDoc & { truncated: boolean } {
  const text = rawText.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < MIN_DOC_CHARS) {
    throw errors.unsupportedContent(candidate.url, "no readable text on the page");
  }
  const truncated = text.length > MAX_DOC_CHARS;
  return {
    url: candidate.url,
    platform: candidate.platform,
    title,
    publishedAt,
    text: truncated ? text.slice(0, MAX_DOC_CHARS) : text,
    truncated,
  };
}

/** Main article text, title and stated publication date of an HTML page. */
export function htmlToArticle(html: string): {
  title: string | null;
  text: string;
  publishedAt: Date | null;
} {
  const { document } = parseHTML(html);
  const meta = (selector: string) => document.querySelector(selector)?.getAttribute("content");
  const stated =
    meta('meta[property="article:published_time"]') ??
    meta('meta[name="date"]') ??
    document.querySelector("time[datetime]")?.getAttribute("datetime");
  const date = stated ? new Date(stated) : null;
  const publishedAt = date && !Number.isNaN(date.getTime()) ? date : null;

  let title: string | null = document.querySelector("title")?.textContent?.trim() || null;
  let text = "";
  try {
    const article = new Readability(document as unknown as Document).parse();
    if (article?.textContent) {
      text = article.textContent;
      title = article.title?.trim() || title;
    }
  } catch {
    // Fall through to the plain body text.
  }
  if (!text) {
    document.querySelectorAll("script,style,noscript,nav,footer,header").forEach((n) => n.remove());
    text = document.body?.textContent ?? "";
  }
  return { title, text, publishedAt };
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
