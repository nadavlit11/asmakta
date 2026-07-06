/**
 * Answer generation with the hard guardrail. See docs/plan.md §4.2.
 *
 * Guardrail enforcement (belt + suspenders):
 *  1. Deterministic short-circuit: no retrieved sources -> canned refusal, no LLM call.
 *  2. Model instructed to refuse when sources don't answer + only cite provided ids.
 *  3. Post-validation: drop invented citations; if a non-refused answer ends up
 *     with zero valid citations, force a refusal (no source, no answer).
 */
import { detectChunkLang } from '../lib/tokens.js';
import { resolveModels } from '../config/models.js';
import { chatStructured, type ChatUsage } from '../lib/anthropic.js';
import type { RetrievedChunk } from '../retrieve/retrieve.js';
import { AnswerSchema, buildAnswerSystemPrompt, buildUserPrompt, refusalString } from './prompt.js';

export interface Citation {
  chunkId: number;
  quote?: string;
}

export interface Answer {
  refused: boolean;
  text: string;
  citations: Citation[];
  usage: ChatUsage;
  costUsd: number;
  model: string;
}

export interface AnswerConfig {
  model?: string;
  maxTokens?: number;
}

/** Keep only citation ids that exist in the retrieved set; dedupe. Pure. */
export function validateCitations(ids: number[], retrieved: RetrievedChunk[]): number[] {
  const allowed = new Set(retrieved.map((c) => c.chunkId));
  return [...new Set(ids)].filter((id) => allowed.has(id));
}

function refuse(lang: 'he' | 'en', model: string, usage: ChatUsage, costUsd: number): Answer {
  return { refused: true, text: refusalString(lang), citations: [], usage, costUsd, model };
}

const ZERO_USAGE: ChatUsage = { inputTokens: 0, outputTokens: 0 };

export async function answer(
  question: string,
  retrieved: RetrievedChunk[],
  cfg: AnswerConfig = {},
): Promise<Answer> {
  const model = cfg.model ?? resolveModels().answering;
  const lang = detectChunkLang(question);

  // (1) No source above threshold -> deterministic refusal, no LLM call.
  if (retrieved.length === 0) {
    return refuse(lang, model, ZERO_USAGE, 0);
  }

  const { parsed, usage, costUsd } = await chatStructured({
    model,
    system: buildAnswerSystemPrompt(),
    user: buildUserPrompt(question, retrieved),
    schema: AnswerSchema,
    maxTokens: cfg.maxTokens ?? 1024,
  });

  // (2) Model chose to refuse.
  if (parsed.refused) {
    return refuse(lang, model, usage, costUsd);
  }

  // (3) Drop invented citations; enforce "no source, no answer".
  const validIds = validateCitations(parsed.citations, retrieved);
  if (validIds.length === 0) {
    return refuse(lang, model, usage, costUsd);
  }

  return {
    refused: false,
    text: parsed.answer,
    citations: validIds.map((chunkId) => ({ chunkId })),
    usage,
    costUsd,
    model,
  };
}
