/**
 * Tiny forward-only migration runner. Applies unapplied .sql files from
 * migrations/ in filename order, each in its own transaction, tracked in a
 * schema_migrations table.
 *
 *   npm run migrate        # apply all pending
 *   tsx src/db/migrate.ts status
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from './client.js';
import { isMainModule } from '../lib/runtime.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

async function appliedIds(): Promise<Set<string>> {
  const { rows } = await getPool().query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(rows.map((r) => r.id));
}

export async function migrateUp(): Promise<string[]> {
  await ensureMigrationsTable();
  const applied = await appliedIds();
  const pending = migrationFiles().filter((f) => !applied.has(f));
  const done: string[] = [];
  for (const file of pending) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      done.push(file);
      console.log(`  applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return done;
}

async function status(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedIds();
  for (const file of migrationFiles()) {
    console.log(`  [${applied.has(file) ? 'x' : ' '}] ${file}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  try {
    if (cmd === 'up') {
      const done = await migrateUp();
      console.log(done.length ? `Applied ${done.length} migration(s).` : 'Already up to date.');
    } else if (cmd === 'status') {
      await status();
    } else {
      console.error(`Unknown command: ${cmd} (use "up" or "status")`);
      process.exit(1);
    }
  } finally {
    await closePool();
  }
}

if (isMainModule(import.meta.url)) {
  void main();
}
