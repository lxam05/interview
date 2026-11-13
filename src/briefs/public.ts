import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  briefs,
  briefVersions,
  claims,
  companies,
  companyAliases,
  locations,
  programmes,
  roles,
  sourceDocuments,
  sources,
} from "@/db/schema";
import type { EvidenceLabel, Region, RoleLevel, SourcePlatform } from "@/domain/constants";
import { briefContentSchema, citedClaimIds, type BriefContent } from "./content";

/*
 * The only way public pages read data. Every query here applies the same
 * rule: published, and never synthetic. Pages import the cached wrappers in
 * ./read.ts, which call these with the shared connection.
 */

export type Coverage = "published" | "not_yet";

export interface SearchResult {
  companySlug: string;
  companyName: string;
  programmes: {
    slug: string;
    role: string;
    location: string | null;
    coverage: Coverage;
    publishedAt: Date | null;
    topLabel: EvidenceLabel | null;
  }[];
}

const MAX_RESULTS = 20;

/** Company search: plain case-insensitive match over names and aliases. */
export async function searchProgrammes(
  db: Db,
  query: string,
  locationSlug?: string,
): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 80);
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const companyRows = await db
    .selectDistinct({ id: companies.id, slug: companies.slug, name: companies.name })
    .from(companies)
    .leftJoin(companyAliases, eq(companyAliases.companyId, companies.id))
    .where(
      and(
        eq(companies.isSynthetic, false),
        q ? or(ilike(companies.name, pattern), ilike(companyAliases.alias, pattern)) : undefined,
      ),
    )
    .orderBy(asc(companies.name))
    .limit(MAX_RESULTS);
  if (!companyRows.length) return [];

  const rows = await db
    .select({
      companyId: programmes.companyId,
      slug: programmes.slug,
      role: roles.name,
      location: locations.name,
      locationSlug: locations.slug,
      publishedAt: briefVersions.publishedAt,
      content: briefVersions.content,
    })
    .from(programmes)
    .innerJoin(roles, eq(roles.id, programmes.roleId))
    .leftJoin(locations, eq(locations.id, programmes.locationId))
    .leftJoin(briefs, and(eq(briefs.programmeId, programmes.id), eq(briefs.isSynthetic, false)))
    .leftJoin(
      briefVersions,
      and(eq(briefVersions.briefId, briefs.id), eq(briefVersions.status, "published")),
    )
    .where(
      and(
        inArray(
          programmes.companyId,
          companyRows.map((c) => c.id),
        ),
        eq(programmes.isSynthetic, false),
        locationSlug ? eq(locations.slug, locationSlug) : undefined,
      ),
    )
    .orderBy(asc(roles.name), asc(locations.name));

  return companyRows
    .map((c) => ({
      companySlug: c.slug,
      companyName: c.name,
      programmes: rows
        .filter((r) => r.companyId === c.id)
        .map((r) => ({
          slug: r.slug,
          role: r.role,
          location: r.location,
          coverage: (r.publishedAt ? "published" : "not_yet") as Coverage,
          publishedAt: r.publishedAt,
          topLabel: r.publishedAt && r.content ? (r.content.topics[0]?.label ?? null) : null,
        })),
    }))
    .filter((c) => c.programmes.length > 0 || !locationSlug)
    .sort(
      (a, b) =>
        Number(b.programmes.some((p) => p.coverage === "published")) -
          Number(a.programmes.some((p) => p.coverage === "published")) ||
        a.companyName.localeCompare(b.companyName),
    );
}

/** Companies with at least one published brief, for the home page. */
export async function listPublishedProgrammes(db: Db, limit = 12) {
  return db
    .select({
      companySlug: companies.slug,
      companyName: companies.name,
      programmeSlug: programmes.slug,
      role: roles.name,
      location: locations.name,
      publishedAt: briefVersions.publishedAt,
    })
    .from(briefVersions)
    .innerJoin(briefs, eq(briefs.id, briefVersions.briefId))
    .innerJoin(programmes, eq(programmes.id, briefs.programmeId))
    .innerJoin(companies, eq(companies.id, programmes.companyId))
    .innerJoin(roles, eq(roles.id, programmes.roleId))
    .leftJoin(locations, eq(locations.id, programmes.locationId))
    .where(
      and(
        eq(briefVersions.status, "published"),
        eq(briefs.isSynthetic, false),
        eq(programmes.isSynthetic, false),
        eq(companies.isSynthetic, false),
      ),
    )
    .orderBy(sql`${briefVersions.publishedAt} desc`)
    .limit(limit);
}

