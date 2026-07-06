/**
 * Cost accounting in USD, derived from provider `usage` fields. All prices come
 * from src/config/models.ts (the single source of truth).
 */
import { CHAT_PRICING, EMBEDDING_PRICING, RERANK_PRICING } from '../config/models.js';

/** Cost of one Claude call. Unknown model => 0 (logged by caller if needed). */
export function chatCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = CHAT_PRICING[model];
  if (!price) return 0;
  return (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
}

/** Cost of a Voyage embedding call from total tokens. */
export function embeddingCost(model: string, totalTokens: number): number {
  const price = EMBEDDING_PRICING[model];
  if (!price) return 0;
  return (totalTokens * price.perMTok) / 1_000_000;
}

/** Cost of a Voyage rerank call from total tokens. */
export function rerankCost(model: string, totalTokens: number): number {
  const price = RERANK_PRICING[model];
  if (!price) return 0;
  return (totalTokens * price.perMTok) / 1_000_000;
}

export interface CostLine {
  label: string;
  usd: number;
}

/**
 * Running cost accumulator for a multi-call operation (e.g. one eval run).
 * `guardUnder` lets a harness abort before exceeding a hard cap.
 */
export class CostAccumulator {
  private lines: CostLine[] = [];

  add(label: string, usd: number): void {
    this.lines.push({ label, usd });
  }

  addChat(model: string, inputTokens: number, outputTokens: number): number {
    const c = chatCost(model, inputTokens, outputTokens);
    this.add(`chat:${model}`, c);
    return c;
  }

  addEmbedding(model: string, totalTokens: number): number {
    const c = embeddingCost(model, totalTokens);
    this.add(`embed:${model}`, c);
    return c;
  }

  addRerank(model: string, totalTokens: number): number {
    const c = rerankCost(model, totalTokens);
    this.add(`rerank:${model}`, c);
    return c;
  }

  total(): number {
    return this.lines.reduce((s, l) => s + l.usd, 0);
  }

  /** Throw if the accumulated cost has exceeded `capUsd`. */
  guardUnder(capUsd: number): void {
    const t = this.total();
    if (t > capUsd) {
      throw new Error(`Cost cap exceeded: $${t.toFixed(4)} > $${capUsd.toFixed(2)} (EVAL_MAX_COST_USD).`);
    }
  }

  breakdown(): CostLine[] {
    return [...this.lines];
  }
}
