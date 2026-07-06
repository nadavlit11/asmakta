/**
 * Simple admin auth: `Authorization: Bearer <ADMIN_TOKEN>`. Used as a Fastify
 * preHandler on write/admin routes. If ADMIN_TOKEN is unset, admin routes are
 * closed (fail shut) rather than open.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = loadEnv().ADMIN_TOKEN;
  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || provided !== token) {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}