export interface PublicClaim {
  id: number;
  statement: string;
  quote: string;
  roleLevel: RoleLevel;
  region: Region;
  firsthand: boolean | null;
  interviewYear: number | null;
  interviewMonth: number | null;
  source: {
    id: number;
    url: string;
    title: string | null;
    platform: SourcePlatform;
    publishedAt: Date | null;
    retrievedAt: Date;
  };
}

export interface PublicBrief {
  company: { slug: string; name: string; website: string | null };
  programme: { id: number; slug: string; role: string; location: string | null; cycle: string | null };
  /** Null when nothing is published yet: the page shows the insufficient-evidence state. */
  version: { id: number; version: number; publishedAt: Date; content: BriefContent } | null;
  claims: Map<number, PublicClaim>;
  /** Other programmes at the same company, for navigation. */
  siblings: { slug: string; role: string; location: string | null }[];
}

/**
 * Everything the prep page needs, in three queries: the programme, its
 * published version, and the claims that version cites with their sources.
 */
export async function getPublicBrief(
  db: Db,
  companySlug: string,
  programmeSlug: string,
): Promise<PublicBrief | null> {
  const rows = await db
    .select({
      company: companies,
      programme: programmes,
      role: roles.name,
      location: locations.name,
      version: briefVersions,
    })
    .from(programmes)
    .innerJoin(companies, eq(companies.id, programmes.companyId))
    .innerJoin(roles, eq(roles.id, programmes.roleId))
    .leftJoin(locations, eq(locations.id, programmes.locationId))
    .leftJoin(briefs, and(eq(briefs.programmeId, programmes.id), eq(briefs.isSynthetic, false)))
    .leftJoin(
      briefVersions,
      and(eq(briefVersions.briefId, briefs.id), eq(briefVersions.status, "published")),
    )
    .where(
      and(
        eq(companies.slug, companySlug),
        eq(companies.isSynthetic, false),
        eq(programmes.isSynthetic, false),
      ),
    );
  const all = rows.map((r) => ({ ...r }));
  const row = all.find((r) => r.programme.slug === programmeSlug);
  if (!row) return null;

  const siblings = all
    .filter((r) => r.programme.id !== row.programme.id)
    .map((r) => ({ slug: r.programme.slug, role: r.role, location: r.location }));

  const base = {
    company: { slug: row.company.slug, name: row.company.name, website: row.company.website },
    programme: {
      id: row.programme.id,
      slug: row.programme.slug,
      role: row.role,
      location: row.location,
      cycle: row.programme.cycle,
    },
    siblings,
  };
  if (!row.version || !row.version.publishedAt) {
    return { ...base, version: null, claims: new Map() };
  }

  const content = briefContentSchema.parse(row.version.content);
  const ids = citedClaimIds(content);
  const claimRows = ids.length
    ? await db
        .select({ claim: claims, source: sources, document: sourceDocuments })
        .from(claims)
        .innerJoin(sourceDocuments, eq(sourceDocuments.id, claims.sourceDocumentId))
        .innerJoin(sources, eq(sources.id, sourceDocuments.sourceId))
        .where(
          and(
            inArray(claims.id, ids),
            eq(claims.status, "approved"),
            eq(claims.isSynthetic, false),
            eq(sources.isSynthetic, false),
          ),
        )
    : [];

  const publicClaims = new Map<number, PublicClaim>(
    claimRows.map(({ claim, source, document }) => [
      claim.id,
      {
        id: claim.id,
        statement: claim.statement,
        quote: shortQuote(claim.quote),
        roleLevel: claim.roleLevel,
        region: claim.region,
        firsthand: claim.firsthand,
        interviewYear: claim.interviewYear,
        interviewMonth: claim.interviewMonth,
        source: {
          id: source.id,
          url: source.platform === "community" ? "" : source.canonicalUrl,
          title: source.title,
          platform: source.platform,
          publishedAt: source.publishedAt,
          retrievedAt: document.retrievedAt,
        },
      },
    ]),
  );

  return {
    ...base,
    version: {
      id: row.version.id,
      version: row.version.version,
      publishedAt: row.version.publishedAt,
      content,
    },
    claims: publicClaims,
  };
}

/** Public pages show a short quote and a link, never a full copied report. */
export const PUBLIC_QUOTE_MAX = 280;
export function shortQuote(quote: string): string {
  const q = quote.trim();
  if (q.length <= PUBLIC_QUOTE_MAX) return q;
  const cut = q.slice(0, PUBLIC_QUOTE_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), PUBLIC_QUOTE_MAX - 40))}…`;
}

/** Location filter options for search. */
export async function listLocations(db: Db) {
  return db.select({ slug: locations.slug, name: locations.name }).from(locations).orderBy(asc(locations.id));
}
