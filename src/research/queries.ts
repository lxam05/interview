import type { ResearchInput } from "./types";

/**
 * Search queries for one programme. Variations cover the company's other
 * names, how people title interview write-ups, and Irish locations. Kept
 * small on purpose: every query costs an API call.
 */
export function buildQueries(input: ResearchInput, year = new Date().getFullYear()): string[] {
  const names = [input.company, ...input.aliases].slice(0, 2);
  const place = input.location && !/ireland/i.test(input.location) ? input.location : "Ireland";
  const roleWords = /intern/i.test(input.role) ? input.role : `${input.role} intern`;
  const short = "software engineer intern";

  const queries = new Set<string>();
  for (const name of names) {
    queries.add(`${name} ${roleWords} interview experience ${place}`);
    queries.add(`${name} ${short} interview ${place} ${year}`);
    queries.add(`${name} internship online assessment ${place}`);
    queries.add(`${name} ${short} interview process Ireland`);
  }
  queries.add(`${input.company} interview experience internship`);
  return [...queries].map((q) => q.replace(/\s+/g, " ").trim());
}

/** Queries for sources that only do keyword search (GitHub, Hacker News). */
export function buildKeywordQueries(input: ResearchInput): string[] {
  const out = new Set<string>();
  for (const name of [input.company, ...input.aliases].slice(0, 2)) {
    out.add(`${name} intern interview Ireland`);
    out.add(`${name} internship interview Dublin`);
  }
  return [...out];
}
