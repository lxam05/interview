import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  BRIEF_VERSION_STATUSES,
  CLAIM_STATUSES,
  CLAIM_TYPES,
  CORRECTION_KINDS,
  CORRECTION_STATUSES,
  INTERVIEW_STAGES,
  REGIONS,
  ROLE_LEVELS,
  RUN_STATUSES,
  SOURCE_PLATFORMS,
  SOURCE_STATUSES,
  SUBMISSION_STATUSES,
} from "@/domain/constants";
import type { BriefContent } from "@/briefs/content";

/*
 * How the tables relate:
 *
 *   companies ─< company_aliases
 *       │
 *       └─< programmes >─ roles
 *              │    └──── locations
 *              ├─< research_runs ─< research_run_events
 *              │        └─< research_run_sources >─ sources ─< source_documents
 *              ├─< claims >── source_documents          (every claim keeps its quote)
 *              │      └─< claim_topics >─ topics ─< resources
 *              └── briefs ─< brief_versions ─< brief_version_claims >─ claims
 *
 *   submissions ──(when approved)──> sources   corrections ──> programmes
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const claimTypeEnum = pgEnum("claim_type", CLAIM_TYPES);
export const claimStatusEnum = pgEnum("claim_status", CLAIM_STATUSES);
export const interviewStageEnum = pgEnum("interview_stage", INTERVIEW_STAGES);
export const roleLevelEnum = pgEnum("role_level", ROLE_LEVELS);
export const regionEnum = pgEnum("region", REGIONS);
export const sourcePlatformEnum = pgEnum("source_platform", SOURCE_PLATFORMS);
export const sourceStatusEnum = pgEnum("source_status", SOURCE_STATUSES);
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const briefVersionStatusEnum = pgEnum(
  "brief_version_status",
  BRIEF_VERSION_STATUSES,
);
export const submissionStatusEnum = pgEnum("submission_status", SUBMISSION_STATUSES);
export const correctionKindEnum = pgEnum("correction_kind", CORRECTION_KINDS);
export const correctionStatusEnum = pgEnum("correction_status", CORRECTION_STATUSES);

// ── Who / what / where ──────────────────────────────────────────────────────

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  website: text("website"),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  createdAt: createdAt(),
});

export const companyAliases = pgTable(
  "company_aliases",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [uniqueIndex("company_aliases_unique").on(t.companyId, sql`lower(${t.alias})`)],
);

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  country: text("country").notNull().default("IE"),
});

/** One interview process: a company + role (+ place, + recruitment cycle). */
export const programmes = pgTable(
  "programmes",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id),
    locationId: integer("location_id").references(() => locations.id),
    cycle: text("cycle"),
    slug: text("slug").notNull(),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("programmes_company_slug").on(t.companyId, t.slug)],
);

// ── Evidence ────────────────────────────────────────────────────────────────

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  canonicalUrl: text("canonical_url").notNull().unique(),
  platform: sourcePlatformEnum("platform").notNull(),
  title: text("title"),
  author: text("author"),
  /** When the source says it was published. Separate from when we fetched it. */
  publishedAt: timestamp("published_at", { withTimezone: true }),
  reuseNote: text("reuse_note"),
  status: sourceStatusEnum("status").notNull().default("discovered"),
  statusReason: text("status_reason"),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per retrieved version of a source. A changed page is a new row. */
export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(),
    text: text("text").notNull(),
    truncated: boolean("truncated").notNull().default(false),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("source_documents_source_hash").on(t.sourceId, t.contentHash)],
);

