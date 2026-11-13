import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { BriefContent } from "@/briefs/content";
import { citedClaimIds } from "@/briefs/content";
import type { Db } from "@/db/client";
import {
  briefs,
  briefVersionClaims,
  briefVersions,
  claims,
  claimTopics,
  companies,
  companyAliases,
  locations,
  programmes,
  researchQueries,
  researchRunEvents,
  researchRuns,
  researchRunSources,
  resources,
  roles,
  sourceDocuments,
  sources,
  topics,
  usageEvents,
} from "@/db/schema";
import type { ClaimStatus, RunStatus, SourceStatus } from "@/domain/constants";
import { canonicalUrl, groupDuplicates, nameKey, slugify } from "./dedupe";
import { errors } from "./errors";
import { contentHash } from "./retrieve";
import { QUERY_CACHE_DAYS, RUN_STALE_AFTER_MINUTES } from "./thresholds";
import type { Candidate, EvidenceClaim, ExtractedClaim, ResearchInput, Usage } from "./types";

/*
 * The only module that reads or writes research data. Stage functions work on
 * plain values; run.ts calls them and calls this to persist the results.
 */

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// ── Companies and programmes ────────────────────────────────────────────────

export async function listCompanies(db: Db) {
  return db.select().from(companies).orderBy(companies.name);
}

export async function findCompany(db: Db, name: string) {
  const key = nameKey(name);
  const all = await db.select().from(companies);
  const direct = all.find((c) => c.slug === slugify(name) || nameKey(c.name) === key);
  if (direct) return direct;
  const aliases = await db.select().from(companyAliases);
  const hit = aliases.find((a) => nameKey(a.alias) === key);
  return hit ? (all.find((c) => c.id === hit.companyId) ?? null) : null;
}

export async function upsertCompany(
  db: Db,
  input: { name: string; aliases?: string[]; website?: string | null; isSynthetic?: boolean },
) {
  const existing = await findCompany(db, input.name);
  const company =
    existing ??
    (
      await db
        .insert(companies)
        .values({
          slug: slugify(input.name),
          name: input.name,
          website: input.website ?? null,
          isSynthetic: input.isSynthetic ?? false,
        })
        .returning()
    )[0];
  for (const alias of input.aliases ?? []) {
    if (!alias.trim()) continue;
    await db
      .insert(companyAliases)
      .values({ companyId: company.id, alias: alias.trim() })
      .onConflictDoNothing();
  }
  return company;
}

export async function ensureProgramme(
  db: Db,
  input: {
    companyId: number;
    roleSlug?: string;
    locationSlug?: string | null;
    cycle?: string | null;
    isSynthetic?: boolean;
  },
) {
  const roleSlug = input.roleSlug ?? "software-engineering-intern";
  const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
  if (!role) throw errors.programmeNotFound(String(input.companyId), roleSlug);
  const location = input.locationSlug
    ? (await db.select().from(locations).where(eq(locations.slug, input.locationSlug)))[0]
    : undefined;
  const slug = [role.slug, location?.slug, input.cycle ? slugify(input.cycle) : null]
    .filter(Boolean)
    .join("-");
  const [existing] = await db
    .select()
    .from(programmes)
    .where(and(eq(programmes.companyId, input.companyId), eq(programmes.slug, slug)));
  if (existing) return existing;
  const [created] = await db
    .insert(programmes)
    .values({
      companyId: input.companyId,
      roleId: role.id,
      locationId: location?.id ?? null,
      cycle: input.cycle ?? null,
      slug,
      isSynthetic: input.isSynthetic ?? false,
    })
    .returning();
  return created;
}

/** Everything a run needs to know about its programme. */
export async function loadResearchInput(db: Db, programmeId: number): Promise<ResearchInput> {
  const [row] = await db
    .select({ company: companies, role: roles, location: locations, programme: programmes })
    .from(programmes)
    .innerJoin(companies, eq(companies.id, programmes.companyId))
    .innerJoin(roles, eq(roles.id, programmes.roleId))
    .leftJoin(locations, eq(locations.id, programmes.locationId))
    .where(eq(programmes.id, programmeId));
  if (!row) throw errors.programmeNotFound(String(programmeId), "any");
  const aliases = await db
    .select()
    .from(companyAliases)
    .where(eq(companyAliases.companyId, row.company.id));
  return {
    company: row.company.name,
    aliases: aliases.map((a) => a.alias),
    role: row.role.name,
    location: row.location?.name ?? null,
    cycle: row.programme.cycle,
    officialUrls: row.company.website ? [row.company.website] : [],
  };
}

// ── Runs ────────────────────────────────────────────────────────────────────

