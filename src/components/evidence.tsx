import { EVIDENCE_LABEL_HELP, EVIDENCE_LABEL_TEXT, type EvidenceLabel } from "@/domain/constants";

/** How many of the four steps each label fills. Never shown as a number or percentage. */
const STEPS: Record<EvidenceLabel, number> = {
  official: 4,
  multiple_reports: 3,
  single_report: 2,
  historical: 1,
  international: 1,
  unverified: 1,
  insufficient: 0,
};

/**
 * The evidence label: a four-step meter and the plain-words label. Strong
 * evidence is teal; weak or indirect evidence is amber.
 */
export function Evidence({ label, compact = false }: { label: EvidenceLabel; compact?: boolean }) {
  const filled = STEPS[label];
  const tone = filled >= 3 ? "var(--strong)" : filled === 2 ? "var(--ink-soft)" : "var(--caution)";
  return (
    <span
      className="inline-flex items-center gap-2 t-small font-medium"
      style={{ color: tone }}
      title={EVIDENCE_LABEL_HELP[label]}
    >
      <span aria-hidden="true" className="inline-flex items-end gap-[2px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-[5px] rounded-[1px]"
            style={{
              height: `${7 + i * 3}px`,
              background: i < filled ? tone : "var(--rule)",
            }}
          />
        ))}
      </span>
      <span>{EVIDENCE_LABEL_TEXT[label]}</span>
      {!compact && <span className="sr-only">. {EVIDENCE_LABEL_HELP[label]}</span>}
    </span>
  );
}