export const claims = pgTable(
  "claims",
  {
    id: serial("id").primaryKey(),
    sourceDocumentId: integer("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    programmeId: integer("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    runId: integer("run_id"),
    type: claimTypeEnum("type").notNull(),
    /** What the source says, in one plain sentence. */
    statement: text("statement").notNull(),
    /** Verbatim text from the source document that supports the statement. */
    quote: text("quote").notNull(),
    stage: interviewStageEnum("stage"),
    roleLevel: roleLevelEnum("role_level").notNull().default("unknown"),
    region: regionEnum("region").notNull().default("unknown"),
    firsthand: boolean("firsthand"),
    interviewYear: integer("interview_year"),
    interviewMonth: integer("interview_month"),
    durationMinutes: integer("duration_minutes"),
    status: claimStatusEnum("status").notNull().default("extracted"),
    duplicateOfClaimId: integer("duplicate_of_claim_id"),
    extractorVersion: text("extractor_version").notNull(),
    model: text("model").notNull(),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("claims_source_document").on(t.sourceDocumentId),
    index("claims_programme_status").on(t.programmeId, t.status),
  ],
);

export const topics = pgTable("topics", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const claimTopics = pgTable(
  "claim_topics",
  {
    claimId: integer("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id),
  },
  (t) => [primaryKey({ columns: [t.claimId, t.topicId] })],
);

/** Curated free preparation links. */
export const resources = pgTable(
  "resources",
  {
    id: serial("id").primaryKey(),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id),
    title: text("title").notNull(),
    url: text("url").notNull(),
    note: text("note"),
  },
  (t) => [uniqueIndex("resources_topic_url").on(t.topicId, t.url)],
);

// ── Published content ───────────────────────────────────────────────────────

export const briefs = pgTable("briefs", {
  id: serial("id").primaryKey(),
  programmeId: integer("programme_id")
    .notNull()
    .unique()
    .references(() => programmes.id, { onDelete: "cascade" }),
  /** Set when evidence behind the published version changed. */
  needsReview: boolean("needs_review").notNull().default(false),
  needsReviewReason: text("needs_review_reason"),
  isSynthetic: boolean("is_synthetic").notNull().default(false),
  createdAt: createdAt(),
});

/**
 * A version's content is one validated JSON document: it is written and read
 * whole and never changes after publishing. Only src/briefs/publish.ts may
 * change `status`.
 */
export const briefVersions = pgTable(
  "brief_versions",
  {
    id: serial("id").primaryKey(),
    briefId: integer("brief_id")
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: briefVersionStatusEnum("status").notNull().default("draft"),
    content: jsonb("content").$type<BriefContent>().notNull(),
    /** Bumped on every edit; approve checks it to detect a stale screen. */
    rowVersion: integer("row_version").notNull().default(1),
    reviewerNote: text("reviewer_note"),
    createdAt: createdAt(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("brief_versions_brief_version").on(t.briefId, t.version),
    index("brief_versions_brief_status").on(t.briefId, t.status),
    // At most one published version per brief.
    uniqueIndex("brief_versions_one_published")
      .on(t.briefId)
      .where(sql`${t.status} = 'published'`),
  ],
);

export const briefVersionClaims = pgTable(
  "brief_version_claims",
  {
    versionId: integer("version_id")
      .notNull()
      .references(() => briefVersions.id, { onDelete: "cascade" }),
    claimId: integer("claim_id")
      .notNull()
      .references(() => claims.id),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.claimId] }),
    index("brief_version_claims_claim").on(t.claimId),
  ],
);

// ── Operations ──────────────────────────────────────────────────────────────

/** Only src/research/run.ts may change `status`. */
export const researchRuns = pgTable(
  "research_runs",
  {
    id: serial("id").primaryKey(),
    programmeId: integer("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("queued"),
    requestedBy: text("requested_by").notNull().default("cli"),
    maxCostUsd: numeric("max_cost_usd", { precision: 10, scale: 4 }),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // One queued or running run per programme.
    uniqueIndex("research_runs_one_active")
      .on(t.programmeId)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
);

export const researchRunSources = pgTable(
  "research_run_sources",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.runId, t.sourceId] })],
);

/** What happened in a run, stage by stage, so a failure can be explained later. */
export const researchRunEvents = pgTable(
  "research_run_events",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => researchRuns.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    sourceId: integer("source_id"),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    message: text("message"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("research_run_events_run").on(t.runId)],
);

/** Search cache: a query is not repeated until it is stale. */
export const researchQueries = pgTable(
  "research_queries",
  {
    id: serial("id").primaryKey(),
    adapter: text("adapter").notNull(),
    query: text("query").notNull(),
    resultCount: integer("result_count").notNull().default(0),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("research_queries_adapter_query").on(t.adapter, t.query)],
);

export const usageEvents = pgTable("usage_events", {
  id: serial("id").primaryKey(),
  runId: integer("run_id"),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(),
  calls: integer("calls").notNull().default(1),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  createdAt: createdAt(),
});

/** Audit log of every admin decision. */
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

// ── Community ───────────────────────────────────────────────────────────────

export const submissions = pgTable(
  "submissions",
  {
    id: serial("id").primaryKey(),
    companyName: text("company_name").notNull(),
    roleName: text("role_name").notNull(),
    locationName: text("location_name").notNull(),
    interviewYear: integer("interview_year").notNull(),
    interviewMonth: integer("interview_month"),
    stage: interviewStageEnum("stage").notNull(),
    format: text("format").notNull(),
    topics: text("topics").notNull(),
    difficulty: integer("difficulty"),
    advice: text("advice"),
    comments: text("comments"),
    displayName: text("display_name"),
    consent: boolean("consent").notNull(),
    status: submissionStatusEnum("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** Keyed hash, deleted after 30 days. */
    ipHash: text("ip_hash"),
    sourceId: integer("source_id").references(() => sources.id),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("submissions_status").on(t.status)],
);

export const corrections = pgTable(
  "corrections",
  {
    id: serial("id").primaryKey(),
    programmeId: integer("programme_id").references(() => programmes.id, {
      onDelete: "set null",
    }),
    kind: correctionKindEnum("kind").notNull(),
    message: text("message").notNull(),
    contact: text("contact"),
    status: correctionStatusEnum("status").notNull().default("open"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("corrections_status").on(t.status)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    id: serial("id").primaryKey(),
    bucket: text("bucket").notNull(),
    ipHash: text("ip_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rate_limits_lookup").on(t.bucket, t.ipHash, t.createdAt)],
);
