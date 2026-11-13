import { z } from "zod";
import { EVIDENCE_LABELS, INTERVIEW_STAGES } from "@/domain/constants";

/**
 * The content of one brief version. Stored whole as JSON on the version row
 * and validated on every write and read.
 */
export const briefTopicSchema = z.object({
  topicSlug: z.string().min(1),
  name: z.string().min(1),
  rank: z.number().int().positive(),
  label: z.enum(EVIDENCE_LABELS),
  /** One or two sentences on why this topic is on the list. */
  why: z.string().min(1),
  stages: z.array(z.enum(INTERVIEW_STAGES)),
  claimIds: z.array(z.number().int()),
  /** Newest reported interview date behind this topic, if any source gave one. */
  newestYear: z.number().int().nullable(),
  newestMonth: z.number().int().min(1).max(12).nullable(),
  independentReports: z.number().int().nonnegative(),
  resources: z.array(z.object({ title: z.string(), url: z.string().url() })),
});
export type BriefTopic = z.infer<typeof briefTopicSchema>;

export const briefStageSchema = z.object({
  stage: z.enum(INTERVIEW_STAGES),
  /** Whether the employer said this or candidates reported it. */
  origin: z.enum(["official", "candidate"]),
  summary: z.string().min(1),
  durationMinutes: z.number().int().positive().nullable(),
  label: z.enum(EVIDENCE_LABELS),
  claimIds: z.array(z.number().int()),
});
export type BriefStage = z.infer<typeof briefStageSchema>;

export const briefContentSchema = z.object({
  topics: z.array(briefTopicSchema),
  stages: z.array(briefStageSchema),
  /** Advice reported by candidates, each line tied to claims. */
  advice: z.array(z.object({ text: z.string(), claimIds: z.array(z.number().int()) })),
  /** What we do not know. Always shown to the student. */
  limitations: z.array(z.string()),
  generatedAt: z.string(),
});
export type BriefContent = z.infer<typeof briefContentSchema>;

/** Every claim id a piece of content cites. */
export function citedClaimIds(content: BriefContent): number[] {
  const ids = new Set<number>();
  for (const t of content.topics) t.claimIds.forEach((id) => ids.add(id));
  for (const s of content.stages) s.claimIds.forEach((id) => ids.add(id));
  for (const a of content.advice) a.claimIds.forEach((id) => ids.add(id));
  return [...ids].sort((a, b) => a - b);
}
