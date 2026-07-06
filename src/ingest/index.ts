/**
 * Ingestion orchestrator: parse -> chunk -> embed -> store, advancing the
 * document status at each stage and recording the failure reason (which surfaces
 * in the admin failed-parse queue). See docs/plan.md §3.
 */
import { createHash } from 'node:crypto';
import { withTransaction } from '../db/client.js';
import { createDocument, updateDocument, insertChunks, setActiveVersion, getCorpusBySlug } from '../db/queries.js';
import { embeddingCost } from '../lib/cost.js';
import { parseDocument } from './parse/index.js';
import { chunkDocument } from './chunk.js';
import { embedChunks } from './embed.js';
import { DEFAULT_CHUNK_STRATEGY, type ChunkStrategy, type DocStatus, type RawDocument } from './types.js';

export interface IngestResult {
  documentId: number | null;
  status: DocStatus | 'skipped';
  chunkCount: number;
  filename: string;
  error?: string;
  totalTokens?: number;
  costUsd?: number;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function ingestDocument(
  raw: RawDocument,
  cfg: ChunkStrategy = DEFAULT_CHUNK_STRATEGY,
): Promise<IngestResult> {
  const digest = sha256(raw.bytes);
  const documentId = await createDocument({
    corpusId: raw.corpusId,
    version: raw.version,
    filename: raw.filename,
    mimeType: raw.mimeType,
    sourceLang: raw.declaredLang ?? 'mixed',
    sha256: digest,
  });

  if (documentId === null) {
    return { documentId: null, status: 'skipped', chunkCount: 0, filename: raw.filename, error: 'duplicate (same content already ingested for this version)' };
  }

  try {
    await updateDocument(documentId, { status: 'parsing' });
    const parsed = await parseDocument(raw);
    await updateDocument(documentId, {
      status: 'chunking',
      sourceLang: parsed.detectedLang,
      pageCount: parsed.pages?.length ?? null,
      charCount: parsed.charCount,
    });

    const chunks = chunkDocument(parsed, cfg, {
      documentId,
      corpusId: raw.corpusId,
      corpusVersion: raw.version,
    });
    if (chunks.length === 0) throw new Error('chunking produced no chunks');

    await updateDocument(documentId, { status: 'embedding' });
    const { embedded, totalTokens, model } = await embedChunks(chunks);

    await withTransaction(async (client) => {
      await insertChunks(client, embedded);
    });
    await updateDocument(documentId, { status: 'indexed', indexed: true });

    return {
      documentId,
      status: 'indexed',
      chunkCount: chunks.length,
      filename: raw.filename,
      totalTokens,
      costUsd: embeddingCost(model, totalTokens),
    };
  } catch (err) {
    const message = (err as Error).message;
    await updateDocument(documentId, { status: 'failed', error: message });
    return { documentId, status: 'failed', chunkCount: 0, filename: raw.filename, error: message };
  }
}

export async function ingestBatch(raws: RawDocument[], cfg?: ChunkStrategy): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const raw of raws) {
    results.push(await ingestDocument(raw, cfg));
  }
  return results;
}

/**
 * Re-ingest a whole corpus at a fresh version, then flip the active pointer.
 * `loadRaws(version)` supplies the RawDocuments for the new version.
 */
export async function reingestCorpus(
  slug: string,
  loadRaws: (corpusId: number, version: number) => Promise<RawDocument[]>,
  cfg?: ChunkStrategy,
): Promise<{ version: number; results: IngestResult[] }> {
  const corpus = await getCorpusBySlug(slug);
  if (!corpus) throw new Error(`corpus not found: ${slug}`);
  const version = corpus.activeVersion + 1;
  const raws = await loadRaws(corpus.id, version);
  const results = await ingestBatch(raws, cfg);
  const anyIndexed = results.some((r) => r.status === 'indexed');
  if (anyIndexed) await setActiveVersion(corpus.id, version);
  return { version, results };
}
