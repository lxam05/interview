import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { errors } from "../errors";
import { extractionSchema, type ExtractionLlm } from "../extract";
import type { Usage } from "../types";

/** US dollars per million tokens. Used only to track spend. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export const DEFAULT_EXTRACTION_MODEL = "claude-haiku-5-5";
export const DEFAULT_RATIONALE_MODEL = "claude-opus-5-5";

function costOf(model: string, usage: Anthropic.Usage): Usage {
  const price = PRICES[model];
  const inputTokens =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  const outputTokens = usage.output_tokens;
  return {
    inputTokens,
    outputTokens,
    // An unknown model is recorded with zero cost rather than a guessed price.
    costUsd: price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : 0,
  };
}

function toResearchError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    throw errors.adapterAuth("anthropic", "ANTHROPIC_API_KEY");
  }
  if (err instanceof Anthropic.RateLimitError) throw errors.llmTransient("rate limited", err);
  if (err instanceof Anthropic.APIConnectionError) throw errors.llmTransient("connection failed", err);
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) {
    throw errors.llmTransient(`HTTP ${err.status}`, err);
  }
  throw err;
}

/** Extraction through the Claude API with schema-constrained output. */
export function createAnthropicExtractor(
  opts: { model?: string; client?: Anthropic } = {},
): ExtractionLlm {
  const model = opts.model ?? DEFAULT_EXTRACTION_MODEL;
  const client = opts.client ?? new Anthropic({ maxRetries: 3 });
  return {
    model,
    async extract({ system, user }) {
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: 16000,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { format: zodOutputFormat(extractionSchema) },
        });
        return {
          output: response.parsed_output ?? null,
          refused: response.stop_reason === "refusal",
          usage: costOf(model, response.usage),
        };
      } catch (err) {
        toResearchError(err);
      }
    },
  };
}

const rationaleSchema = z.object({
  rationales: z.array(z.object({ topicSlug: z.string(), why: z.string() })),
});

export interface RationaleWriter {
  model: string;
  /** One sentence per topic, written only from the statements given. */
  write(
    topics: { topicSlug: string; name: string; statements: string[] }[],
  ): Promise<{ rationales: Map<string, string>; usage: Usage }>;
}

/**
 * Writes the "why this topic" sentence. The model sees only the reviewed
 * claim statements and cannot add topics: output for unknown slugs is ignored,
 * and any failure falls back to the template sentence in synthesise.ts.
 */
export function createAnthropicRationaleWriter(
  opts: { model?: string; client?: Anthropic } = {},
): RationaleWriter {
  const model = opts.model ?? DEFAULT_RATIONALE_MODEL;
  const client = opts.client ?? new Anthropic({ maxRetries: 3 });
  return {
    model,
    async write(topics) {
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: 16000,
          output_config: { effort: "low", format: zodOutputFormat(rationaleSchema) },
          system:
            "For each topic you are given statements that reviewed sources made about a company's internship interviews. Write one plain sentence per topic (at most 30 words) telling a student why the topic is worth studying, using only what the statements say. Do not add facts, numbers, dates or certainty the statements do not contain. Say 'candidates report' rather than stating things as guaranteed.",
          messages: [{ role: "user", content: JSON.stringify(topics) }],
        });
        const allowed = new Set(topics.map((t) => t.topicSlug));
        const rationales = new Map<string, string>();
        if (response.stop_reason !== "refusal") {
          for (const r of response.parsed_output?.rationales ?? []) {
            if (allowed.has(r.topicSlug) && r.why.trim()) rationales.set(r.topicSlug, r.why.trim());
          }
        }
        return { rationales, usage: costOf(model, response.usage) };
      } catch (err) {
        toResearchError(err);
      }
    },
  };
}
