/**
 * Postgres connection pool + a couple of typed helpers. We use node-postgres
 * with hand-written SQL (pgvector needs the raw `<=>` operator anyway).
 */
import pg from 'pg';
import { loadEnv } from '../config/env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const env = loadEnv();
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    // Neon and most managed hosts require TLS (verified by default); a local dev
    // cluster does not. DATABASE_SSL_NO_VERIFY=true relaxes verification if needed.
    ssl: env.DATABASE_URL.includes('sslmode=require')
      ? { rejectUnauthorized: env.DATABASE_SSL_NO_VERIFY !== 'true' }
      : undefined,
    max: 10,
  });
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params as never[]);
}

/** Run `fn` inside a transaction, rolling back on any error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Lightweight health check used by GET /health. */
export async function pingDb(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * pgvector wants a bracketed string literal, e.g. '[0.1,0.2,...]', for a
 * `vector` parameter. Use this when binding an embedding as a query param.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
