/**
 * Single source for every closed list in the system. Database enums,
 * validation schemas and screens all derive from these arrays, so adding a
 * value here is the only edit needed.
 */

export const EVIDENCE_LABELS = [
  "official",
  "multiple_reports",
  "single_report",
  "historical",
  "international",
  "unverified",
  "insufficient",
] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export const EVIDENCE_LABEL_TEXT: Record<EvidenceLabel, string> = {
  official: "Officially confirmed",
  multiple_reports: "Multiple independent reports",
  single_report: "Single candidate report",
  historical: "Historical information",
  international: "International supporting evidence",
  unverified: "Unverified",
  insufficient: "Insufficient evidence",
};

export const EVIDENCE_LABEL_HELP: Record<EvidenceLabel, string> = {
  official: "Stated by the employer on its own careers or recruitment pages.",
  multiple_reports:
    "Two or more separate firsthand reports about this internship in Ireland agree.",
  single_report: "One firsthand report about this internship in Ireland.",
  historical: "The newest supporting report is more than two years old.",
  international:
    "Reported for another country or for a graduate role at the same company, not for this internship in Ireland.",
  unverified: "Mentioned by a source that is not a firsthand account.",
  insufficient: "Not enough evidence to say anything reliable.",
};

export const CLAIM_TYPES = [
  "topic",
  "process_stage",
  "format",
  "advice",
  "official_policy",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_STATUSES = ["extracted", "approved", "rejected"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const INTERVIEW_STAGES = [
  "application",
  "online_assessment",
  "phone_screen",
  "technical_interview",
  "behavioural_interview",
  "final_round",
  "other",
] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];

export const INTERVIEW_STAGE_TEXT: Record<InterviewStage, string> = {
  application: "Application",
  online_assessment: "Online assessment",
  phone_screen: "Phone or recruiter screen",
  technical_interview: "Technical interview",
  behavioural_interview: "Behavioural interview",
  final_round: "Final round",
  other: "Other",
};

export const ROLE_LEVELS = ["intern", "graduate", "experienced", "unknown"] as const;
export type RoleLevel = (typeof ROLE_LEVELS)[number];

export const REGIONS = ["ireland", "international", "unknown"] as const;
export type Region = (typeof REGIONS)[number];

export const SOURCE_PLATFORMS = [
  "github",
  "hackernews",
  "web",
  "official",
  "community",
] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const SOURCE_PLATFORM_TEXT: Record<SourcePlatform, string> = {
  github: "GitHub",
  hackernews: "Hacker News",
  web: "Web page",
  official: "Employer page",
  community: "Student report",
};

export const SOURCE_STATUSES = [
  "discovered",
  "retrieved",
  "not_permitted",
  "unavailable",
  "blocked",
  "failed",
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const BRIEF_VERSION_STATUSES = [
  "draft",
  "in_review",
  "published",
  "unpublished",
  "rejected",
] as const;
export type BriefVersionStatus = (typeof BRIEF_VERSION_STATUSES)[number];

export const SUBMISSION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "removed",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const CORRECTION_KINDS = ["error", "outdated", "removal_request"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_STATUSES = ["open", "resolved", "dismissed"] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

/**
 * Canonical preparation topics. Extraction maps what a source says onto this
 * list, or onto "other". The `topics` table is seeded from it.
 */
export const CANONICAL_TOPICS = [
  { slug: "data-structures", name: "Data structures" },
  { slug: "algorithms", name: "Algorithms" },
  { slug: "programming-language", name: "Programming language fundamentals" },
  { slug: "object-oriented-design", name: "Object-oriented design" },
  { slug: "databases-sql", name: "Databases and SQL" },
  { slug: "operating-systems", name: "Operating systems" },
  { slug: "networking", name: "Networking" },
  { slug: "system-design-basics", name: "System design basics" },
  { slug: "testing", name: "Testing and debugging" },
  { slug: "behavioural", name: "Behavioural questions" },
  { slug: "projects-cv", name: "Projects and CV walk-through" },
  { slug: "online-assessment-format", name: "Online assessment format" },
  { slug: "other", name: "Other" },
] as const;
export type TopicSlug = (typeof CANONICAL_TOPICS)[number]["slug"];
export const TOPIC_SLUGS = CANONICAL_TOPICS.map((t) => t.slug) as [
  TopicSlug,
  ...TopicSlug[],
];
