/**
 * LLM judge for answer-correctness. Only invoked for answerable + answered
 * fixtures (refusal/citation checks are deterministic — see rubric.ts). Grades
 * against the gold answer + explicit criteria to reduce self-preference bias.
 * See docs/plan.md §5.2. Requires ANTHROPIC_API_KEY.
 */
import { z } from 'zod/v4';
import { chatStructured, type ChatUsage } from '../lib/anthropic.js';
import { resolveModels } from '../config/models.js';

export const JudgeSchema = z.object({
  correct: z.boolean().describe('true if the candidate is factually correct relative to the gold answer'),
  rationale: z.string().describe('one or two sentences explaining the verdict'),
});
export type JudgeVerdict = z.infer<typeof JudgeSchema>;

const JUDGE_SYSTEM = [
  'You grade whether a candidate answer is FACTUALLY CORRECT relative to a gold answer,',
  'for a question about Israeli labor and employment law.',
  '',
  'Grade ONLY factual correctness — not style, length, or language. Hebrew and',
  'English answers are equally acceptable.',
  '',
  'The candidate is correct if it conveys the key facts of the gold answer without',
  'contradicting them and without adding unsupported factual claims. Minor omissions',
  'of secondary detail are acceptable; a wrong number or a contradicted fact is not.',
  '',
  'Return { "correct": boolean, "rationale": string }.',
].join('\n');

export interface JudgeInput {
  question: string;
  goldAnswer: string;
  candidateAnswer: string;
  citedChunkContents: string[];
}

export async function judge(
  input: JudgeInput,
  model = resolveModels().judge,
): Promise<{ verdict: JudgeVerdict; usage: ChatUsage; costUsd: number; model: string }> {
  const user = [
    `Question:\n${input.question}`,
    '',
    `Gold answer:\n${input.goldAnswer}`,
    '',
    `Candidate answer:\n${input.candidateAnswer}`,
    '',
    'Source excerpts the candidate was allowed to use:',
    input.citedChunkContents.length ? input.citedChunkContents.map((c, i) => `[${i + 1}] ${c}`).join('\n') : '(none cited)',
  ].join('\n');

  const { parsed, usage, costUsd, model: used } = await chatStructured({
    model,
    system: JUDGE_SYSTEM,
    user,
    schema: JudgeSchema,
    maxTokens: 512,
  });
  return { verdict: parsed, usage, costUsd, model: used };
}