export async function queueRun(
  db: Db,
  input: {
    programmeId: number;
    requestedBy?: string;
    maxCostUsd?: number | null;
    isSynthetic?: boolean;
  },
) {
  try {
    const [run] = await db
      .insert(researchRuns)
      .values({
        programmeId: input.programmeId,
        requestedBy: input.requestedBy ?? "cli",
        maxCostUsd: input.maxCostUsd != null ? String(input.maxCostUsd) : null,
        isSynthetic: input.isSynthetic ?? false,
      })
      .returning();
    return run;
  } catch (err) {
    if (isUniqueViolation(err)) throw errors.runActive(input.programmeId);
    throw err;
  }
}

export async function getRun(db: Db, runId: number) {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw errors.runNotFound(runId);
  return run;
}

/** The oldest queued run, if any. Taking it is done by claimRun, which is atomic. */
export async function nextQueuedRunId(db: Db): Promise<number | null> {
  const [row] = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(eq(researchRuns.status, "queued"))
    .orderBy(researchRuns.queuedAt, researchRuns.id)
    .limit(1);
  return row?.id ?? null;
}

/**
 * Take one specific queued run. The update only matches while the run is
 * still queued, so with two workers exactly one gets true.
 */
export async function claimRun(db: Db, runId: number): Promise<boolean> {
  const rows = await db
    .update(researchRuns)
    .set({ status: "running", startedAt: new Date(), heartbeatAt: new Date() })
    .where(and(eq(researchRuns.id, runId), eq(researchRuns.status, "queued")))
    .returning({ id: researchRuns.id });
  return rows.length === 1;
}

/** Put a finished run back in the queue so it can be continued. */
export async function requeueRun(db: Db, runId: number, maxCostUsd?: number | null) {
  const run = await getRun(db, runId);
  if (run.status === "queued" || run.status === "running") return run;
  try {
    const [updated] = await db
      .update(researchRuns)
      .set({
        status: "queued",
        error: null,
        finishedAt: null,
        ...(maxCostUsd != null ? { maxCostUsd: String(maxCostUsd) } : {}),
      })
      .where(eq(researchRuns.id, runId))
      .returning();
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw errors.runActive(run.programmeId);
    throw err;
  }
}

export async function heartbeat(db: Db, runId: number) {
  await db.update(researchRuns).set({ heartbeatAt: new Date() }).where(eq(researchRuns.id, runId));
}

export async function finishRun(
  db: Db,
  runId: number,
  result: { status: Exclude<RunStatus, "queued" | "running">; stats: Record<string, number>; costUsd: number; error?: string | null },
) {
  await db
    .update(researchRuns)
    .set({
      status: result.status,
      stats: result.stats,
      costUsd: result.costUsd.toFixed(4),
      error: result.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(researchRuns.id, runId));
}

/** Mark runs whose worker died. Returns the ids that were failed. */
export async function failStaleRuns(db: Db, now = new Date()): Promise<number[]> {
  const cutoff = new Date(now.getTime() - RUN_STALE_AFTER_MINUTES * 60_000);
  const rows = await db
    .update(researchRuns)
    .set({ status: "failed", error: "RESEARCH_RUN_STALE", finishedAt: now })
    .where(and(eq(researchRuns.status, "running"), lt(researchRuns.heartbeatAt, cutoff)))
    .returning({ id: researchRuns.id });
  return rows.map((r) => r.id);
}

export async function recordEvent(
  db: Db,
  event: {
    runId: number;
    stage: string;
    outcome: string;
    sourceId?: number | null;
    errorCode?: string | null;
    message?: string | null;
    durationMs?: number | null;
  },
) {
  await db.insert(researchRunEvents).values(event);
}

export async function recordUsage(
  db: Db,
  input: { runId: number | null; provider: string; kind: string; usage: Usage },
) {
  await db.insert(usageEvents).values({
    runId: input.runId,
    provider: input.provider,
    kind: input.kind,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    costUsd: input.usage.costUsd.toFixed(6),
  });
}

// ── Queries and sources ─────────────────────────────────────────────────────

export async function queryIsFresh(db: Db, adapter: string, query: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(researchQueries)
    .where(and(eq(researchQueries.adapter, adapter), eq(researchQueries.query, query)));
  if (!row) return false;
  return now.getTime() - row.ranAt.getTime() < QUERY_CACHE_DAYS * 86_400_000;
}

export async function markQuery(db: Db, adapter: string, query: string, resultCount: number) {
  await db
    .insert(researchQueries)
    .values({ adapter, query, resultCount })
    .onConflictDoUpdate({
      target: [researchQueries.adapter, researchQueries.query],
      set: { resultCount, ranAt: new Date() },
    });
}

/** Store a discovered source once (by canonical address) and link it to the run. */
export async function upsertSource(
  db: Db,
  candidate: Candidate,
  opts: { runId?: number; isSynthetic?: boolean } = {},
) {
  const url = canonicalUrl(candidate.url);
  await db
    .insert(sources)
    .values({
      canonicalUrl: url,
      platform: candidate.platform,
      title: candidate.title,
      author: candidate.author ?? null,
      publishedAt: candidate.publishedAt ?? null,
      reuseNote: candidate.reuseNote ?? null,
      isSynthetic: opts.isSynthetic ?? false,
    })
    .onConflictDoNothing();
  const [source] = await db.select().from(sources).where(eq(sources.canonicalUrl, url));
  if (opts.runId) {
    await db
      .insert(researchRunSources)
      .values({ runId: opts.runId, sourceId: source.id })
      .onConflictDoNothing();
  }
  return source;
}

/** Sources earlier runs found for the same programme, so cached searches still count. */
export async function linkKnownSources(db: Db, runId: number, programmeId: number) {
  const earlier = await db
    .selectDistinct({ sourceId: researchRunSources.sourceId })
    .from(researchRunSources)
    .innerJoin(researchRuns, eq(researchRuns.id, researchRunSources.runId))
    .where(eq(researchRuns.programmeId, programmeId));
  if (earlier.length) {
    await db
      .insert(researchRunSources)
      .values(earlier.map((e) => ({ runId, sourceId: e.sourceId })))
      .onConflictDoNothing();
  }
}

export async function runSources(db: Db, runId: number) {
  return db
    .select({ source: sources })
    .from(researchRunSources)
    .innerJoin(sources, eq(sources.id, researchRunSources.sourceId))
    .where(eq(researchRunSources.runId, runId))
    .orderBy(sources.id)
    .then((rows) => rows.map((r) => r.source));
}

export async function setSourceStatus(
  db: Db,
  sourceId: number,
  status: SourceStatus,
  reason?: string | null,
  patch: { title?: string | null; publishedAt?: Date | null } = {},
) {
  await db
    .update(sources)
    .set({
      status,
      statusReason: reason ?? null,
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.publishedAt ? { publishedAt: patch.publishedAt } : {}),
    })
    .where(eq(sources.id, sourceId));
}

