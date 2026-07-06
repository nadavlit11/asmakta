/** Document ingestion + admin management. See docs/plan.md §6. */
import type { FastifyInstance } from 'fastify';
import { getCorpusBySlug, listDocuments, getDocumentById, deleteDocument } from '../../db/queries.js';
import { ingestDocument } from '../../ingest/index.js';
import type { Lang, RawDocument } from '../../ingest/types.js';
import { requireAdmin } from '../auth.js';

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/documents?corpus=labor-rights
  app.get<{ Querystring: { corpus?: string } }>('/', async (req, reply) => {
    const slug = req.query.corpus ?? 'labor-rights';
    const corpus = await getCorpusBySlug(slug);
    if (!corpus) return reply.code(404).send({ error: 'corpus not found' });
    return listDocuments(corpus.id);
  });

  // GET /api/documents/:id
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const doc = await getDocumentById(Number(req.params.id));
    if (!doc) return reply.code(404).send({ error: 'document not found' });
    return doc;
  });

  // POST /api/documents?corpus=labor-rights&lang=he   (multipart file body; admin)
  app.post<{ Querystring: { corpus?: string; lang?: Lang } }>(
    '/',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const slug = req.query.corpus ?? 'labor-rights';
      const corpus = await getCorpusBySlug(slug);
      if (!corpus) return reply.code(404).send({ error: 'corpus not found' });

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'no file uploaded' });
      const bytes = await file.toBuffer();

      const raw: RawDocument = {
        corpusId: corpus.id,
        version: corpus.activeVersion,
        filename: file.filename,
        mimeType: file.mimetype,
        bytes,
        declaredLang: req.query.lang,
      };
      const result = await ingestDocument(raw);
      return reply.code(result.status === 'failed' ? 422 : 201).send(result);
    },
  );

  // DELETE /api/documents/:id (admin)
  app.delete<{ Params: { id: string } }>('/:id', { preHandler: requireAdmin }, async (req) => {
    await deleteDocument(Number(req.params.id));
    return { deleted: true };
  });
}
