import { describe, it, expect } from 'vitest';
import { validateCitations, answer } from '../src/answer/answer.js';
import { refusalString } from '../src/answer/prompt.js';
import type { RetrievedChunk } from '../src/retrieve/retrieve.js';

function chunk(id: number): RetrievedChunk {
  return { chunkId: id, documentId: 1, filename: 'f.md', content: `content ${id}`, similarity: 0.8, lang: 'en' };
}

describe('validateCitations (guardrail: never an invented citation)', () => {
  it('drops ids not in the retrieved set and dedupes', () => {
    const retrieved = [chunk(10), chunk(11), chunk(12)];
    expect(validateCitations([10, 12], retrieved)).toEqual([10, 12]);
    expect(validateCitations([10, 10, 11], retrieved)).toEqual([10, 11]);
    expect(validateCitations([99, 100], retrieved)).toEqual([]); // invented -> dropped
    expect(validateCitations([], retrieved)).toEqual([]);
  });
});

describe('answer short-circuit (no source -> no answer, no LLM call)', () => {
  it('refuses in English when no chunks are retrieved', async () => {
    const a = await answer('How many vacation days am I owed?', []);
    expect(a.refused).toBe(true);
    expect(a.text).toBe(refusalString('en'));
    expect(a.citations).toEqual([]);
    expect(a.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(a.costUsd).toBe(0);
  });

  it('refuses in Hebrew for a Hebrew question', async () => {
    const a = await answer('כמה ימי חופשה מגיעים לי?', []);
    expect(a.refused).toBe(true);
    expect(a.text).toBe(refusalString('he'));
  });
});