/** Save a retrieved version. An unchanged page does not create a new row. */
export async function saveDocument(db: Db, sourceId: number, text: string, truncated: boolean) {
  const hash = contentHash(text);
  const inserted = await db
    .insert(sourceDocuments)
    .values({ sourceId, contentHash: hash, text, truncated })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { document: inserted[0], isNew: true };
  const [existing] = await db
    .select()
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.sourceId, sourceId), eq(sourceDocuments.contentHash, hash)));
  return { document: existing, isNew: false };
}

export async function latestDocument(db: Db, sourceId: number) {
  const [doc] = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.sourceId, sourceId))
    .orderBy(desc(sourceDocuments.retrievedAt), desc(sourceDocuments.id))
    .limit(1);
  return doc ?? null;
}

// ── Claims ──────────────────────────────────────────────────────────────────

/** True when this document was already extracted for this programme by this extractor. */
export async function documentAlreadyExtracted(
  db: Db,
  documentId: number,
  programmeId: number,
  extractorVersion: string,
) {
  const events = await db
    .select({ id: researchRunEvents.id })
    .from(researchRunEvents)
    .innerJoin(researchRuns, eq(researchRuns.id, researchRunEvents.runId))
    .where(
      and(
        eq(researchRuns.programmeId, programmeId),
        eq(researchRunEvents.stage, "extract"),
        eq(researchRunEvents.outcome, "ok"),
        eq(researchRunEvents.message, `document:${documentId}:${extractorVersion}`),
      ),
    )
    .limit(1);
  return events.length > 0;
}

export async function saveClaims(
  db: Db,
  input: {
    documentId: number;
    programmeId: number;
    runId: number | null;
    claims: ExtractedClaim[];
    extractorVersion: string;
    model: string;
    status?: ClaimStatus;
    isSynthetic?: boolean;
  },
): Promise<number[]> {
  if (!input.claims.length) return [];
  const topicRows = await db.select().from(topics);
  const topicId = new Map(topicRows.map((t) => [t.slug, t.id]));
  const ids: number[] = [];
  await db.transaction(async (tx) => {
    for (const c of input.claims) {
      const [row] = await tx
        .insert(claims)
        .values({
          sourceDocumentId: input.documentId,
          programmeId: input.programmeId,
          runId: input.runId,
          type: c.type,
          statement: c.statement,
          quote: c.quote,
          stage: c.stage,
          roleLevel: c.roleLevel,
          region: c.region,
          firsthand: c.firsthand,
          interviewYear: c.interviewYear,
          interviewMonth: c.interviewMonth,
          durationMinutes: c.durationMinutes,
          status: input.status ?? "extracted",
          extractorVersion: input.extractorVersion,
          model: input.model,
          isSynthetic: input.isSynthetic ?? false,
          reviewedAt: input.status === "approved" ? new Date() : null,
        })
        .returning({ id: claims.id });
      ids.push(row.id);
      const links = c.topics
        .map((slug) => topicId.get(slug))
        .filter((id): id is number => id !== undefined)
        .map((id) => ({ claimId: row.id, topicId: id }));
      if (links.length) await tx.insert(claimTopics).values(links);
    }
  });
  return ids;
}

