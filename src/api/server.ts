/**
 * Fastify bootstrap. Route modules are registered here; each lives in
 * src/api/routes/*. For C1 only /health exists — the rest land at C10.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { loadEnv, corsOrigins } from '../config/env.js';
import { pingDb, closePool } from '../db/client.js';
import { isMainModule } from '../lib/runtime.js';

export async function buildServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(cors, { origin: corsOrigins(env) });
  await app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024 } });

  app.get('/health', async () => {
    const db = await pingDb();
    return { ok: db, db: db ? 'up' : 'down' };
  });

  // Route modules (registered at C10):
  //   await app.register(documentRoutes, { prefix: '/api/documents' });
  //   await app.register(corpusRoutes,    { prefix: '/api/corpus' });
  //   await app.register(chatRoutes,      { prefix: '/api/chat' });
  //   await app.register(evalRoutes,      { prefix: '/api/eval' });

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
