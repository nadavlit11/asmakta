/**
 * End-to-end manual check: retrieve + answer with the guardrail.
 *   npm run scratch:ask "מה שכר המינימום?"
 *   npm run scratch:ask "What is the minimum wage in France?"   # expect refusal
 * Requires ANTHROPIC_API_KEY + VOYAGE_API_KEY + an ingested corpus.
 */
import { retrieve, DEFAULT_RETRIEVAL, type RetrievalConfig } from '../src/retrieve/retrieve.js';
import { answer } from '../src/answer/answer.js';
import { getCorpusBySlug } from '../src/db/queries.js';
import { closePool } from '../src/db/client.js';

async function main(): Promise<void> {
  const q = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
  if (!q) {
    console.error('usage: npm run scratch:ask "<question>"');
    process.exit(1);
  }
  const corpus = await getCorpusBySlug('labor-rights');
  if (!corpus) throw new Error('corpus not found — run migrations + seed');

  const cfg: RetrievalConfig = {
    ...DEFAULT_RETRIEVAL,
    corpusId: corpus.id,
    corpusVersion: corpus.activeVersion,
  };
  const { chunks } = await retrieve(q, cfg);
  const a = await answer(q, chunks, {});

  console.log(`Q: ${q}\n`);
  console.log(a.refused ? `REFUSED: ${a.text}` : `A: ${a.text}`);
  if (a.citations.length) {
    console.log(`\ncitations: ${a.citations.map((c) => `#${c.chunkId}`).join(', ')}`);
  }
  console.log(`\nmodel: ${a.model}  cost: $${a.costUsd.toFixed(5)}  (${a.usage.inputTokens} in / ${a.usage.outputTokens} out)`);
  await closePool();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
