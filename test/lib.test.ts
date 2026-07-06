import { describe, it, expect } from 'vitest';
import { hebrewRatio, detectChunkLang, detectDocLang, estimateTokens } from '../src/lib/tokens.js';
import { chatCost, embeddingCost, rerankCost, CostAccumulator } from '../src/lib/cost.js';

describe('tokens: language heuristics', () => {
  it('detects Hebrew vs English', () => {
    expect(hebrewRatio('shalom')).toBe(0);
    expect(hebrewRatio('שלום')).toBe(1);
    expect(detectChunkLang('כמה ימי חופשה מגיעים לי')).toBe('he');
    expect(detectChunkLang('How many vacation days')).toBe('en');
  });

  it('labels documents he/en/mixed', () => {
    expect(detectDocLang('The Israeli Hours of Work and Rest Law')).toBe('en');
    expect(detectDocLang('חוק שעות עבודה ומנוחה קובע מנוחה שבועית')).toBe('he');
    expect(detectDocLang('Minimum wage / שכר מינימום is set by law / חוק')).toBe('mixed');
  });

  it('estimates more tokens for Hebrew per char', () => {
    const en = 'aaaaaaaaaaaaaaaaaaaa'; // 20 chars, ~4 cpt -> 5
    const he = 'אאאאאאאאאאאאאאאאאאאא'; // 20 chars, ~2.5 cpt -> 8
    expect(estimateTokens(en)).toBe(5);
    expect(estimateTokens(he)).toBe(8);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('cost accounting', () => {
  it('prices chat by input/output', () => {
    // sonnet-5: $3/$15 per 1M
    expect(chatCost('claude-sonnet-5', 1_000_000, 0)).toBeCloseTo(3.0, 6);
    expect(chatCost('claude-sonnet-5', 0, 1_000_000)).toBeCloseTo(15.0, 6);
    // opus-4-8: $5/$25
    expect(chatCost('claude-opus-4-8', 2000, 300)).toBeCloseTo((2000 * 5 + 300 * 25) / 1e6, 9);
    // unknown model -> 0
    expect(chatCost('nope', 1000, 1000)).toBe(0);
  });

  it('prices embeddings + rerank', () => {
    expect(embeddingCost('voyage-4-lite', 1_000_000)).toBeCloseTo(0.02, 6);
    expect(rerankCost('rerank-2.5', 1_000_000)).toBeCloseTo(0.05, 6);
  });

  it('accumulates and guards a cap', () => {
    const acc = new CostAccumulator();
    acc.addChat('claude-opus-4-8', 1_000_000, 0); // $5
    acc.addEmbedding('voyage-4-lite', 1_000_000); // $0.02
    expect(acc.total()).toBeCloseTo(5.02, 6);
    expect(acc.breakdown()).toHaveLength(2);
    expect(() => acc.guardUnder(2.0)).toThrow(/Cost cap exceeded/);
    expect(() => acc.guardUnder(10.0)).not.toThrow();
  });
});