/**
 * Claims for a programme as plain values for evaluation and ranking.
 * Documents that are copies of each other share one `sourceKey`, so a
 * reposted report counts as one independent source.
 */
export async function loadEvidenceClaims(
  db: Db,
  programmeId: number,
  statuses: ClaimStatus[],
): Promise<EvidenceClaim[]> {
  const rows = await db
    .select({ claim: claims, document: sourceDocuments, source: sources })
    .from(claims)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, claims.sourceDocumentId))
    .innerJoin(sources, eq(sources.id, sourceDocuments.sourceId))
    .where(and(eq(claims.programmeId, programmeId), inArray(claims.status, statuses)))
    .orderBy(claims.id);
  if (!rows.length) return [];

  const docs = new Map<number, { key: string; text: string }>();
  for (const r of rows) {
    if (!docs.has(r.source.id)) docs.set(r.source.id, { key: String(r.source.id), text: r.document.text });
  }
  const groupOf = groupDuplicates([...docs.values()]);

  const links = await db
    .select({ claimId: claimTopics.claimId, slug: topics.slug })
    .from(claimTopics)
    .innerJoin(topics, eq(topics.id, claimTopics.topicId))
    .where(
      inArray(
        claimTopics.claimId,
        rows.map((r) => r.claim.id),
      ),
    );
  const topicsOf = new Map<number, string[]>();
  for (const l of links) {
    if (!topicsOf.has(l.claimId)) topicsOf.set(l.claimId, []);
    topicsOf.get(l.claimId)!.push(l.slug);
  }

  return rows.map(({ claim, source }) => ({
    id: claim.id,
    type: claim.type,
    statement: claim.statement,
    quote: claim.quote,
    topics: topicsOf.get(claim.id) ?? [],
    stage: claim.stage,
    roleLevel: claim.roleLevel,
    region: claim.region,
    firsthand: claim.firsthand,
    interviewYear: claim.interviewYear,
    interviewMonth: claim.interviewMonth,
    durationMinutes: claim.durationMinutes,
    sourceKey: `source:${groupOf.get(String(source.id))}`,
    platform: source.platform,
    sourcePublishedAt: source.publishedAt,
  }));
}

export async function loadTopicCatalogue(db: Db) {
  const topicRows = await db.select().from(topics);
  const resourceRows = await db
    .select({ slug: topics.slug, title: resources.title, url: resources.url })
    .from(resources)
    .innerJoin(topics, eq(topics.id, resources.topicId))
    .orderBy(resources.id);
  const byTopic = new Map<string, { title: string; url: string }[]>();
  for (const r of resourceRows) {
    if (!byTopic.has(r.slug)) byTopic.set(r.slug, []);
    byTopic.get(r.slug)!.push({ title: r.title, url: r.url });
  }
  return { topicNames: new Map(topicRows.map((t) => [t.slug, t.name])), resources: byTopic };
}

// ── Draft briefs ────────────────────────────────────────────────────────────

/** Save content as a new draft version. Never touches an existing version. */
export async function createDraftVersion(
  db: Db,
  input: { programmeId: number; content: BriefContent; isSynthetic?: boolean },
) {
  return db.transaction(async (tx) => {
    await tx
      .insert(briefs)
      .values({ programmeId: input.programmeId, isSynthetic: input.isSynthetic ?? false })
      .onConflictDoNothing();
    const [brief] = await tx.select().from(briefs).where(eq(briefs.programmeId, input.programmeId));
    const [last] = await tx
      .select({ version: briefVersions.version })
      .from(briefVersions)
      .where(eq(briefVersions.briefId, brief.id))
      .orderBy(desc(briefVersions.version))
      .limit(1);
    const [version] = await tx
      .insert(briefVersions)
      .values({ briefId: brief.id, version: (last?.version ?? 0) + 1, content: input.content })
      .returning();
    const cited = citedClaimIds(input.content);
    if (cited.length) {
      await tx
        .insert(briefVersionClaims)
        .values(cited.map((claimId) => ({ versionId: version.id, claimId })));
    }
    return { brief, version };
  });
}
