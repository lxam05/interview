/**
 * Every failure the research engine and CLI can report, defined once.
 *
 * Each error carries a stable code, says what failed with the actual values,
 * gives the fix as an exact command or the exact thing a human must supply,
 * and says whether retrying is safe. docs/errors.md has one anchor per code
 * and a test fails if a code is missing there.
 */

export type Retry =
  | "retry" // safe to run the same command again unchanged
  | "fix_then_retry" // do the fix, then run it again
  | "ask_human" // needs a person (a key, a decision)
  | "none"; // nothing to retry; the source is simply skipped

export const ERROR_CODES = {
  RESEARCH_COMPANY_NOT_FOUND: "No company matches the name given.",
  RESEARCH_PROGRAMME_NOT_FOUND: "The company has no programme for that role and location.",
  RESEARCH_RUN_NOT_FOUND: "No research run has that id.",
  RESEARCH_RUN_ACTIVE: "A run for this programme is already queued or running.",
  RESEARCH_BUDGET_EXCEEDED: "The run stopped because it reached its cost limit.",
  RESEARCH_ADAPTER_TIMEOUT: "A search source did not answer in time.",
  RESEARCH_ADAPTER_RATE_LIMITED: "A search source refused further requests for now.",
  RESEARCH_ADAPTER_AUTH: "A search source rejected the key, or the key is missing.",
  RESEARCH_ADAPTER_SCHEMA: "A search source answered in a shape the adapter does not understand.",
  RESEARCH_ROBOTS_DISALLOWED: "The site's robots.txt does not permit fetching this page.",
  RESEARCH_FETCH_STATUS: "The page answered with an error status.",
  RESEARCH_UNSUPPORTED_CONTENT: "The page is too large or is not text.",
  RESEARCH_BLOCKED_ADDRESS: "The address is not a public http(s) address and was not fetched.",
  RESEARCH_LLM_KEY_MISSING: "ANTHROPIC_API_KEY is not set, so extraction cannot run.",
  RESEARCH_LLM_TRANSIENT: "The model API was overloaded, rate limited or timed out.",
  RESEARCH_LLM_REFUSAL: "The model declined to process this document.",
  RESEARCH_LLM_MALFORMED: "The model returned empty or unparseable output.",
  RESEARCH_EXTRACTION_SCHEMA: "The model's output did not match the extraction schema.",
  RESEARCH_RUN_STALE: "A run stopped sending heartbeats and was marked failed.",
  BRIEF_INVALID_TRANSITION: "The brief version changed or is not in a state that allows this.",
  BRIEF_UNSUPPORTED_TOPIC: "A topic in the brief has no approved claim behind it.",
  DB_URL_MISSING: "DATABASE_URL is not set.",
  DB_UNREACHABLE: "The database could not be reached.",
  WORKER_UNEXPECTED: "The worker hit an error nobody planned for.",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ResearchError extends Error {
  readonly code: ErrorCode;
  /** An exact command or the exact thing a human must provide. */
  readonly fix: string;
  readonly retry: Retry;
  /** What was already written when this happened. */
  readonly sideEffects: string;

  constructor(
    code: ErrorCode,
    what: string,
    opts: { fix: string; retry: Retry; sideEffects?: string; cause?: unknown },
  ) {
    super(what, { cause: opts.cause });
    this.name = code;
    this.code = code;
    this.fix = opts.fix;
    this.retry = opts.retry;
    this.sideEffects = opts.sideEffects ?? "nothing written";
  }
}

const RETRY_TEXT: Record<Retry, string> = {
  retry: "safe to retry",
  fix_then_retry: "retry after the fix",
  ask_human: "needs a person",
  none: "nothing to retry",
};

/** One line, the same shape for every error. Never includes secret values. */
export function formatError(err: ResearchError): string {
  return `error[${err.code}]: ${err.message}. fix: ${err.fix} (${RETRY_TEXT[err.retry]}; ${err.sideEffects})`;
}

// ── Constructors, one per failure ───────────────────────────────────────────

export const errors = {
  companyNotFound: (name: string) =>
    new ResearchError("RESEARCH_COMPANY_NOT_FOUND", `no company matches "${name}"`, {
      fix: `npm run research -- --list-companies, or add it with npm run research -- --add-company "${name}"`,
      retry: "fix_then_retry",
    }),
  programmeNotFound: (company: string, role: string) =>
    new ResearchError(
      "RESEARCH_PROGRAMME_NOT_FOUND",
      `"${company}" has no programme for role "${role}"`,
      {
        fix: `npm run research -- --add-company "${company}" --role "${role}"`,
        retry: "fix_then_retry",
      },
    ),
  runNotFound: (id: number) =>
    new ResearchError("RESEARCH_RUN_NOT_FOUND", `no research run has id ${id}`, {
      fix: "npm run research:inspect -- --list",
      retry: "fix_then_retry",
    }),
  runActive: (programmeId: number) =>
    new ResearchError(
      "RESEARCH_RUN_ACTIVE",
      `programme ${programmeId} already has a queued or running run`,
      { fix: "npm run research:inspect -- --list, then wait for it or run the worker", retry: "none" },
    ),
  budgetExceeded: (runId: number, spent: number, limit: number) =>
    new ResearchError(
      "RESEARCH_BUDGET_EXCEEDED",
      `run ${runId} spent $${spent.toFixed(4)} of its $${limit.toFixed(2)} limit and stopped`,
      {
        fix: `npm run research -- --run ${runId} --max-cost <higher amount>`,
        retry: "fix_then_retry",
        sideEffects: "documents and claims processed so far are stored and will be skipped next time",
      },
    ),
  adapterTimeout: (adapter: string, query: string) =>
    new ResearchError("RESEARCH_ADAPTER_TIMEOUT", `${adapter} timed out on "${query}"`, {
      fix: "run the research again later; other sources were still used",
      retry: "retry",
    }),
  adapterRateLimited: (adapter: string) =>
    new ResearchError("RESEARCH_ADAPTER_RATE_LIMITED", `${adapter} is rate limiting requests`, {
      fix: "wait a few minutes and run the research again; other sources were still used",
      retry: "retry",
    }),
  adapterAuth: (adapter: string, envVar: string) =>
    new ResearchError(
      "RESEARCH_ADAPTER_AUTH",
      `${adapter} rejected the request: ${envVar} is missing or invalid`,
      {
        fix: `set ${envVar} through Keysmith, then prefix the command with: keysmith run --`,
        retry: "ask_human",
      },
    ),
  adapterSchema: (adapter: string, detail: string) =>
    new ResearchError(
      "RESEARCH_ADAPTER_SCHEMA",
      `${adapter} answered in an unexpected shape (${detail})`,
      { fix: `update src/research/adapters/${adapter}.ts to match the API's current response`, retry: "none" },
    ),
  robotsDisallowed: (url: string) =>
    new ResearchError("RESEARCH_ROBOTS_DISALLOWED", `robots.txt does not permit fetching ${url}`, {
      fix: "none needed; the source is recorded as not permitted and skipped",
      retry: "none",
    }),
  fetchStatus: (url: string, status: number) =>
    new ResearchError("RESEARCH_FETCH_STATUS", `${url} answered ${status}`, {
      fix: status >= 500 ? "run the research again later" : "none needed; the source is recorded as unavailable",
      retry: status >= 500 ? "retry" : "none",
    }),
  unsupportedContent: (url: string, why: string) =>
    new ResearchError("RESEARCH_UNSUPPORTED_CONTENT", `${url} was skipped: ${why}`, {
      fix: "none needed; the source is recorded and skipped",
      retry: "none",
    }),
  blockedAddress: (url: string, why: string) =>
    new ResearchError("RESEARCH_BLOCKED_ADDRESS", `${url} was not fetched: ${why}`, {
      fix: "none; only public http(s) addresses are fetched",
      retry: "none",
    }),
  llmKeyMissing: (documents: number) =>
    new ResearchError(
      "RESEARCH_LLM_KEY_MISSING",
      `ANTHROPIC_API_KEY is not set, extraction skipped for ${documents} document(s)`,
      {
        fix: "set ANTHROPIC_API_KEY through Keysmith, then: keysmith run -- npm run research -- --run <id>",
        retry: "ask_human",
        sideEffects: "retrieved documents are stored; no claims written",
      },
    ),
  llmTransient: (detail: string, cause?: unknown) =>
    new ResearchError("RESEARCH_LLM_TRANSIENT", `the model API failed temporarily (${detail})`, {
      fix: "run the research again; finished documents are skipped",
      retry: "retry",
      cause,
    }),
  llmRefusal: (sourceUrl: string) =>
    new ResearchError("RESEARCH_LLM_REFUSAL", `the model declined to process ${sourceUrl}`, {
      fix: "none needed; the document is recorded as refused and skipped",
      retry: "none",
    }),
  llmMalformed: (sourceUrl: string) =>
    new ResearchError("RESEARCH_LLM_MALFORMED", `the model returned no usable output for ${sourceUrl}`, {
      fix: "run the research again; this document will be retried",
      retry: "retry",
    }),
  extractionSchema: (sourceUrl: string, detail: string) =>
    new ResearchError(
      "RESEARCH_EXTRACTION_SCHEMA",
      `the model's output for ${sourceUrl} did not match the schema (${detail})`,
      { fix: "run the research again; this document will be retried", retry: "retry" },
    ),
  runStale: (runId: number) =>
    new ResearchError("RESEARCH_RUN_STALE", `run ${runId} stopped sending heartbeats`, {
      fix: `npm run research -- --run ${runId}`,
      retry: "retry",
      sideEffects: "documents and claims processed so far are stored and will be skipped",
    }),
  invalidTransition: (what: string) =>
    new ResearchError("BRIEF_INVALID_TRANSITION", what, {
      fix: "reload the page and review the current version",
      retry: "fix_then_retry",
    }),
  unsupportedTopic: (topic: string) =>
    new ResearchError(
      "BRIEF_UNSUPPORTED_TOPIC",
      `topic "${topic}" has no approved claim behind it`,
      { fix: "approve a supporting claim or remove the topic, then approve again", retry: "fix_then_retry" },
    ),
  dbUnreachable: (host: string, cause?: unknown) =>
    new ResearchError("DB_UNREACHABLE", `cannot connect using DATABASE_URL (host ${host})`, {
      fix: "brew services start postgresql@17, then retry",
      retry: "fix_then_retry",
      cause,
    }),
  workerUnexpected: (runId: number, stage: string, traceFile: string, cause?: unknown) =>
    new ResearchError(
      "WORKER_UNEXPECTED",
      `run ${runId} failed unexpectedly in stage ${stage}. trace: ${traceFile}`,
      {
        fix: `npm run research -- --run ${runId}`,
        retry: "retry",
        sideEffects: "finished documents are stored and will be skipped",
        cause,
      },
    ),
};
