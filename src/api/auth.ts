/**
 * Simple admin auth: `Authorization: Bearer <ADMIN_TOKEN>`. Used as a Fastify
 * preHandler on write/admin routes. If ADMIN_TOKEN is unset, admin routes are
 * closed (fail shut) rather than open. Constant-time token comparison.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = loadEnv().ADMIN_TOKEN;
  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !safeEqual(provided, token)) {
    await reply.code(401).send({ error: 'unauthorized' });
    return; // stop the lifecycle; the route handler does not run
  }
}
