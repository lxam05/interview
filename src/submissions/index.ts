import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  claims,
  claimTopics,
  corrections,
  programmes,
  reviews,
  sourceDocuments,
  sources,
  submissions,
  topics,
} from "@/db/schema";
import {
  CANONICAL_TOPICS,
  CORRECTION_KINDS,
  INTERVIEW_STAGE_TEXT,
  INTERVIEW_STAGES,
  TOPIC_SLUGS,
  type InterviewStage,
} from "@/domain/constants";
import { contentHash } from "@/research/retrieve";
import { checkRateLimit } from "@/lib/protect";

/*
 * Student interview reports and error reports. Both arrive through public
 * forms, so both are validated, rate limited and kept out of public pages
 * until a moderator approves them.
 */

/** A form posted faster than this after it loaded is treated as a bot. */
export const MIN_FILL_MS = 3_000;
export const COMMUNITY_EXTRACTOR = "community-form-1";

const year = new Date().getFullYear();

const text = (max: number) => z.string().trim().max(max);

export const submissionSchema = z.object({
  companyName: text(120).min(2, "Which company was the interview with?"),
  roleName: text(120).min(2, "Which role did you interview for?"),
  locationName: text(120).min(2, "Where was the role based?"),
  interviewYear: z.coerce
    .number()
    .int()
    .min(year - 6, "Reports older than six years are not useful to students.")
    .max(year, "That year is in the future."),
  interviewMonth: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(12)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  stage: z.enum(INTERVIEW_STAGES, { error: "Pick the stage you are describing." }),
  format: text(600).min(10, "Say a little about the format (at least 10 characters)."),
  topicSlugs: z.array(z.enum(TOPIC_SLUGS)).max(TOPIC_SLUGS.length).default([]),
  topics: text(3000).min(20, "Describe what came up (at least 20 characters)."),
  difficulty: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(5)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  advice: text(1500).optional().default(""),
  comments: text(1500).optional().default(""),
  displayName: text(60).optional().default(""),
  consent: z.literal(true, { error: "Please confirm you agree before sending." }),
  idempotencyKey: z.string().uuid(),
});
export type SubmissionInput = z.infer<typeof submissionSchema>;

export const correctionSchema = z.object({
  programmeId: z.coerce.number().int().positive().nullable().optional(),
  kind: z.enum(CORRECTION_KINDS),
  message: text(2000).min(10, "Tell us what is wrong (at least 10 characters)."),
  contact: text(200).optional().default(""),
});
export type CorrectionInput = z.infer<typeof correctionSchema>;

export type FormGuard = {
  /** Hidden field real people never fill. */
  honeypot: string;
  /** When the form was shown, in ms since epoch. */
  startedAt: number;
  ipHash: string;
  now?: number;
};

export type SubmitOutcome =
  | { ok: true; id: number; duplicate: boolean; reflection: Reflection }
  | { ok: false; reason: "bot" | "rate_limited" | "invalid"; fieldErrors?: Record<string, string> };

function guardFails(g: FormGuard): boolean {
  const now = g.now ?? Date.now();
  return g.honeypot.trim() !== "" || !Number.isFinite(g.startedAt) || now - g.startedAt < MIN_FILL_MS;
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export async function submitReport(db: Db, raw: unknown, guard: FormGuard): Promise<SubmitOutcome> {
  // Bots get the same "thanks" a person would, with nothing stored.
  if (guardFails(guard)) return { ok: false, reason: "bot" };
  const parsed = submissionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const input = parsed.data;

  const [existing] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.idempotencyKey, input.idempotencyKey));
  if (existing) return { ok: true, id: existing.id, duplicate: true, reflection: reflect(input) };

  if (!(await checkRateLimit(db, "submission", guard.ipHash))) return { ok: false, reason: "rate_limited" };

  const [row] = await db
    .insert(submissions)
    .values({
      companyName: input.companyName,
      roleName: input.roleName,
      locationName: input.locationName,
      interviewYear: input.interviewYear,
      interviewMonth: input.interviewMonth ?? null,
      stage: input.stage,
      format: input.format,
      topicSlugs: [...new Set(input.topicSlugs)],
      topics: input.topics,
      difficulty: input.difficulty ?? null,
      advice: input.advice || null,
      comments: input.comments || null,
      displayName: input.displayName || null,
      consent: true,
      idempotencyKey: input.idempotencyKey,
      ipHash: guard.ipHash,
    })
    .onConflictDoNothing({ target: submissions.idempotencyKey })
    .returning({ id: submissions.id });
  if (!row) {
    // A concurrent double-submit won the race; report the stored one.
    const [again] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.idempotencyKey, input.idempotencyKey));
    return { ok: true, id: again.id, duplicate: true, reflection: reflect(input) };
  }
  return { ok: true, id: row.id, duplicate: false, reflection: reflect(input) };
}

