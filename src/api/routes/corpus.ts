/** Corpus status (public read) + reingest (admin). */
import type { FastifyInstance } from 'fastify';
import { corpusStatus } from '../../db/queries.js';
import { requireAdmin } from '../auth.js';

export async function corpusRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>('/:slug/status', async (req, reply) => {
    const status = await corpusStatus(req.params.slug);
    if (!status) return reply.code(404).send({ error: 'corpus not found' });
    return status;
  });

  // Reingest is a heavier operation (re-embeds the whole corpus). Wired here as an
  // admin endpoint; the actual reingest driver lives in src/ingest/index.ts and is
  // invoked from the seed script / a background job when source files are available.
  app.post<{ Params: { slug: string } }>('/:slug/reingest', { preHandler: requireAdmin }, async (_req, reply) => {
    return reply.code(501).send({ error: 'reingest via API not enabled; use `npm run seed:corpus` for the demo corpus' });
  });
}
