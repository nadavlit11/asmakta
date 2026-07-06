/** Eval: trigger runs (admin) + read runs/results/fixtures. See docs/plan.md §6. */
import type { FastifyInstance } from 'fastify';
import { getCorpusBySlug } from '../../db/queries.js';
import { loadEnv } from '../../config/env.js';
import { DEFAULT_RETRIEVAL } from '../../retrieve/retrieve.js';
import { runEval } from '../../eval/run.js';
import { listRuns, getRun, getRunResults, getLatestCompletedRun, loadFixtures } from '../../eval/store.js';
import { requireAdmin } from '../auth.js';

const DEFAULT_SLUG = 'labor-rights';

export async function evalRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/eval/run  (admin, async) -> kicks off a run, returns 202
  app.post<{ Body?: { rerank?: boolean } }>('/run', { preHandler: requireAdmin }, async (req, reply) => {
    const corpus = await getCorpusBySlug(DEFAULT_SLUG);
    if (!corpus) return reply.code(404).send({ error: 'corpus not found' });
    const env = loadEnv();
    const rerank = req.body?.rerank ?? false;

    // Fire-and-forget; the new run appears in GET /runs. Errors are logged.
    void runEval({
      corpusSlug: DEFAULT_SLUG,
      gitSha: null,
      maxCostUsd: env.EVAL_MAX_COST_USD,
      config: { topK: DEFAULT_RETRIEVAL.topK, minSimilarity: DEFAULT_RETRIEVAL.minSimilarity, rerank, rerankTopN: DEFAULT_RETRIEVAL.rerankTopN },
    }).catch((err) => app.log.error(err));

    return reply.code(202).send({ status: 'started' });
  });

  // GET /api/eval/runs  (history)
  app.get('/runs', async () => {
    const corpus = await getCorpusBySlug(DEFAULT_SLUG);
    if (!corpus) return { runs: [] };
    return { runs: await listRuns(corpus.id) };
  });

  // GET /api/eval/latest  (powers the public report page)
  app.get('/latest', async () => {
    const corpus = await getCorpusBySlug(DEFAULT_SLUG);
    if (!corpus) return { run: null };
    return { run: await getLatestCompletedRun(corpus.id) };
  });

  // GET /api/eval/runs/:id  (run + per-fixture results)
  app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const run = await getRun(Number(req.params.id));
    if (!run) return reply.code(404).send({ error: 'run not found' });
    return { run, results: await getRunResults(run.id) };
  });

  // GET /api/eval/fixtures  (admin)
  app.get('/fixtures', { preHandler: requireAdmin }, async () => {
    const corpus = await getCorpusBySlug(DEFAULT_SLUG);
    if (!corpus) return { fixtures: [] };
    return { fixtures: await loadFixtures(corpus.id) };
  });
}
