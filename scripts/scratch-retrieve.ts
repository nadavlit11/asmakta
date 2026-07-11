/**
 * Manual retrieval check against the active corpus version.
 *   npm run scratch:retrieve "כמה ימי חופשה מגיעים לי" [--rerank]
 * Requires VOYAGE_API_KEY + an ingested corpus.
 */
import { retrieve, DEFAULT_RETRIEVAL, type RetrievalConfig } from '../src/retrieve/retrieve.js';
import { getCorpusBySlug } from '../src/db/queries.js';
import { closePool } from '../src/db/client.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rerank = args.includes('--rerank');
  const q = args.filter((a) => !a.startsWith('--')).join(' ') || 'כמה ימי חופשה שנתית מגיעים לעובד';
  const corpus = await getCorpusBySlug('labor-rights');
  if (!corpus) throw new Error('corpus not found — run migrations + seed');

  const cfg: RetrievalConfig = {
    ...DEFAULT_RETRIEVAL,
    corpusId: corpus.id,
    corpusVersion: corpus.activeVersion,
    rerank,
  };
  const { chunks, embeddingTokens, rerankTokens } = await retrieve(q, cfg);
  console.log(`query: ${q}  (rerank=${rerank})`);
  console.log(`embedding tokens: ${embeddingTokens}, rerank tokens: ${rerankTokens}\n`);
  chunks.forEach((c, i) => {
    console.log(`#${i + 1}  sim=${c.similarity.toFixed(4)}  [chunk ${c.chunkId}] ${c.filename}${c.pageStart ? ` p.${c.pageStart}` : ''}${c.heading ? ` — ${c.heading}` : ''}`);
    console.log(`     ${c.content.slice(0, 120).replace(/\s+/g, ' ')}…`);
  });
  await closePool();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
