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

// ---- Read side (powers the API + the public eval report page) ----

export interface RunSummary {
  id: number;
  gitSha: string | null;
  answeringModel: string;
  judgeModel: string;
  embeddingModel: string;
  config: RunConfig;
  total: number;
  passed: number;
  failed: number;
  passRate: number | null;
  byCategory: Record<string, { passed: number; total: number }> | null;
  costUsd: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}

interface RawRun {
  id: string; git_sha: string | null; answering_model: string; judge_model: string;
  embedding_model: string; config: RunConfig; total: number; passed: number; failed: number;
  pass_rate: string | null; by_category: Record<string, { passed: number; total: number }> | null;
  cost_usd: string; status: string; started_at: string; finished_at: string | null;
}

function mapRun(r: RawRun): RunSummary {
  return {
    id: Number(r.id),
    gitSha: r.git_sha,
    answeringModel: r.answering_model,
    judgeModel: r.judge_model,
    embeddingModel: r.embedding_model,
    config: r.config,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    passRate: r.pass_rate === null ? null : Number(r.pass_rate),
    byCategory: r.by_category,
    costUsd: Number(r.cost_usd),
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export async function listRuns(corpusId: number, limit = 50): Promise<RunSummary[]> {
  const { rows } = await query<RawRun>(
    `SELECT * FROM eval_runs WHERE corpus_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [corpusId, limit],
  );
  return rows.map(mapRun);
}

export async function getRun(runId: number): Promise<RunSummary | null> {
  const { rows } = await query<RawRun>(`SELECT * FROM eval_runs WHERE id = $1`, [runId]);
  return rows[0] ? mapRun(rows[0]) : null;
}

export async function getLatestCompletedRun(corpusId: number): Promise<RunSummary | null> {
  const { rows } = await query<RawRun>(
    `SELECT * FROM eval_runs WHERE corpus_id = $1 AND status = 'completed' ORDER BY started_at DESC LIMIT 1`,
    [corpusId],
  );
  return rows[0] ? mapRun(rows[0]) : null;
}

export interface ResultDetail {
  fixtureId: number;
  question: string;
  category: string;
  lang: string;
  refused: boolean;
  verdict: string;
  answerCorrect: boolean;
  citationValid: boolean;
  refusalCorrect: boolean;
  judgeRationale: string | null;
}

export async function getRunResults(runId: number): Promise<ResultDetail[]> {
  const { rows } = await query<{
    fixture_id: string; question: string; category: string; lang: string;
    refused: boolean; verdict: string; answer_correct: boolean; citation_valid: boolean;
    refusal_correct: boolean; judge_rationale: string | null;
  }>(
    `SELECT r.fixture_id, f.question, f.category, f.lang, r.refused, r.verdict,
            r.answer_correct, r.citation_valid, r.refusal_correct, r.judge_rationale
     FROM eval_results r JOIN eval_fixtures f ON f.id = r.fixture_id
     WHERE r.run_id = $1 ORDER BY f.category, f.lang, r.fixture_id`,
    [runId],
  );
  return rows.map((r) => ({
    fixtureId: Number(r.fixture_id),
    question: r.question,
    category: r.category,
    lang: r.lang,
    refused: r.refused,
    verdict: r.verdict,
    answerCorrect: r.answer_correct,
    citationValid: r.citation_valid,
    refusalCorrect: r.refusal_correct,
    judgeRationale: r.judge_rationale,
  }));
}
