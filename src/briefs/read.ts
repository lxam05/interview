import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "@/db/client";
import {
  getPublicBrief,
  listLocations,
  listPublishedProgrammes,
  searchProgrammes,
  type PublicBrief,
  type PublicClaim,
} from "./public";

/*
 * Cached wrappers that public pages call. Everything here is tagged
 * "public-briefs"; publishing, unpublishing and editing a published brief
 * invalidate the tag. Pages call connection() before these so nothing is
 * read from the database at build time.
 */

export const PUBLIC_TAG = "public-briefs";

export type CachedBrief = Omit<PublicBrief, "claims"> & { claims: Record<number, PublicClaim> };

export async function readBrief(companySlug: string, programmeSlug: string): Promise<CachedBrief | null> {
  "use cache";
  cacheTag(PUBLIC_TAG);
  cacheLife("hours");
  const brief = await getPublicBrief(getDb(), companySlug, programmeSlug);
  return brief ? { ...brief, claims: Object.fromEntries(brief.claims) } : null;
}

export async function readSearch(query: string, locationSlug: string) {
  "use cache";
  cacheTag(PUBLIC_TAG);
  cacheLife("minutes");
  return searchProgrammes(getDb(), query, locationSlug || undefined);
}

export async function readPublished() {
  "use cache";
  cacheTag(PUBLIC_TAG);
  cacheLife("hours");
  return listPublishedProgrammes(getDb());
}

export async function readLocations() {
  "use cache";
  cacheLife("days");
  return listLocations(getDb());
}
