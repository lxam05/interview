/**
 * Copies of one report must count once. Three checks, cheapest first:
 * the same address written differently, the same text, nearly the same text.
 */

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|ref$|ref_src$|source$|mc_cid$|mc_eid$)/i;

/** One spelling for every way of writing the same address. */
export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  url.protocol = "https:";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^(www|m|mobile|amp)\./, "");
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/amp\/?$/, "/").replace(/\/+$/, "") || "/";
  return url.href.replace(/\/$/, "");
}

function shingles(text: string, size = 5): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

/** 0 = nothing in common, 1 = the same text. */
export function textSimilarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  const [small, large] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  let shared = 0;
  for (const s of small) if (large.has(s)) shared++;
  // Containment: a repost quoted inside a longer page still counts as a copy.
  return shared / small.size;
}

export const DUPLICATE_THRESHOLD = 0.8;

export interface DocForDedupe {
  key: string;
  text: string;
}

/**
 * Groups documents that are copies of each other. Returns, for every key,
 * the key of the first document in its group (itself when it is original).
 */
export function groupDuplicates(docs: DocForDedupe[]): Map<string, string> {
  const groupOf = new Map<string, string>();
  const originals: DocForDedupe[] = [];
  for (const doc of docs) {
    const match = originals.find((o) => textSimilarity(o.text, doc.text) >= DUPLICATE_THRESHOLD);
    if (match) groupOf.set(doc.key, match.key);
    else {
      groupOf.set(doc.key, doc.key);
      originals.push(doc);
    }
  }
  return groupOf;
}

/** Lowercase, punctuation-free form for matching company names and aliases. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|ltd|limited|plc|llc|corp|corporation|ireland|group)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
