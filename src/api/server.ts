/**
 * Fastify bootstrap. Route modules are registered here; each lives in
 * src/api/routes/*. For C1 only /health exists — the rest land at C10.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { loadEnv, corsOrigins } from '../config/env.js';
import { pingDb, closePool } from '../db/client.js';
import { isMainModule } from '../lib/runtime.js';
import { corpusRoutes } from './routes/corpus.js';
import { documentRoutes } from './routes/documents.js';
import { chatRoutes } from './routes/chat.js';
import { evalRoutes } from './routes/eval.js';

export async function buildServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(cors, { origin: corsOrigins(env) });
  await app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024 } });

  app.get('/health', async () => {
    const db = await pingDb();
    return { ok: db, db: db ? 'up' : 'down' };
  });

  await app.register(documentRoutes, { prefix: '/api/documents' });
  await app.register(corpusRoutes, { prefix: '/api/corpus' });
  await app.register(chatRoutes, { prefix: '/api/chat' });
  await app.register(evalRoutes, { prefix: '/api/eval' });

  // Single-service deploy: serve the built web UI from the same server. In dev
  // (web not built) this is a no-op and the Vite dev server proxies /api instead.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      // SPA fallback: serve index.html for non-API GETs; JSON 404 otherwise.
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/health')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  return app;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
  const shutdown = async () => {
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run only when executed directly (not when imported by tests).
if (isMainModule(import.meta.url)) {
  void main();
}