export interface Reflection {
  headline: string;
  stage: string;
  when: string;
  topics: string[];
  checklist: string[];
}

/** What the contributor sees straight after sending: their own report, organised. */
export function reflect(input: Pick<SubmissionInput, "companyName" | "stage" | "interviewYear" | "interviewMonth" | "topicSlugs" | "advice" | "format">): Reflection {
  const names = new Map<string, string>(CANONICAL_TOPICS.map((t) => [t.slug, t.name]));
  const picked = input.topicSlugs.filter((s) => s !== "other").map((s) => names.get(s) ?? s);
  const month = input.interviewMonth
    ? new Date(Date.UTC(2000, input.interviewMonth - 1, 1)).toLocaleString("en-IE", { month: "long", timeZone: "UTC" })
    : null;
  const checklist = [
    ...picked.map((t) => `Revise ${t.toLowerCase()} before your next interview at ${input.companyName}.`),
    `Format to expect: ${input.format.trim().replace(/\.$/, "")}.`,
  ];
  if (input.advice?.trim()) checklist.push(`Your own advice: ${input.advice.trim()}`);
  return {
    headline: `${INTERVIEW_STAGE_TEXT[input.stage]} at ${input.companyName}`,
    stage: INTERVIEW_STAGE_TEXT[input.stage],
    when: month ? `${month} ${input.interviewYear}` : String(input.interviewYear),
    topics: picked,
    checklist,
  };
}

export async function submitCorrection(
  db: Db,
  raw: unknown,
  guard: FormGuard,
): Promise<{ ok: true; id: number } | { ok: false; reason: "bot" | "rate_limited" | "invalid"; fieldErrors?: Record<string, string> }> {
  if (guard.honeypot.trim() !== "") return { ok: false, reason: "bot" };
  const parsed = correctionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid", fieldErrors: fieldErrors(parsed.error) };
  if (!(await checkRateLimit(db, "correction", guard.ipHash))) return { ok: false, reason: "rate_limited" };
  const input = parsed.data;
  let programmeId = input.programmeId ?? null;
  if (programmeId) {
    const [p] = await db.select({ id: programmes.id }).from(programmes).where(eq(programmes.id, programmeId));
    programmeId = p?.id ?? null;
  }
  const [row] = await db
    .insert(corrections)
    .values({
      programmeId,
      kind: input.kind,
      message: input.message,
      contact: input.contact || null,
      ipHash: guard.ipHash,
    })
    .returning({ id: corrections.id });
  return { ok: true, id: row.id };
}

// ── Moderation ──────────────────────────────────────────────────────────────

/** The text stored as the evidence document for an approved report. */
export function submissionDocument(s: {
  stage: InterviewStage;
  interviewYear: number;
  interviewMonth: number | null;
  format: string;
  topics: string;
  topicSlugs: string[];
  advice: string | null;
}): string {
  const names = new Map<string, string>(CANONICAL_TOPICS.map((t) => [t.slug, t.name]));
  const lines = [
    `Stage: ${INTERVIEW_STAGE_TEXT[s.stage]}`,
    `When: ${s.interviewMonth ? `${s.interviewMonth}/` : ""}${s.interviewYear}`,
    `Format: ${s.format}`,
  ];
  if (s.topicSlugs.length) lines.push(`Topics: ${s.topicSlugs.map((t) => names.get(t) ?? t).join(", ")}`);
  lines.push(`What came up: ${s.topics}`);
  if (s.advice) lines.push(`Advice: ${s.advice}`);
  return lines.join("\n");
}

/**
 * Approve a report against a programme. It becomes a community source with
 * one document and approved claims (a moderator has read it), so the next
 * draft for that programme includes it. Re-approving does nothing.
 */
