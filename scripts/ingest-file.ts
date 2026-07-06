/**
 * Ingest a single file into a corpus.
 *   npm run ingest -- <path> [--corpus labor-rights] [--dry]
 *
 * --dry runs parse + chunk only (no embedding, no DB writes) so the pipeline can
 * be verified without a VOYAGE_API_KEY. Full ingest requires the key + DATABASE_URL.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseDocument } from '../src/ingest/parse/index.js';
import { chunkDocument } from '../src/ingest/chunk.js';
import { ingestDocument } from '../src/ingest/index.js';
import { getCorpusBySlug } from '../src/db/queries.js';
import { DEFAULT_CHUNK_STRATEGY, type RawDocument } from '../src/ingest/types.js';
import { closePool } from '../src/db/client.js';

function mimeFor(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return (
    { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', html: 'text/html', htm: 'text/html', md: 'text/markdown', markdown: 'text/markdown', txt: 'text/markdown' }[ext] ?? 'application/octet-stream'
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const corpusIdx = args.indexOf('--corpus');
  const corpusSlug = corpusIdx >= 0 ? args[corpusIdx + 1] ?? 'labor-rights' : 'labor-rights';
  const path = args.find((a) => !a.startsWith('--') && a !== corpusSlug);
  if (!path) {
    console.error('usage: npm run ingest -- <path> [--corpus <slug>] [--dry]');
    process.exit(1);
  }

  const bytes = readFileSync(path);
  const filename = basename(path);

  if (dry) {
    const parsed = await parseDocument({ corpusId: 0, version: 1, filename, mimeType: mimeFor(path), bytes });
    const chunks = chunkDocument(parsed, DEFAULT_CHUNK_STRATEGY, { documentId: 0, corpusId: 0, corpusVersion: 1 });
    console.log(`[dry] ${filename}`);
    console.log(`  lang:   ${parsed.detectedLang}`);
    console.log(`  pages:  ${parsed.pages?.length ?? '—'}`);
    console.log(`  chars:  ${parsed.charCount}`);
    console.log(`  chunks: ${chunks.length}`);
    const tokens = chunks.map((c) => c.tokenCount);
    if (tokens.length) {
      console.log(`  chunk tokens: min ${Math.min(...tokens)}, max ${Math.max(...tokens)}, avg ${Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length)}`);
    }
    const headings = [...new Set(chunks.map((c) => c.heading).filter(Boolean))];
    if (headings.length) console.log(`  headings: ${headings.slice(0, 8).join(' | ')}`);
    return;
  }

  const corpus = await getCorpusBySlug(corpusSlug);
  if (!corpus) throw new Error(`corpus not found: ${corpusSlug} (run migrations)`);
  const raw: RawDocument = { corpusId: corpus.id, version: corpus.activeVersion, filename, mimeType: mimeFor(path), bytes };
  const result = await ingestDocument(raw);
  console.log(JSON.stringify(result, null, 2));
  await closePool();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
