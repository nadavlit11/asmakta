/** Chat: retrieve + answer with the guardrail. See docs/plan.md §6. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCorpusBySlug } from '../../db/queries.js';
import { retrieve, DEFAULT_RETRIEVAL, type RetrievalConfig } from '../../retrieve/retrieve.js';
import { answer } from '../../answer/answer.js';
import { embeddingCost } from '../../lib/cost.js';
import { resolveModels } from '../../config/models.js';

const ChatBody = z.object({
  question: z.string().min(1),
  corpusSlug: z.string().default('labor-rights'),
  corpusVersion: z.number().int().optional(),
  rerank: z.boolean().optional(),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/', async (req, reply) => {
    const parse = ChatBody.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'invalid body', issues: parse.error.issues });
    const body = parse.data;

    const corpus = await getCorpusBySlug(body.corpusSlug);
    if (!corpus) return reply.code(404).send({ error: 'corpus not found' });

    const cfg: RetrievalConfig = {
      ...DEFAULT_RETRIEVAL,
      corpusId: corpus.id,
      corpusVersion: body.corpusVersion ?? corpus.activeVersion,
      rerank: body.rerank ?? false,
    };

    const started = Date.now();
    try {
      const { chunks, embeddingTokens } = await retrieve(body.question, cfg);
      const ans = await answer(body.question, chunks);
      const latencyMs = Date.now() - started;

      const citations = ans.citations.map((c) => {
        const rc = chunks.find((x) => x.chunkId === c.chunkId);
        return {
          chunkId: c.chunkId,
          documentId: rc?.documentId,
          filename: rc?.filename,
          pageStart: rc?.pageStart,
          heading: rc?.heading,
          quote: rc?.content.slice(0, 240),
        };
      });

      return {
        refused: ans.refused,
        answer: ans.text,
        citations,
        retrieved: chunks.map((c) => ({
          chunkId: c.chunkId,
          similarity: Number(c.similarity.toFixed(4)),
          filename: c.filename,
          heading: c.heading,
          content: c.content.slice(0, 240),
        })),
        usage: ans.usage,
        costUsd: Number((ans.costUsd + embeddingCost(resolveModels().embedding, embeddingTokens)).toFixed(6)),
        latencyMs,
        model: ans.model,
      };
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
