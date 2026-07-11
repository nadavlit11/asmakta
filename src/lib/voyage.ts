/**
 * Voyage AI client wrapper: embeddings (+ optional rerank). Throws a clear
 * error if VOYAGE_API_KEY is missing so pure-logic paths can run without it.
 *
 * API facts (verified against the installed voyageai SDK, 2026-07-06):
 * - Auth field is `apiKey`; client is `new VoyageAIClient({ apiKey })`.
 * - embed() input list is capped at 128 texts per request — we batch at 128.
 * - Always set inputType: 'document' for chunks, 'query' for user queries.
 * - Response: { data: [{ embedding, index }], usage: { totalTokens } }.
 */
import { VoyageAIClient } from 'voyageai';
import { loadEnv } from '../config/env.js';
import { resolveModels, EMBEDDING_DIM } from '../config/models.js';

const MAX_BATCH = 128;

let client: VoyageAIClient | null = null;

function getClient(): VoyageAIClient {
  if (client) return client;
  const env = loadEnv();
  if (!env.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is not set — required for embeddings/rerank. See .env.example.');
  }
  client = new VoyageAIClient({ apiKey: env.VOYAGE_API_KEY });
  return client;
}

export interface EmbedResult {
  embeddings: number[][];
  totalTokens: number;
  model: string;
}

async function embedBatch(
  texts: string[],
  inputType: 'document' | 'query',
  model: string,
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  const res = await getClient().embed({
    input: texts,
    model,
    inputType,
    outputDimension: EMBEDDING_DIM,
  });
  const data = res.data ?? [];
  // Sort by index defensively so embeddings map back to input order.
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const embeddings = ordered.map((d) => {
    if (!d.embedding || d.embedding.length !== EMBEDDING_DIM) {
      throw new Error(`Voyage returned an embedding of unexpected length (${d.embedding?.length ?? 'none'}, expected ${EMBEDDING_DIM}).`);
    }
    return d.embedding;
  });
  return { embeddings, totalTokens: res.usage?.totalTokens ?? 0 };
}

/** Embed corpus chunks (inputType='document'), batching under the 128 cap. */
export async function embedDocuments(texts: string[]): Promise<EmbedResult> {
  const model = resolveModels().embedding;
  const embeddings: number[][] = [];
  let totalTokens = 0;
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const r = await embedBatch(batch, 'document', model);
    embeddings.push(...r.embeddings);
    totalTokens += r.totalTokens;
  }
  return { embeddings, totalTokens, model };
}

/** Embed a single user query (inputType='query'). */
export async function embedQuery(text: string): Promise<{ embedding: number[]; totalTokens: number; model: string }> {
  const model = resolveModels().embedding;
  const r = await embedBatch([text], 'query', model);
  const embedding = r.embeddings[0];
  if (!embedding) throw new Error('Voyage returned no embedding for the query.');
  return { embedding, totalTokens: r.totalTokens, model };
}

export interface RerankHit {
  index: number; // index into the input documents array
  relevanceScore: number;
}

/** Rerank documents against a query; returns hits sorted by descending score. */
export async function rerankDocuments(
  query: string,
  documents: string[],
  topK: number,
): Promise<{ hits: RerankHit[]; totalTokens: number; model: string }> {
  const model = resolveModels().rerank;
  const res = await getClient().rerank({ query, documents, model, topK });
  const hits = (res.data ?? [])
    .map((d) => ({ index: d.index ?? 0, relevanceScore: d.relevanceScore ?? 0 }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
  return { hits, totalTokens: res.usage?.totalTokens ?? 0, model };
}
