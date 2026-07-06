/**
 * Typed SQL helpers for corpora / documents / chunks. Retrieval and eval add
 * their own queries in their modules.
 */
import type pg from 'pg';
import { query, toVectorLiteral } from './client.js';
import type { DocStatus, EmbeddedChunk, Lang } from '../ingest/types.js';

export interface CorpusRow {
  id: number;
  slug: string;
  name: string;
  activeVersion: number;
}

export async function getCorpusBySlug(slug: string): Promise<CorpusRow | null> {
  const { rows } = await query<{ id: string; slug: string; name: string; active_version: number }>(
    'SELECT id, slug, name, active_version FROM corpora WHERE slug = $1',
    [slug],
  );
  const r = rows[0];
  return r ? { id: Number(r.id), slug: r.slug, name: r.name, activeVersion: r.active_version } : null;
}

export async function setActiveVersion(corpusId: number, version: number): Promise<void> {
  await query('UPDATE corpora SET active_version = $2 WHERE id = $1', [corpusId, version]);
}

export interface NewDocument {
  corpusId: number;
  version: number;
  filename: string;
  mimeType: string;
  sourceLang: Lang;
  sha256: string;
}

/** Insert a document row (pending). Returns its id; null if a duplicate exists. */
export async function createDocument(doc: NewDocument): Promise<number | null> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO documents (corpus_id, version, filename, mime_type, source_lang, sha256, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (corpus_id, version, sha256) DO NOTHING
     RETURNING id`,
    [doc.corpusId, doc.version, doc.filename, doc.mimeType, doc.sourceLang, doc.sha256],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export interface DocumentPatch {
  status?: DocStatus;
  error?: string | null;
  sourceLang?: Lang;
  pageCount?: number | null;
  charCount?: number | null;
  indexed?: boolean;
}

export async function updateDocument(id: number, patch: DocumentPatch): Promise<void> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [];
  let i = 1;
  if (patch.status !== undefined) { sets.push(`status = $${i++}`); params.push(patch.status); }
  if (patch.sourceLang !== undefined) { sets.push(`source_lang = $${i++}`); params.push(patch.sourceLang); }
  if (patch.error !== undefined) { sets.push(`error = $${i++}`); params.push(patch.error); }
  if (patch.pageCount !== undefined) { sets.push(`page_count = $${i++}`); params.push(patch.pageCount); }
  if (patch.charCount !== undefined) { sets.push(`char_count = $${i++}`); params.push(patch.charCount); }
  if (patch.indexed) sets.push('indexed_at = now()');
  params.push(id);
  await query(`UPDATE documents SET ${sets.join(', ')} WHERE id = $${i}`, params);
}

/** Bulk-insert embedded chunks in one statement. Pass a transaction client. */
export async function insertChunks(client: pg.PoolClient, chunks: EmbeddedChunk[]): Promise<number> {
  if (chunks.length === 0) return 0;
  const cols = 11;
  const values: string[] = [];
  const params: unknown[] = [];
  chunks.forEach((c, row) => {
    const b = row * cols;
    values.push(
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}::vector)`,
    );
    params.push(
      c.documentId, c.corpusId, c.corpusVersion, c.chunkIndex, c.content, c.tokenCount,
      c.pageStart ?? null, c.pageEnd ?? null, c.heading ?? null, c.lang, toVectorLiteral(c.embedding),
    );
  });
  await client.query(
    `INSERT INTO chunks
       (document_id, corpus_id, corpus_version, chunk_index, content, token_count,
        page_start, page_end, heading, lang, embedding)
     VALUES ${values.join(', ')}`,
    params,
  );
  return chunks.length;
}

export interface DocumentListItem {
  id: number;
  filename: string;
  sourceLang: string;
  status: string;
  error: string | null;
  chunkCount: number;
  indexedAt: string | null;
}

export async function listDocuments(corpusId: number): Promise<DocumentListItem[]> {
  const { rows } = await query<{
    id: string; filename: string; source_lang: string; status: string;
    error: string | null; chunk_count: string; indexed_at: string | null;
  }>(
    `SELECT d.id, d.filename, d.source_lang, d.status, d.error,
            COUNT(c.id) AS chunk_count, d.indexed_at
     FROM documents d
     LEFT JOIN chunks c ON c.document_id = d.id
     WHERE d.corpus_id = $1
     GROUP BY d.id
     ORDER BY d.created_at DESC`,
    [corpusId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    filename: r.filename,
    sourceLang: r.source_lang,
    status: r.status,
    error: r.error,
    chunkCount: Number(r.chunk_count),
    indexedAt: r.indexed_at,
  }));
}

export interface CorpusStatus {
  slug: string;
  name: string;
  activeVersion: number;
  documents: number;
  chunks: number;
  indexed: number;
  failed: { id: number; filename: string; error: string | null }[];
}

export async function corpusStatus(slug: string): Promise<CorpusStatus | null> {
  const corpus = await getCorpusBySlug(slug);
  if (!corpus) return null;
  const { rows: agg } = await query<{ documents: string; indexed: string; chunks: string }>(
    `SELECT COUNT(DISTINCT d.id) AS documents,
            COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'indexed') AS indexed,
            COUNT(c.id) AS chunks
     FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
     WHERE d.corpus_id = $1`,
    [corpus.id],
  );
  const { rows: failed } = await query<{ id: string; filename: string; error: string | null }>(
    `SELECT id, filename, error FROM documents WHERE corpus_id = $1 AND status = 'failed' ORDER BY updated_at DESC`,
    [corpus.id],
  );
  const a = agg[0];
  return {
    slug: corpus.slug,
    name: corpus.name,
    activeVersion: corpus.activeVersion,
    documents: Number(a?.documents ?? 0),
    chunks: Number(a?.chunks ?? 0),
    indexed: Number(a?.indexed ?? 0),
    failed: failed.map((f) => ({ id: Number(f.id), filename: f.filename, error: f.error })),
  };
}

export async function deleteDocument(id: number): Promise<void> {
  await query('DELETE FROM documents WHERE id = $1', [id]);
}