export async function approveSubmission(
  db: Db,
  input: { submissionId: number; programmeId: number; note?: string | null },
) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(submissions).where(eq(submissions.id, input.submissionId)).for("update");
    if (!s) throw new Error(`Submission ${input.submissionId} does not exist.`);
    if (s.status === "approved" && s.sourceId) return { sourceId: s.sourceId, claims: 0 };
    const [programme] = await tx.select().from(programmes).where(eq(programmes.id, input.programmeId));
    if (!programme) throw new Error(`Programme ${input.programmeId} does not exist.`);

    const docText = submissionDocument(s);
    const [source] = await tx
      .insert(sources)
      .values({
        canonicalUrl: `community:submission/${s.id}`,
        platform: "community",
        title: `Student report: ${INTERVIEW_STAGE_TEXT[s.stage].toLowerCase()}, ${s.interviewYear}`,
        author: null,
        publishedAt: s.createdAt,
        reuseNote: "Submitted through the site with the contributor's consent.",
        status: "retrieved",
        isSynthetic: s.isSynthetic,
      })
      .returning();
    const [doc] = await tx
      .insert(sourceDocuments)
      .values({ sourceId: source.id, contentHash: contentHash(docText), text: docText })
      .returning();

    const topicRows = await tx.select().from(topics);
    const topicId = new Map(topicRows.map((t) => [t.slug, t.id]));
    const names = new Map(topicRows.map((t) => [t.slug, t.name]));
    const base = {
      sourceDocumentId: doc.id,
      programmeId: programme.id,
      stage: s.stage,
      roleLevel: "intern" as const,
      region: "ireland" as const,
      firsthand: true,
      interviewYear: s.interviewYear,
      interviewMonth: s.interviewMonth,
      status: "approved" as const,
      extractorVersion: COMMUNITY_EXTRACTOR,
      model: "none",
      isSynthetic: s.isSynthetic,
      reviewedAt: new Date(),
    };
    const stageText = INTERVIEW_STAGE_TEXT[s.stage].toLowerCase();
    const rows: { values: typeof claims.$inferInsert; topicSlugs: string[] }[] = [
      {
        values: { ...base, type: "format", statement: `The ${stageText} was: ${s.format}`, quote: `Format: ${s.format}` },
        topicSlugs: [],
      },
      ...s.topicSlugs.map((slug) => ({
        values: {
          ...base,
          type: "topic" as const,
          statement: `A student reported ${(names.get(slug) ?? slug).toLowerCase()} in the ${stageText}.`,
          quote: `What came up: ${s.topics}`,
        },
        topicSlugs: [slug],
      })),
    ];
    if (s.advice) {
      rows.push({ values: { ...base, type: "advice", statement: s.advice, quote: `Advice: ${s.advice}` }, topicSlugs: [] });
    }
    for (const r of rows) {
      const [c] = await tx.insert(claims).values(r.values).returning({ id: claims.id });
      const links = r.topicSlugs.filter((slug) => topicId.has(slug)).map((slug) => ({ claimId: c.id, topicId: topicId.get(slug)! }));
      if (links.length) await tx.insert(claimTopics).values(links);
    }

    await tx
      .update(submissions)
      .set({ status: "approved", sourceId: source.id, programmeId: programme.id, moderatorNote: input.note ?? null })
      .where(eq(submissions.id, s.id));
    await tx.insert(reviews).values({ entityType: "submission", entityId: s.id, action: "approved", note: input.note ?? null });
    return { sourceId: source.id, claims: rows.length };
  });
}

export async function rejectSubmission(db: Db, submissionId: number, note?: string | null) {
  await db.update(submissions).set({ status: "rejected", moderatorNote: note ?? null }).where(eq(submissions.id, submissionId));
  await db.insert(reviews).values({ entityType: "submission", entityId: submissionId, action: "rejected", note: note ?? null });
}

export async function resolveCorrection(db: Db, correctionId: number, status: "resolved" | "dismissed", note?: string | null) {
  await db.update(corrections).set({ status }).where(eq(corrections.id, correctionId));
  await db.insert(reviews).values({ entityType: "correction", entityId: correctionId, action: status, note: note ?? null });
}

/**
 * Pending reports that look like another report: same company and stage and
 * year. Shown to the moderator as a hint, never acted on automatically.
 */
export async function duplicateHints(db: Db, submissionId: number) {
  const [s] = await db.select().from(submissions).where(eq(submissions.id, submissionId));
  if (!s) return [];
  const rows = await db
    .select({ id: submissions.id, companyName: submissions.companyName, status: submissions.status, topics: submissions.topics })
    .from(submissions)
    .where(and(eq(submissions.stage, s.stage), eq(submissions.interviewYear, s.interviewYear)))
    .orderBy(desc(submissions.id));
  const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  return rows.filter((r) => r.id !== s.id && key(r.companyName) === key(s.companyName));
}
