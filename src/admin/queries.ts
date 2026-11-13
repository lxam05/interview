import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  briefs,
  briefVersionClaims,
  briefVersions,
  claims,
  claimTopics,
  companies,
  corrections,
  locations,
  programmes,
  researchRunEvents,
  researchRuns,
  researchRunSources,
  roles,
  sourceDocuments,
  sources,
  submissions,
  topics,
  usageEvents,
} from "@/db/schema";

/* Read-only queries for the admin screens. Writes live in publish.ts, submissions and store.ts. */

export const PAGE_SIZE = 25;

export async function overview(db: Db) {
  const [pendingClaims] = await db.select({ n: count() }).from(claims).where(eq(claims.status, "extracted"));
  const [pendingSubs] = await db.select({ n: count() }).from(submissions).where(eq(submissions.status, "pending"));
  const [openCorrections] = await db.select({ n: count() }).from(corrections).where(eq(corrections.status, "open"));
  const [drafts] = await db.select({ n: count() }).from(briefVersions).where(eq(briefVersions.status, "draft"));
  const [flagged] = await db.select({ n: count() }).from(briefs).where(eq(briefs.needsReview, true));
  const [activeRuns] = await db
    .select({ n: count() })
    .from(researchRuns)
    .where(inArray(researchRuns.status, ["queued", "running"]));
  const [spend] = await db
    .select({ usd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .where(sql`${usageEvents.createdAt} > now() - interval '30 days'`);
  return {
    pendingClaims: pendingClaims.n,
    pendingSubmissions: pendingSubs.n,
    openCorrections: openCorrections.n,
    drafts: drafts.n,
    flaggedBriefs: flagged.n,
    activeRuns: activeRuns.n,
    spend30dUsd: Number(spend.usd),
  };
}

/** Every programme with its counts, for the programmes table and selects. */
export async function listProgrammes(db: Db) {
  const rows = await db
    .select({
      id: programmes.id,
      slug: programmes.slug,
      companyId: companies.id,
      companySlug: companies.slug,
      companyName: companies.name,
      role: roles.name,
      location: locations.name,
      isSynthetic: programmes.isSynthetic,
      needsReview: briefs.needsReview,
    })
    .from(programmes)
    .innerJoin(companies, eq(companies.id, programmes.companyId))
    .innerJoin(roles, eq(roles.id, programmes.roleId))
    .leftJoin(locations, eq(locations.id, programmes.locationId))
    .leftJoin(briefs, eq(briefs.programmeId, programmes.id))
    .orderBy(asc(companies.name), asc(programmes.slug));
  const claimCounts = await db
    .select({ programmeId: claims.programmeId, status: claims.status, n: count() })
    .from(claims)
    .groupBy(claims.programmeId, claims.status);
  const versionRows = await db
    .select({ programmeId: briefs.programmeId, status: briefVersions.status, n: count() })
    .from(briefVersions)
    .innerJoin(briefs, eq(briefs.id, briefVersions.briefId))
    .groupBy(briefs.programmeId, briefVersions.status);
  return rows.map((r) => {
    const c = (s: string) => claimCounts.find((x) => x.programmeId === r.id && x.status === s)?.n ?? 0;
    const v = (s: string) => versionRows.find((x) => x.programmeId === r.id && x.status === s)?.n ?? 0;
    return {
      ...r,
      claims: { extracted: c("extracted"), approved: c("approved"), rejected: c("rejected") },
      published: v("published") > 0,
      drafts: v("draft"),
    };
  });
}

export async function getProgramme(db: Db, programmeId: number) {
  const [row] = await db
    .select({
      id: programmes.id,
      slug: programmes.slug,
      companySlug: companies.slug,
      companyName: companies.name,
      role: roles.name,
      location: locations.name,
      isSynthetic: programmes.isSynthetic,
    })
    .from(programmes)
    .innerJoin(companies, eq(companies.id, programmes.companyId))
    .innerJoin(roles, eq(roles.id, programmes.roleId))
    .leftJoin(locations, eq(locations.id, programmes.locationId))
    .where(eq(programmes.id, programmeId));
  return row ?? null;
}

/** Claims for review, grouped by the document they came from, with that document's text. */
export async function claimsForReview(db: Db, programmeId: number) {
  const rows = await db
    .select({ claim: claims, document: sourceDocuments, source: sources })
    .from(claims)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, claims.sourceDocumentId))
    .innerJoin(sources, eq(sources.id, sourceDocuments.sourceId))
    .where(eq(claims.programmeId, programmeId))
    .orderBy(asc(sources.id), asc(claims.id));
  const topicRows = rows.length
    ? await db
        .select({ claimId: claimTopics.claimId, name: topics.name })
        .from(claimTopics)
        .innerJoin(topics, eq(topics.id, claimTopics.topicId))
        .where(
          inArray(
            claimTopics.claimId,
            rows.map((r) => r.claim.id),
          ),
        )
    : [];
  const groups = new Map<
    number,
    {
      document: typeof sourceDocuments.$inferSelect;
      source: typeof sources.$inferSelect;
      claims: (typeof claims.$inferSelect & { topics: string[] })[];
    }
  >();
  for (const r of rows) {
    if (!groups.has(r.document.id)) groups.set(r.document.id, { document: r.document, source: r.source, claims: [] });
    groups.get(r.document.id)!.claims.push({
      ...r.claim,
      topics: topicRows.filter((t) => t.claimId === r.claim.id).map((t) => t.name),
    });
  }
  return [...groups.values()];
}

