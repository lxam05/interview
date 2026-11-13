import type {
  ClaimType,
  EvidenceLabel,
  InterviewStage,
  Region,
  RoleLevel,
  SourcePlatform,
  TopicSlug,
} from "@/domain/constants";

/** What a research run is about. */
export interface ResearchInput {
  company: string;
  aliases: string[];
  role: string;
  /** e.g. "Dublin", or null for anywhere in Ireland. */
  location: string | null;
  cycle: string | null;
  /** Employer pages an admin supplied; fetched as official sources. */
  officialUrls?: string[];
}

/** A source an adapter found. Not yet fetched. */
export interface Candidate {
  url: string;
  title: string | null;
  snippet: string | null;
  platform: SourcePlatform;
  author?: string | null;
  publishedAt?: Date | null;
  /** When the adapter already has the full text (API results), skip fetching. */
  text?: string;
  reuseNote?: string;
}

/** A source with its text, ready for extraction. */
export interface SourceDoc {
  url: string;
  platform: SourcePlatform;
  title: string | null;
  publishedAt: Date | null;
  text: string;
}

/** One fact the model pulled from a document, already quote-checked. */
export interface ExtractedClaim {
  type: ClaimType;
  statement: string;
  quote: string;
  topics: TopicSlug[];
  stage: InterviewStage | null;
  roleLevel: RoleLevel;
  region: Region;
  firsthand: boolean | null;
  interviewYear: number | null;
  interviewMonth: number | null;
  durationMinutes: number | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ExtractionResult {
  /** False when the document is not about this company's interviews at all. */
  relevant: boolean;
  claims: ExtractedClaim[];
  /** Claims the model produced whose quote is not in the document. */
  droppedForQuote: number;
  usage: Usage;
  model: string;
  extractorVersion: string;
}

/** A claim as evaluation and ranking see it: a plain value, no database. */
export interface EvidenceClaim {
  id: number;
  type: ClaimType;
  statement: string;
  quote: string;
  topics: string[];
  stage: InterviewStage | null;
  roleLevel: RoleLevel;
  region: Region;
  firsthand: boolean | null;
  interviewYear: number | null;
  interviewMonth: number | null;
  durationMinutes: number | null;
  /** Identifies the independent source: duplicates share one key. */
  sourceKey: string;
  platform: SourcePlatform;
  sourcePublishedAt: Date | null;
}

export interface LabelledGroup {
  label: EvidenceLabel;
  claims: EvidenceClaim[];
  independentReports: number;
  newestYear: number | null;
  newestMonth: number | null;
}
