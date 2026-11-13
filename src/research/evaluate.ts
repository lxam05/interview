import type { EvidenceLabel } from "@/domain/constants";
import { HISTORICAL_AFTER_MONTHS, MIN_INDEPENDENT_REPORTS } from "./thresholds";
import type { EvidenceClaim, LabelledGroup } from "./types";

/** When a claim's interview happened, as months since year 0, or null if unknown. */
function monthIndex(claim: EvidenceClaim): number | null {
  if (claim.interviewYear) return claim.interviewYear * 12 + ((claim.interviewMonth ?? 6) - 1);
  if (claim.sourcePublishedAt) {
    return claim.sourcePublishedAt.getFullYear() * 12 + claim.sourcePublishedAt.getMonth();
  }
  return null;
}

/** About this internship in Ireland, told by the person it happened to. */
function isDirectFirsthand(c: EvidenceClaim): boolean {
  return c.firsthand === true && c.roleLevel === "intern" && c.region === "ireland";
}

function isOfficial(c: EvidenceClaim): boolean {
  return c.platform === "official" || c.type === "official_policy";
}

/** A firsthand report about another country or a graduate role. Never direct evidence. */
function isElsewhere(c: EvidenceClaim): boolean {
  return (
    c.firsthand === true &&
    (c.region === "international" || c.roleLevel === "graduate" || c.roleLevel === "experienced")
  );
}

const distinctSources = (claims: EvidenceClaim[]) => new Set(claims.map((c) => c.sourceKey)).size;

/*
 * The label rules, in order. The first rule that matches wins.
 *
 *   no claims                                   -> insufficient
 *   any employer statement                      -> official
 *   2+ separate recent direct firsthand reports -> multiple_reports
 *   1 recent direct firsthand report            -> single_report
 *   direct firsthand, all older than 24 months  -> historical
 *   firsthand, but another country or grad role -> international
 *   anything else (second-hand, unclear)        -> unverified
 *
 * A report with no date at all counts as recent for the label; the brief
 * shows "date not stated" beside it so the student can judge.
 */
const RULES: { label: EvidenceLabel; when: (ctx: RuleContext) => boolean }[] = [
  { label: "insufficient", when: (c) => c.claims.length === 0 },
  { label: "official", when: (c) => c.claims.some(isOfficial) },
  { label: "multiple_reports", when: (c) => distinctSources(c.recentDirect) >= MIN_INDEPENDENT_REPORTS },
  { label: "single_report", when: (c) => c.recentDirect.length > 0 },
  { label: "historical", when: (c) => c.direct.length > 0 },
  { label: "international", when: (c) => c.claims.some(isElsewhere) },
  { label: "unverified", when: () => true },
];

interface RuleContext {
  claims: EvidenceClaim[];
  direct: EvidenceClaim[];
  recentDirect: EvidenceClaim[];
}

/** Label one group of claims that are all about the same thing. */
export function evaluate(claims: EvidenceClaim[], now = new Date()): LabelledGroup {
  const nowIndex = now.getFullYear() * 12 + now.getMonth();
  const direct = claims.filter(isDirectFirsthand);
  const recentDirect = direct.filter((c) => {
    const at = monthIndex(c);
    return at === null || nowIndex - at <= HISTORICAL_AFTER_MONTHS;
  });
  const label = RULES.find((r) => r.when({ claims, direct, recentDirect }))!.label;

  // Freshness: the newest date any supporting claim actually states.
  let newest: EvidenceClaim | null = null;
  for (const c of claims) {
    if (!c.interviewYear) continue;
    if (
      !newest ||
      c.interviewYear * 12 + (c.interviewMonth ?? 0) >
        newest.interviewYear! * 12 + (newest.interviewMonth ?? 0)
    ) {
      newest = c;
    }
  }

  return {
    label,
    claims,
    independentReports: distinctSources(
      label === "multiple_reports" || label === "single_report"
        ? recentDirect
        : label === "historical"
          ? direct
          : claims,
    ),
    newestYear: newest?.interviewYear ?? null,
    newestMonth: newest?.interviewMonth ?? null,
  };
}
