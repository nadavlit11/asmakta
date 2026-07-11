/**
 * `npm run eval` — run the eval suite against the active corpus version, print
 * the pass-rate + per-category/-language breakdown, and EXIT NON-ZERO if the
 * overall pass-rate is below EVAL_TARGET_PASS_RATE. This is the gate that lets
 * the eval "test" the retrieval/prompt commits. Requires both API keys.
 *
 *   npm run eval               # default config
 *   npm run eval -- --rerank   # with rerank-2.5
 */
import { execSync } from 'node:child_process';
import { loadEnv } from '../config/env.js';
import { closePool } from '../db/client.js';
import { DEFAULT_RETRIEVAL } from '../retrieve/retrieve.js';
import { runEval } from './run.js';
import { isMainModule } from '../lib/runtime.js';

function gitSha(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const rerank = process.argv.includes('--rerank');
  const target = env.EVAL_TARGET_PASS_RATE;

  const summary = await runEval({
    corpusSlug: 'labor-rights',
    gitSha: gitSha(),
    maxCostUsd: env.EVAL_MAX_COST_USD,
    config: {
      topK: DEFAULT_RETRIEVAL.topK,
      minSimilarity: DEFAULT_RETRIEVAL.minSimilarity,
      rerank,
      rerankTopN: DEFAULT_RETRIEVAL.rerankTopN,
    },
  });

  const { aggregate: agg, costUsd, runId, outcomes } = summary;

  console.log(`\nEval run #${runId}  (rerank=${rerank})`);
  console.log('─'.repeat(48));
  for (const [key, tally] of Object.entries(agg.byCategory)) {
    console.log(`  ${key.padEnd(16)} ${tally.passed}/${tally.total}  ${pct(tally.total ? tally.passed / tally.total : 0)}`);
  }
  console.log('─'.repeat(48));
  console.log(`  OVERALL          ${agg.passed}/${agg.total}  ${pct(agg.passRate)}   (target ${pct(target)})`);
  console.log(`  cost             $${costUsd.toFixed(4)}`);

  const failures = outcomes.filter((o) => o.verdict === 'fail');
  if (failures.length) {
    console.log(`\nFailures (${failures.length}):`);
    for (const f of failures) {
      console.log(`  [${f.category}/${f.lang}] ${f.question.slice(0, 70)}`);
      if (f.error) console.log(`      error: ${f.error}`);
      else if (f.judgeRationale) console.log(`      judge: ${f.judgeRationale}`);
    }
  }

  await closePool();

  const passed = agg.passRate >= target;
  console.log(`\n${passed ? 'PASS' : 'FAIL'}: pass-rate ${pct(agg.passRate)} ${passed ? '>=' : '<'} target ${pct(target)}`);
  process.exit(passed ? 0 : 1);
}

if (isMainModule(import.meta.url)) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
