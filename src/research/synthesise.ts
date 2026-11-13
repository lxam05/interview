import type { BriefContent, BriefStage, BriefTopic } from "@/briefs/content";
import {
  type EvidenceLabel,
  INTERVIEW_STAGE_TEXT,
  INTERVIEW_STAGES,
  type InterviewStage,
} from "@/domain/constants";
import { evaluate } from "./evaluate";
import type { EvidenceClaim, LabelledGroup } from "./types";

/** Stronger evidence first. The order of this list is the ranking rule. */
const LABEL_STRENGTH: EvidenceLabel[] = [
  "official",
  "multiple_reports",
  "single_report",
  "historical",
  "international",
  "unverified",
  "insufficient",
];

export interface SynthesisInput {
  /** Reviewed claims only. Callers must never pass unreviewed claims for a real brief. */
  claims: EvidenceClaim[];
  topicNames: Map<string, string>;
  resources: Map<string, { title: string; url: string }[]>;
  /** Optional model-written "why" sentences, keyed by topic slug. */
  rationales?: Map<string, string>;
  now?: Date;
}

/**
 * Rank topics. Deterministic: the same claims always give the same order.
 * Evidence strength first, then the most recent report, then how many
 * separate reports, then name. "Other" always goes last.
 */
export function rankTopics<T extends { slug: string; name: string; group: LabelledGroup }>(
  topics: T[],
): T[] {
  const strength = (g: LabelledGroup) => LABEL_STRENGTH.indexOf(g.label);
  const recency = (g: LabelledGroup) => (g.newestYear ?? 0) * 12 + (g.newestMonth ?? 0);
  return [...topics].sort(
    (a, b) =>
      Number(a.slug === "other") - Number(b.slug === "other") ||
      strength(a.group) - strength(b.group) ||
      recency(b.group) - recency(a.group) ||
      b.group.independentReports - a.group.independentReports ||
      a.name.localeCompare(b.name),
  );
}

/** "Data structures" -> "data structures", but "SQL basics" stays as it is. */
function inSentence(name: string): string {
  return /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The "why" sentence used when no model-written one is available. */
export function templateRationale(name: string, group: LabelledGroup, stages: InterviewStage[]): string {
  const where = stages.length
    ? ` in the ${stages.map((s) => INTERVIEW_STAGE_TEXT[s].toLowerCase()).join(" and ")}`
    : "";
  const when = group.newestYear ? `, most recently in ${group.newestYear}` : "";
  const n = group.independentReports;
  switch (group.label) {
    case "official":
      return `The employer's own recruitment material mentions ${inSentence(name)}${where}.`;
    case "multiple_reports":
      return `${plural(n, "separate candidate report", "separate candidate reports")} of this internship in Ireland mention ${inSentence(name)}${where}${when}.`;
    case "single_report":
      return `One candidate report of this internship in Ireland mentions ${inSentence(name)}${where}${when}.`;
    case "historical":
      return `Candidates reported ${inSentence(name)}${where}${when}, more than two years ago, so it may have changed.`;
    case "international":
      return `Reported for the same company in another country or for a graduate role, not for this internship in Ireland.`;
    case "unverified":
      return `Mentioned by a source that is not a firsthand account of this interview.`;
    case "insufficient":
      return `There is not enough evidence to say whether this comes up.`;
  }
}

/**
 * Build the content of a brief from reviewed claims. No database, no model:
 * the same input always produces the same brief (apart from optional
 * rationale sentences passed in).
 */
export function buildBriefContent(input: SynthesisInput): BriefContent {
  const now = input.now ?? new Date();

  // Topics: every claim that names a topic supports that topic.
  const byTopic = new Map<string, EvidenceClaim[]>();
  for (const claim of input.claims) {
    for (const slug of claim.topics) {
      if (!byTopic.has(slug)) byTopic.set(slug, []);
      byTopic.get(slug)!.push(claim);
    }
  }
  const ranked = rankTopics(
    [...byTopic.entries()].map(([slug, claims]) => ({
      slug,
      name: input.topicNames.get(slug) ?? slug,
      group: evaluate(claims, now),
    })),
  );
  const topics: BriefTopic[] = ranked.map((t, i) => {
    const stages = INTERVIEW_STAGES.filter((s) => t.group.claims.some((c) => c.stage === s));
    return {
      topicSlug: t.slug,
      name: t.name,
      rank: i + 1,
      label: t.group.label,
      why: input.rationales?.get(t.slug) ?? templateRationale(t.name, t.group, stages),
      stages,
      claimIds: t.group.claims.map((c) => c.id).sort((a, b) => a - b),
      newestYear: t.group.newestYear,
      newestMonth: t.group.newestMonth,
      independentReports: t.group.independentReports,
      resources: (input.resources.get(t.slug) ?? []).slice(0, 2),
    };
  });

  // Stages: what the employer says and what candidates report stay separate.
  const stages: BriefStage[] = [];
  for (const stage of INTERVIEW_STAGES) {
    for (const origin of ["official", "candidate"] as const) {
      const claims = input.claims.filter(
        (c) =>
          c.stage === stage &&
          (c.type === "process_stage" || c.type === "format" || c.type === "official_policy") &&
          (origin === "official") === (c.platform === "official" || c.type === "official_policy"),
      );
      if (!claims.length) continue;
      const group = evaluate(claims, now);
      const statements = [...new Set(claims.map((c) => c.statement))].slice(0, 3);
      const durations = claims.map((c) => c.durationMinutes).filter((d): d is number => d !== null);
      stages.push({
        stage,
        origin,
        summary: statements.join(" "),
        durationMinutes: durations.length ? Math.max(...durations) : null,
        label: group.label,
        claimIds: claims.map((c) => c.id).sort((a, b) => a - b),
      });
    }
  }

  const advice = input.claims
    .filter((c) => c.type === "advice")
    .slice(0, 6)
    .map((c) => ({ text: c.statement, claimIds: [c.id] }));

  return {
    topics,
    stages,
    advice,
    limitations: limitations(input.claims, topics, stages),
    generatedAt: now.toISOString(),
  };
}

function limitations(claims: EvidenceClaim[], topics: BriefTopic[], stages: BriefStage[]): string[] {
  const out: string[] = [];
  const sources = new Set(claims.map((c) => c.sourceKey)).size;
  out.push(
    `This brief rests on ${plural(sources, "source", "sources")}. Interviews vary by team and year, so nothing here is guaranteed to come up.`,
  );
  if (!stages.some((s) => s.origin === "official")) {
    out.push("We found no description of the process published by the employer itself.");
  }
  if (topics.some((t) => t.label === "international")) {
    out.push(
      "Some evidence comes from other countries or from graduate roles. It is labelled and ranked below evidence about this internship in Ireland.",
    );
  }
  if (topics.length && topics.every((t) => t.label === "historical")) {
    out.push("Every report we found is more than two years old.");
  }
  if (topics.some((t) => t.newestYear === null)) {
    out.push("Some sources do not say when the interview took place.");
  }
  return out;
}
