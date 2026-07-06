import { describe, it, expect } from 'vitest';
import {
  refusalCorrect,
  citationValid,
  answerCorrect,
  scoreFixture,
  aggregate,
  needsJudge,
  type FixtureLike,
  type AnswerLike,
  type RetrievedLike,
  type ScoredRow,
} from '../src/eval/rubric.js';

const answerable: FixtureLike = { isAnswerable: true, category: 'answerable', expectedDocFilenames: ['a.md'] };
const trap: FixtureLike = { isAnswerable: false, category: 'trap', expectedDocFilenames: [] };
const retrieved: RetrievedLike[] = [
  { chunkId: 1, filename: 'a.md' },
  { chunkId: 2, filename: 'b.md' },
];
const answered = (citeIds: number[]): AnswerLike => ({ refused: false, citations: citeIds.map((chunkId) => ({ chunkId })) });
const refused: AnswerLike = { refused: true, citations: [] };

describe('refusalCorrect', () => {
  it('answerable must not refuse; trap must refuse', () => {
    expect(refusalCorrect(answerable, answered([1]))).toBe(true);
    expect(refusalCorrect(answerable, refused)).toBe(false);
    expect(refusalCorrect(trap, refused)).toBe(true);
    expect(refusalCorrect(trap, answered([1]))).toBe(false);
  });
});

describe('citationValid (no invented citations; cite the right source)', () => {
  it('refused answers must cite nothing', () => {
    expect(citationValid(trap, refused, retrieved)).toBe(true);
    expect(citationValid(trap, { refused: true, citations: [{ chunkId: 1 }] }, retrieved)).toBe(false);
  });
  it('answered: rejects invented ids and requires an expected-source cite', () => {
    expect(citationValid(answerable, answered([1]), retrieved)).toBe(true); // a.md is expected
    expect(citationValid(answerable, answered([2]), retrieved)).toBe(false); // only b.md, not expected
    expect(citationValid(answerable, answered([1, 2]), retrieved)).toBe(true); // includes a.md
    expect(citationValid(answerable, answered([99]), retrieved)).toBe(false); // invented
    expect(citationValid(answerable, answered([]), retrieved)).toBe(false); // answered but no cite
  });
  it('answered with no expected sources: any real cite is valid', () => {
    const noExpected: FixtureLike = { isAnswerable: true, category: 'answerable', expectedDocFilenames: [] };
    expect(citationValid(noExpected, answered([2]), retrieved)).toBe(true);
    expect(citationValid(noExpected, answered([99]), retrieved)).toBe(false);
  });
});

describe('answerCorrect', () => {
  it('trap correctness equals refusal correctness', () => {
    expect(answerCorrect(trap, refused, undefined)).toBe(true);
    expect(answerCorrect(trap, answered([1]), undefined)).toBe(false);
  });
  it('answerable: refused is wrong; answered follows the judge', () => {
    expect(answerCorrect(answerable, refused, undefined)).toBe(false);
    expect(answerCorrect(answerable, answered([1]), true)).toBe(true);
    expect(answerCorrect(answerable, answered([1]), false)).toBe(false);
    expect(answerCorrect(answerable, answered([1]), undefined)).toBe(false);
  });
});

describe('scoreFixture (verdict = all three dimensions)', () => {
  it('passes when correct, cited well, and refusal-correct', () => {
    expect(scoreFixture(answerable, answered([1]), retrieved, true).verdict).toBe('pass');
    expect(scoreFixture(trap, refused, retrieved, undefined).verdict).toBe('pass');
  });
  it('fails if any single dimension fails', () => {
    expect(scoreFixture(answerable, answered([1]), retrieved, false).verdict).toBe('fail'); // judge no
    expect(scoreFixture(answerable, answered([2]), retrieved, true).verdict).toBe('fail'); // wrong source cited
    expect(scoreFixture(trap, answered([1]), retrieved, undefined).verdict).toBe('fail'); // answered a trap
  });
});

describe('needsJudge', () => {
  it('only for answerable + answered', () => {
    expect(needsJudge(answerable, answered([1]))).toBe(true);
    expect(needsJudge(answerable, refused)).toBe(false);
    expect(needsJudge(trap, answered([1]))).toBe(false);
  });
});

describe('aggregate', () => {
  it('computes pass-rate + per-category + per-language tallies', () => {
    const rows: ScoredRow[] = [
      { category: 'answerable', lang: 'en', verdict: 'pass' },
      { category: 'answerable', lang: 'he', verdict: 'fail' },
      { category: 'trap', lang: 'en', verdict: 'pass' },
      { category: 'multi_hop', lang: 'he', verdict: 'pass' },
    ];
    const agg = aggregate(rows);
    expect(agg.total).toBe(4);
    expect(agg.passed).toBe(3);
    expect(agg.passRate).toBeCloseTo(0.75, 6);
    expect(agg.byCategory['answerable']).toEqual({ passed: 1, total: 2 });
    expect(agg.byCategory['trap']).toEqual({ passed: 1, total: 1 });
    expect(agg.byCategory['lang:en']).toEqual({ passed: 2, total: 2 });
    expect(agg.byCategory['lang:he']).toEqual({ passed: 1, total: 2 });
  });

  it('handles an empty result set without dividing by zero', () => {
    const agg = aggregate([]);
    expect(agg.total).toBe(0);
    expect(agg.passed).toBe(0);
    expect(agg.passRate).toBe(0);
    expect(agg.byCategory).toEqual({});
  });
});
