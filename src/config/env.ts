/**
 * Environment loading + validation. Loaded once at process start.
 *
 * Secrets (ANTHROPIC_API_KEY / VOYAGE_API_KEY) are intentionally OPTIONAL here
 * so that DB-only and pure-logic code paths (migrations, chunking, retrieval
 * SQL, deterministic eval checks) run without them. The Anthropic/Voyage client
 * wrappers throw a clear error at call time if their key is missing — see
 * src/lib/anthropic.ts and src/lib/voyage.ts.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Verify the DB server's TLS certificate by default. Set to 'true' only if a
  // host presents a cert not chained to a public CA (rare; Neon works verified).
  DATABASE_SSL_NO_VERIFY: z.enum(['true', 'false']).default('false'),
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().optional(),
  EVAL_TARGET_PASS_RATE: z.coerce.number().min(0).max(1).default(0.9),
  EVAL_MAX_COST_USD: z.coerce.number().positive().default(2.0),
  ANSWERING_MODEL: z.string().optional(),
  JUDGE_MODEL: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  RERANK_MODEL: z.string().optional(),
  UTILITY_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;
let dotenvLoaded = false;

/** Load a local .env file if present (Node built-in). No-op if missing/unsupported. */
function loadDotenvOnce(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const loader = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loader === 'function') {
    try {
      loader('.env');
    } catch {
      // no .env file (prod uses real env vars) — fine.
    }
  }
}

/** Parse + validate process.env once. Throws on invalid config. */
export function loadEnv(source?: NodeJS.ProcessEnv): Env {
  if (cached) return cached;
  if (!source) loadDotenvOnce();
  source ??= process.env;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Allowed CORS origins parsed from CORS_ORIGINS (comma-separated). Empty => allow all. */
export function corsOrigins(env: Env): string[] | true {
  if (!env.CORS_ORIGINS || env.CORS_ORIGINS.trim() === '') return true;
  return env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
}
