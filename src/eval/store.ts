/** Eval-specific DB helpers: load fixtures, persist runs + results. */
import { query } from '../db/client.js';
import type { Category, Aggregate, Verdict } from './rubric.js';
import type { Citation } from '../answer/answer.js';

export interface FixtureRow {
  id: number;
  question: string;
  lang: 'he' | 'en';
  category: Category;
  isAnswerable: boolean;
  goldAnswer: string | null;
  expectedDocFilenames: string[];
}

export async function loadFixtures(corpusId: number): Promise<FixtureRow[]> {
  const { rows } = await query<{
    id: string; question: string; lang: string; category: string;
    is_answerable: boolean; gold_answer: string | null; expected_doc_filenames: string[];
  }>(
    `SELECT id, question, lang, category, is_answerable, gold_answer, expected_doc_filenames
     FROM eval_fixtures WHERE corpus_id = $1 ORDER BY id`,
    [corpusId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    question: r.question,
    lang: r.lang === 'he' ? 'he' : 'en',
    category: r.category as Category,
    isAnswerable: r.is_answerable,
    goldAnswer: r.gold_answer,
    expectedDocFilenames: r.expected_doc_filenames ?? [],
  }));
}

export interface RunConfig {
  topK: number;
  minSimilarity: number;
  rerank: boolean;
  rerankTopN?: number;
}

export interface NewRun {
  corpusId: number;
  corpusVersion: number;
  gitSha: string | null;
  answeringModel: string;
  judgeModel: string;
  embeddingModel: string;
  config: RunConfig;
}

export async function createRun(run: NewRun): Promise<number> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO eval_runs (corpus_id, corpus_version, git_sha, answering_model, judge_model, embedding_model, config, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'running') RETURNING id`,
    [run.corpusId, run.corpusVersion, run.gitSha, run.answeringModel, run.judgeModel, run.embeddingModel, JSON.stringify(run.config)],
  );
  return Number(rows[0]!.id);
}

export interface ResultRow {
  fixtureId: number;
  refused: boolean;
  answer: string;
  citations: Citation[];
  retrievedChunkIds: number[];
  verdict: Verdict;
  judgeRationale: string | null;
  latencyMs: number;
  costUsd: number;
}

export async function insertResult(runId: number, r: ResultRow): Promise<void> {
  await query(
    `INSERT INTO eval_results
       (run_id, fixture_id, refused, answer, citations, retrieved_chunk_ids,
        answer_correct, citation_valid, refusal_correct, verdict, judge_rationale, latency_ms, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      runId, r.fixtureId, r.refused, r.answer, JSON.stringify(r.citations), r.retrievedChunkIds,
      r.verdict.answerCorrect, r.verdict.citationValid, r.verdict.refusalCorrect, r.verdict.verdict,
      r.judgeRationale, r.latencyMs, r.costUsd,
    ],
  );
}

export async function finalizeRun(
  runId: number,
  agg: Aggregate,
  costUsd: number,
  status: 'completed' | 'failed',
): Promise<void> {
  await query(
    `UPDATE eval_runs
     SET total = $2, passed = $3, failed = $4, pass_rate = $5, by_category = $6,
         cost_usd = $7, status = $8, finished_at = now()
     WHERE id = $1`,
    [runId, agg.total, agg.passed, agg.failed, agg.passRate, JSON.stringify(agg.byCategory), costUsd, status],
  );
}
