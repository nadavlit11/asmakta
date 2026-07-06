/**
 * Answer prompt + guardrail schema. The guardrail (no source -> no answer, never
 * an invented citation) is stated to the model AND enforced deterministically in
 * answer.ts. See docs/plan.md §4.2.
 */
import { z } from 'zod/v4'; // v4 schema — passed to the Anthropic SDK's zodOutputFormat
import type { RetrievedChunk } from '../retrieve/retrieve.js';

export const CORPUS_SUBJECT = 'Israeli labor and employment rights';

/** Structured answer the model must return. */
export const AnswerSchema = z.object({
  refused: z.boolean().describe('true if the sources do not contain the answer'),
  answer: z.string().describe('the answer text, in the same language as the question; empty when refused'),
  citations: z.array(z.number().int()).describe('chunk ids from the provided sources that support the answer; empty when refused'),
});
export type StructuredAnswer = z.infer<typeof AnswerSchema>;

export const REFUSAL: Record<'he' | 'en', string> = {
  en: "I don't have this in the corpus.",
  he: 'המידע הזה לא נמצא במאגר.',
};

export function refusalString(lang: 'he' | 'en'): string {
  return REFUSAL[lang];
}

export function buildAnswerSystemPrompt(): string {
  return [
    `You answer questions about ${CORPUS_SUBJECT}, using ONLY the provided <sources>.`,
    '',
    'Rules:',
    '1. Use ONLY the provided sources. Never use outside knowledge.',
    '2. Every factual claim must be supported by a source. Put the supporting chunk id(s) in "citations".',
    '3. If the sources do NOT contain the answer, set "refused": true, leave "answer" empty, and return an empty "citations" array.',
    '4. NEVER cite a chunk id that is not present in the provided sources.',
    '5. Answer in the SAME language as the question (a Hebrew question gets a Hebrew answer).',
    '6. Be concise and factual. Do not speculate.',
    '',
    'Each source is given as: [#<chunkId>] <content>.',
  ].join('\n');
}

export function formatSources(retrieved: RetrievedChunk[]): string {
  return retrieved.map((c) => `[#${c.chunkId}] ${c.content}`).join('\n\n');
}

export function buildUserPrompt(question: string, retrieved: RetrievedChunk[]): string {
  return [`<sources>`, formatSources(retrieved), `</sources>`, '', `Question: ${question}`].join('\n');
}
