/**
 * Retrieval: embed the query, cosine-search pgvector (version-filtered, above a
 * similarity threshold), optionally rerank. See docs/plan.md §4.1.
 *
 * `retrieveByVector` takes a precomputed embedding so the SQL path is testable
 * without a Voyage key; `retrieve` wraps it with query embedding + rerank.
 */
import { query, toVectorLiteral } from '../db/client.js';
import { embedQuery } from '../lib/voyage.js';
import { rerankDocuments } from '../lib/voyage.js';

export interface RetrievalConfig {
  corpusId: number;
  corpusVersion: number;
  topK: number; // default 5
  minSimilarity: number; // cosine similarity 0..1, default 0.55
  rerank: boolean; // default false
  rerankTopN?: number; // when rerank: pull this many by vector, rerank down to topK
}

export const DEFAULT_RETRIEVAL: Omit<RetrievalConfig, 'corpusId' | 'corpusVersion'> = {
  topK: 5,
  minSimilarity: 0.55,
  rerank: false,
  rerankTopN: 30,
};

export interface RetrievedChunk {
  chunkId: number;
  documentId: number;
  filename: string;
  content: string;
  similarity: number;
  pageStart?: number;
  heading?: string;
  lang: 'he' | 'en';
}

/** Vector-only search. `limit` overrides topK (used to widen the pool before rerank). */
export async function retrieveByVector(
  embedding: number[],
  cfg: RetrievalConfig,
  limit?: number,
): Promise<RetrievedChunk[]> {
  const { rows } = await query<{
    id: string; document_id: string; filename: string; content: string;
    page_start: number | null; heading: string | null; lang: string; similarity: number;
  }>(
    `SELECT c.id, c.document_id, d.filename, c.content, c.page_start, c.heading, c.lang,
            1 - (c.embedding <=> $1::vector) AS similarity
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE c.corpus_id = $2
       AND c.corpus_version = $3
       AND 1 - (c.embedding <=> $1::vector) > $4
     ORDER BY c.embedding <=> $1::vector
     LIMIT $5`,
    [toVectorLiteral(embedding), cfg.corpusId, cfg.corpusVersion, cfg.minSimilarity, limit ?? cfg.topK],
  );
  return rows.map((r) => ({
    chunkId: Number(r.id),
    documentId: Number(r.document_id),
    filename: r.filename,
    content: r.content,
    similarity: Number(r.similarity),
    pageStart: r.page_start ?? undefined,
    heading: r.heading ?? undefined,
    lang: r.lang === 'he' ? 'he' : 'en',
  }));
}

/** Full retrieval: embed the query, search, optionally rerank. Requires VOYAGE_API_KEY. */
export async function retrieve(
  queryText: string,
  cfg: RetrievalConfig,
): Promise<{ chunks: RetrievedChunk[]; embeddingTokens: number; rerankTokens: number }> {
  const { embedding, totalTokens: embeddingTokens } = await embedQuery(queryText);

  if (!cfg.rerank) {
    const chunks = await retrieveByVector(embedding, cfg);
    return { chunks, embeddingTokens, rerankTokens: 0 };
  }

  const pool = await retrieveByVector(embedding, cfg, cfg.rerankTopN ?? DEFAULT_RETRIEVAL.rerankTopN);
  if (pool.length === 0) return { chunks: [], embeddingTokens, rerankTokens: 0 };

  const { hits, totalTokens: rerankTokens } = await rerankDocuments(
    queryText,
    pool.map((c) => c.content),
    cfg.topK,
  );
  const chunks = hits.map((h) => pool[h.index]).filter((c): c is RetrievedChunk => Boolean(c));
  return { chunks, embeddingTokens, rerankTokens };
}
