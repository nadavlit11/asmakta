/**
 * Seed the labor-rights corpus from corpus/labor-rights/*.md.
 *   npm run seed:corpus            # parse+chunk+embed+store (needs VOYAGE_API_KEY)
 *   npm run seed:corpus -- --dry   # parse+chunk only, per-file stats (no key)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { parseDocument } from '../src/ingest/parse/index.js';
import { chunkDocument } from '../src/ingest/chunk.js';
import { ingestBatch } from '../src/ingest/index.js';
import { getCorpusBySlug } from '../src/db/queries.js';
import { DEFAULT_CHUNK_STRATEGY, type Lang, type RawDocument } from '../src/ingest/types.js';
import { closePool } from '../src/db/client.js';

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'corpus', 'labor-rights');

function langFromName(name: string): Lang | undefined {
  if (name.includes('.he.')) return 'he';
  if (name.includes('.en.')) return 'en';
  return undefined;
}

function loadFiles(): { filename: string; bytes: Buffer; declaredLang?: Lang }[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .sort()
    .map((f) => ({ filename: f, bytes: readFileSync(join(CORPUS_DIR, f)), declaredLang: langFromName(f) }));
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const files = loadFiles();
  console.log(`corpus dir: ${CORPUS_DIR}`);
  console.log(`files: ${files.length}\n`);

  if (dry) {
    let total = 0;
    for (const f of files) {
      const parsed = await parseDocument({ corpusId: 0, version: 1, filename: basename(f.filename), mimeType: 'text/markdown', bytes: f.bytes, declaredLang: f.declaredLang });
      const chunks = chunkDocument(parsed, DEFAULT_CHUNK_STRATEGY, { documentId: 0, corpusId: 0, corpusVersion: 1 });
      total += chunks.length;
      console.log(`  ${f.filename.padEnd(28)} lang=${parsed.detectedLang.padEnd(5)} chars=${String(parsed.charCount).padStart(5)} chunks=${chunks.length}`);
    }
    console.log(`\n[dry] total chunks: ${total}`);
    return;
  }

  const corpus = await getCorpusBySlug('labor-rights');
  if (!corpus) throw new Error('corpus not found — run `npm run migrate`');
  const raws: RawDocument[] = files.map((f) => ({
    corpusId: corpus.id,
    version: corpus.activeVersion,
    filename: f.filename,
    mimeType: 'text/markdown',
    bytes: f.bytes,
    declaredLang: f.declaredLang,
  }));

  const results = await ingestBatch(raws);
  for (const r of results) {
    console.log(`  ${r.filename.padEnd(28)} ${r.status.padEnd(8)} chunks=${r.chunkCount}${r.error ? `  (${r.error})` : ''}`);
  }
  const indexed = results.filter((r) => r.status === 'indexed').length;
  const chunks = results.reduce((s, r) => s + r.chunkCount, 0);
  const cost = results.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  console.log(`\nindexed ${indexed}/${results.length} docs, ${chunks} chunks, embedding cost $${cost.toFixed(5)}`);
  await closePool();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
