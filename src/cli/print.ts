import type { BriefContent } from "@/briefs/content";
import { EVIDENCE_LABEL_TEXT, INTERVIEW_STAGE_TEXT } from "@/domain/constants";
import type { EvidenceClaim } from "@/research/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatWhen(year: number | null, month: number | null): string {
  if (!year) return "date not stated";
  return month ? `${MONTHS[month - 1]} ${year}` : String(year);
}

/** A brief as plain text for the terminal. */
export function renderBrief(
  title: string,
  content: BriefContent,
  claims: EvidenceClaim[],
  sourceUrlOf: Map<string, string>,
): string {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const lines: string[] = [title, "=".repeat(title.length), "", "WHAT SHOULD I STUDY?", ""];

  for (const t of content.topics) {
    lines.push(`${t.rank}. ${t.name}  [${EVIDENCE_LABEL_TEXT[t.label]}]`);
    lines.push(`   Why: ${t.why}`);
    if (t.stages.length) {
      lines.push(`   Stage: ${t.stages.map((s) => INTERVIEW_STAGE_TEXT[s]).join(", ")}`);
    }
    lines.push(`   Newest report: ${formatWhen(t.newestYear, t.newestMonth)}`);
    const first = byId.get(t.claimIds[0]);
    if (first) {
      lines.push(`   Evidence: "${first.quote}"`);
      lines.push(`             ${sourceUrlOf.get(first.sourceKey) ?? ""}`);
    }
    for (const r of t.resources) lines.push(`   Practise: ${r.title} (${r.url})`);
    lines.push("");
  }
  if (!content.topics.length) lines.push("   No topics have evidence yet.", "");

  lines.push("WHAT DOES THE INTERVIEW LOOK LIKE?", "");
  for (const s of content.stages) {
    const who = s.origin === "official" ? "Employer says" : "Candidates report";
    const length = s.durationMinutes ? ` (about ${s.durationMinutes} min)` : "";
    lines.push(`- ${INTERVIEW_STAGE_TEXT[s.stage]}${length}: ${who}: ${s.summary}`);
    lines.push(`  [${EVIDENCE_LABEL_TEXT[s.label]}]`);
  }
  if (!content.stages.length) lines.push("- Nothing is known about the stages yet.");

  if (content.advice.length) {
    lines.push("", "ADVICE FROM CANDIDATES", "");
    for (const a of content.advice) lines.push(`- ${a.text}`);
  }

  lines.push("", "WHAT WE DO NOT KNOW", "");
  for (const l of content.limitations) lines.push(`- ${l}`);
  return lines.join("\n");
}
