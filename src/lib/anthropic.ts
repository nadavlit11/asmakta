/**
 * Anthropic client wrapper. Structured outputs via messages.parse + zod so the
 * answer/judge responses are machine-validated. Throws a clear error if
 * ANTHROPIC_API_KEY is missing so pure-logic paths run without it.
 *
 * We deliberately omit `thinking`, `temperature`, etc.: for grounded Q&A over a
 * few retrieved chunks and rubric grading, the default request is sufficient and
 * maximally version-portable (Sonnet 5 / Opus 4.8 reject sampling params).
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// zod/v4 subpath: the SDK's zodOutputFormat is typed against zod v4. zod 3.25+
// ships both APIs; SDK-facing schemas use v4, app config (env.ts) stays classic.
import type { z } from 'zod/v4';
import { loadEnv } from '../config/env.js';
import { chatCost } from './cost.js';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — required for answering/judging. See .env.example.');
  }
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResult<T> {
  parsed: T;
  usage: ChatUsage;
  costUsd: number;
  model: string;
}

/** One structured-output Claude call. Returns the validated object + usage/cost. */
export async function chatStructured<T extends z.ZodType>(opts: {
  model: string;
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
}): Promise<StructuredResult<z.infer<T>>> {
  const message = await getClient().messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    output_config: { format: zodOutputFormat(opts.schema) },
  });

  if (message.stop_reason === 'refusal') {
    throw new Error(`Model refused the request (stop_reason=refusal).`);
  }
  const parsed = message.parsed_output as z.infer<T> | null;
  if (parsed === null) {
    throw new Error(`Structured parse failed (stop_reason=${message.stop_reason ?? 'unknown'}).`);
  }

  const usage: ChatUsage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
  return { parsed, usage, costUsd: chatCost(opts.model, usage.inputTokens, usage.outputTokens), model: opts.model };
}
