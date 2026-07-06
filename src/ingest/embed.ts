/** Embed chunks via Voyage, producing EmbeddedChunk[]. Requires VOYAGE_API_KEY. */
import type { Chunk, EmbeddedChunk } from './types.js';
import { embedDocuments } from '../lib/voyage.js';

export async function embedChunks(
  chunks: Chunk[],
): Promise<{ embedded: EmbeddedChunk[]; totalTokens: number; model: string }> {
  if (chunks.length === 0) return { embedded: [], totalTokens: 0, model: '' };
  const { embeddings, totalTokens, model } = await embedDocuments(chunks.map((c) => c.content));
  if (embeddings.length !== chunks.length) {
    throw new Error(`Embedding count mismatch: got ${embeddings.length} for ${chunks.length} chunks.`);
  }
  const embedded = chunks.map((c, i) => ({ ...c, embedding: embeddings[i]! }));
  return { embedded, totalTokens, model };
}