export async function versionsFor(db: Db, programmeId: number) {
  return db
    .select({
      id: briefVersions.id,
      version: briefVersions.version,
      status: briefVersions.status,
      createdAt: briefVersions.createdAt,
      publishedAt: briefVersions.publishedAt,
      needsReview: briefs.needsReview,
      needsReviewReason: briefs.needsReviewReason,
    })
    .from(briefVersions)
    .innerJoin(briefs, eq(briefs.id, briefVersions.briefId))
    .where(eq(briefs.programmeId, programmeId))
    .orderBy(desc(briefVersions.version));
}

export async function getVersion(db: Db, versionId: number) {
  const [row] = await db
    .select({ version: briefVersions, brief: briefs })
    .from(briefVersions)
    .innerJoin(briefs, eq(briefs.id, briefVersions.briefId))
    .where(eq(briefVersions.id, versionId));
  if (!row) return null;
  const cited = await db
    .select({ claim: claims, source: sources })
    .from(briefVersionClaims)
    .innerJoin(claims, eq(claims.id, briefVersionClaims.claimId))
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, claims.sourceDocumentId))
    .innerJoin(sources, eq(sources.id, sourceDocuments.sourceId))
    .where(eq(briefVersionClaims.versionId, versionId));
  return { ...row, cited };
}

export async function listRuns(db: Db, page = 0) {
  return db
    .select({
      run: researchRuns,
      companyName: companies.name,
      programmeSlug: programmes.slug,
      programmeId: programmes.id,
    })
    .from(researchRuns)
    .innerJoin(programmes, eq(programmes.id, researchRuns.programmeId))
    .innerJoin(companies, eq(companies.id, programmes.companyId))
    .orderBy(desc(researchRuns.id))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);
}

export async function runDetail(db: Db, runId: number) {
  const [row] = await db
    .select({ run: researchRuns, companyName: companies.name, programmeSlug: programmes.slug })
    .from(researchRuns)
    .innerJoin(programmes, eq(programmes.id, researchRuns.programmeId))
    .innerJoin(companies, eq(companies.id, programmes.companyId))
    .where(eq(researchRuns.id, runId));
  if (!row) return null;
  const events = await db
    .select()
    .from(researchRunEvents)
    .where(eq(researchRunEvents.runId, runId))
    .orderBy(asc(researchRunEvents.id));
  const runSources = await db
    .select({ source: sources })
    .from(researchRunSources)
    .innerJoin(sources, eq(sources.id, researchRunSources.sourceId))
    .where(eq(researchRunSources.runId, runId))
    .orderBy(asc(sources.id));
  const usage = await db.select().from(usageEvents).where(eq(usageEvents.runId, runId));
  return { ...row, events, sources: runSources.map((s) => s.source), usage };
}

export async function listSubmissions(db: Db, status: "pending" | "approved" | "rejected" | "removed" = "pending") {
  return db
    .select()
    .from(submissions)
    .where(eq(submissions.status, status))
    .orderBy(desc(submissions.id))
    .limit(PAGE_SIZE);
}

export async function listCorrections(db: Db, status: "open" | "resolved" | "dismissed" = "open") {
  return db
    .select({
      correction: corrections,
      companyName: companies.name,
      companySlug: companies.slug,
      programmeSlug: programmes.slug,
    })
    .from(corrections)
    .leftJoin(programmes, eq(programmes.id, corrections.programmeId))
    .leftJoin(companies, eq(companies.id, programmes.companyId))
    .where(and(eq(corrections.status, status)))
    .orderBy(desc(corrections.id))
    .limit(PAGE_SIZE);
}
