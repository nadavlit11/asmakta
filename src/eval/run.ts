/**
 * Eval harness orchestrator. For each fixture: retrieve -> answer -> (judge if
 * answerable+answered) -> deterministic rubric -> persist. Aggregates a pass-rate
 * with per-category + per-language breakdowns and a cost total, guarded by a hard
 * cap. See docs/plan.md §5.3. Requires ANTHROPIC_API_KEY + VOYAGE_API_KEY.
 */
import { getCorpusBySlug } from '../db/queries.js';
import { resolveModels } from '../config/models.js';
import { embeddingCost, rerankCost } from '../lib/cost.js';
import { retrieve, type RetrievalConfig } from '../retrieve/retrieve.js';
import { answer } from '../answer/answer.js';
import { judge } from './judge.js';
import { scoreFixture, aggregate, needsJudge, type Aggregate, type ScoredRow } from './rubric.js';
import { loadFixtures, createRun, insertResult, finalizeRun, type RunConfig, type FixtureRow } from './store.js';

export interface RunOptions {
  corpusSlug: string;
  config: RunConfig;
  gitSha?: string | null;
  maxCostUsd?: number;
}

export interface FixtureOutcome {
  fixtureId: number;
  question: string;
  category: string;
  lang: 'he' | 'en';
  refused: boolean;
  verdict: 'pass' | 'fail';
  judgeRationale: string | null;
  error?: string;
}

export interface RunSummary {
  runId: number;
  aggregate: Aggregate;
  costUsd: number;
  outcomes: FixtureOutcome[];
}

async function evalFixture(
  fixture: FixtureRow,
  retrievalCfg: RetrievalConfig,
  models: ReturnType<typeof resolveModels>,
): Promise<{ outcome: FixtureOutcome; scored: ScoredRow; cost: number; result: Parameters<typeof insertResult>[1] }> {
  const started = Date.now();
  const { chunks, embeddingTokens, rerankTokens } = await retrieve(fixture.question, retrievalCfg);
  const ans = await answer(fixture.question, chunks, { model: models.answering });

  let judgeCorrect: boolean | undefined;
  let judgeRationale: string | null = null;
  let judgeCost = 0;
  if (needsJudge(fixture, ans) && fixture.goldAnswer) {
    const cited = ans.citations
      .map((c) => chunks.find((x) => x.chunkId === c.chunkId)?.content)
      .filter((s): s is string => Boolean(s));
    const j = await judge({
      question: fixture.question,
      goldAnswer: fixture.goldAnswer,
      candidateAnswer: ans.text,
      citedChunkContents: cited,
    });
    judgeCorrect = j.verdict.correct;
    judgeRationale = j.verdict.rationale;
    judgeCost = j.costUsd;
  }

  const verdict = scoreFixture(fixture, ans, chunks, judgeCorrect);
  const cost =
    embeddingCost(models.embedding, embeddingTokens) +
    rerankCost(models.rerank, rerankTokens) +
    ans.costUsd +
    judgeCost;
  const latencyMs = Date.now() - started;

  return {
    outcome: {
      fixtureId: fixture.id,
      question: fixture.question,
      category: fixture.category,
      lang: fixture.lang,
      refused: ans.refused,
      verdict: verdict.verdict,
      judgeRationale,
    },
    scored: { category: fixture.category, lang: fixture.lang, verdict: verdict.verdict },
    cost,
    result: {
      fixtureId: fixture.id,
      refused: ans.refused,
      answer: ans.text,
      citations: ans.citations,
      retrievedChunkIds: chunks.map((c) => c.chunkId),
      verdict,
      judgeRationale,
      latencyMs,
      costUsd: cost,
    },
  };
}

export async function runEval(opts: RunOptions): Promise<RunSummary> {
  const corpus = await getCorpusBySlug(opts.corpusSlug);
  if (!corpus) throw new Error(`corpus not found: ${opts.corpusSlug}`);
  const models = resolveModels();
  const fixtures = await loadFixtures(corpus.id);
  if (fixtures.length === 0) throw new Error('no fixtures — run `npm run seed:fixtures`');

  const retrievalCfg: RetrievalConfig = {
    corpusId: corpus.id,
    corpusVersion: corpus.activeVersion,
    topK: opts.config.topK,
    minSimilarity: opts.config.minSimilarity,
    rerank: opts.config.rerank,
    rerankTopN: opts.config.rerankTopN,
  };

  const runId = await createRun({
    corpusId: corpus.id,
    corpusVersion: corpus.activeVersion,
    gitSha: opts.gitSha ?? null,
    answeringModel: models.answering,
    judgeModel: models.judge,
    embeddingModel: models.embedding,
    config: opts.config,
  });

  const cap = opts.maxCostUsd ?? Infinity;
  const scored: ScoredRow[] = [];
  const outcomes: FixtureOutcome[] = [];
  let totalCost = 0;

  try {
    for (const fixture of fixtures) {
      try {
        const { outcome, scored: s, cost, result } = await evalFixture(fixture, retrievalCfg, models);
        await insertResult(runId, result);
        outcomes.push(outcome);
        scored.push(s);
        totalCost += cost;
      } catch (err) {
        const message = (err as Error).message;
        // Record a failed outcome and keep going, so one API blip doesn't void the run.
        outcomes.push({
          fixtureId: fixture.id,
          question: fixture.question,
          category: fixture.category,
          lang: fixture.lang,
          refused: false,
          verdict: 'fail',
          judgeRationale: null,
          error: message,
        });
        scored.push({ category: fixture.category, lang: fixture.lang, verdict: 'fail' });
      }
      if (totalCost > cap) {
        throw new Error(`Eval aborted: cost $${totalCost.toFixed(4)} exceeded cap $${cap.toFixed(2)} (EVAL_MAX_COST_USD).`);
      }
    }
  } catch (err) {
    const agg = aggregate(scored);
    await finalizeRun(runId, agg, totalCost, 'failed');
    throw err;
  }

  const agg = aggregate(scored);
  await finalizeRun(runId, agg, totalCost, 'completed');
  return { runId, aggregate: agg, costUsd: totalCost, outcomes };
}
