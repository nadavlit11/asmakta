/**
 * SINGLE SOURCE OF TRUTH for every model id and price in the system.
 * Project rule (CLAUDE.md): model ids must live in one config module, never
 * scattered. If you add/switch a model, do it here.
 *
 * Pricing verified 2026-07-06 (see docs/plan.md §1.2). Prices are USD per 1M
 * tokens. Anthropic prices from the bundled claude-api reference; Voyage prices
 * from docs.voyageai.com/docs/pricing.
 */

// ---- Model ids (overridable via env; see resolveModels) ----

export const DEFAULT_MODELS = {
  /** Grounded answer generation. Sonnet 5 = near-Opus quality at ~half cost. */
  answering: 'claude-sonnet-5',
  /** Eval judge. Strongest widely-released Claude grades the cheaper answerer. */
  judge: 'claude-opus-4-8',
  /** Embeddings. voyage-4-lite @ 1024-dim: cheapest, multilingual, pgvector-friendly. */
  embedding: 'voyage-4-lite',
  /** Optional rerank stage (phase 2). Multilingual cross-encoder. */
  rerank: 'rerank-2.5',
  /** Cheap utility model for any non-answer-path classification. Not used by default. */
  utility: 'claude-haiku-4-5',
} as const;

// ---- Pricing tables (USD per 1M tokens) ----

export interface ChatPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Anthropic chat models. */
export const CHAT_PRICING: Record<string, ChatPrice> = {
  // Sonnet 5 has an intro price ($2/$10) through 2026-08-31, then $3/$15.
  // We use the standard price for conservative (higher) cost estimates.
  'claude-sonnet-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-opus-4-8': { inputPerMTok: 5.0, outputPerMTok: 25.0 },
  'claude-haiku-4-5': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
};

/** Voyage embedding/rerank models (input-only pricing). */
export const EMBEDDING_PRICING: Record<string, { perMTok: number; dims: number }> = {
  'voyage-4-lite': { perMTok: 0.02, dims: 1024 },
  'voyage-4': { perMTok: 0.06, dims: 1024 },
  'voyage-4-large': { perMTok: 0.12, dims: 1024 },
};

export const RERANK_PRICING: Record<string, { perMTok: number }> = {
  'rerank-2.5': { perMTok: 0.05 },
  'rerank-2.5-lite': { perMTok: 0.02 },
};

/**
 * The embedding vector dimension the DB schema is built for. If you switch the
 * embedding model to a different dimension you must migrate the `vector(N)`
 * column and re-embed the corpus. pgvector's HNSW index caps at 2000 dims for
 * the plain `vector` type — do not exceed it (see docs/plan.md §1.3).
 */
export const EMBEDDING_DIM = 1024;

export interface ResolvedModels {
  answering: string;
  judge: string;
  embedding: string;
  rerank: string;
  utility: string;
}

/** Apply optional env overrides on top of the defaults. */
export function resolveModels(env: NodeJS.ProcessEnv = process.env): ResolvedModels {
  return {
    answering: env.ANSWERING_MODEL ?? DEFAULT_MODELS.answering,
    judge: env.JUDGE_MODEL ?? DEFAULT_MODELS.judge,
    embedding: env.EMBEDDING_MODEL ?? DEFAULT_MODELS.embedding,
    rerank: env.RERANK_MODEL ?? DEFAULT_MODELS.rerank,
    utility: env.UTILITY_MODEL ?? DEFAULT_MODELS.utility,
  };
}
