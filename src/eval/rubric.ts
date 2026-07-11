/**
 * Deterministic scoring rubric. See docs/plan.md §5.1.
 *
 * Refusal-correctness and citation-validity are pure code (no LLM). Only
 * answer-correctness of an answerable+answered fixture uses the judge, whose
 * boolean verdict is passed in. This keeps the guardrail-critical checks
 * deterministic and cheap, and makes the whole rubric unit-testable.
 */

export type Category = 'answerable' | 'trap' | 'multi_hop' | 'cross_lingual';

export interface FixtureLike {
  isAnswerable: boolean;
  category: Category;
  expectedDocFilenames: string[];
}

export interface AnswerLike {
  refused: boolean;
  citations: { chunkId: number }[];
}

export interface RetrievedLike {
  chunkId: number;
  filename: string;
}

export interface Verdict {
  answerCorrect: boolean;
  citationValid: boolean;
  refusalCorrect: boolean;
  verdict: 'pass' | 'fail';
}

/** Whether the refuse/answer decision matched the fixture's answerability. */
export function refusalCorrect(fixture: FixtureLike, answer: AnswerLike): boolean {
  return fixture.isAnswerable ? !answer.refused : answer.refused;
}

/**
 * Citation validity:
 *  - refused: must have zero citations.
 *  - answered: every cited chunk must be in the retrieved set (no invented
 *    citations) AND, when the fixture names expected source documents, at least
 *    one cited chunk must come from one of them.
 */
export function citationValid(
  fixture: FixtureLike,
  answer: AnswerLike,
  retrieved: RetrievedLike[],
): boolean {
  if (answer.refused) return answer.citations.length === 0;

  const byId = new Map(retrieved.map((r) => [r.chunkId, r.filename]));
  const citedFilenames: string[] = [];
  for (const c of answer.citations) {
    const filename = byId.get(c.chunkId);
    if (filename === undefined) return false; // invented citation
    citedFilenames.push(filename);
  }
  if (answer.citations.length === 0) return false; // answered but cited nothing

  if (fixture.expectedDocFilenames.length === 0) return true;
  const expected = new Set(fixture.expectedDocFilenames);
  return citedFilenames.some((f) => expected.has(f));
}

/**
 * Answer correctness:
 *  - trap: correct behaviour IS refusal, so it equals refusalCorrect.
 *  - answerable & refused: wrong (missed a real answer).
 *  - answerable & answered: the judge's boolean verdict.
 */
export function answerCorrect(
  fixture: FixtureLike,
  answer: AnswerLike,
  judgeCorrect: boolean | undefined,
): boolean {
  if (!fixture.isAnswerable) return refusalCorrect(fixture, answer);
  if (answer.refused) return false;
  return judgeCorrect === true;
}

export function scoreFixture(
  fixture: FixtureLike,
  answer: AnswerLike,
  retrieved: RetrievedLike[],
  judgeCorrect: boolean | undefined,
): Verdict {
  const refCorrect = refusalCorrect(fixture, answer);
  const citValid = citationValid(fixture, answer, retrieved);
  const ansCorrect = answerCorrect(fixture, answer, judgeCorrect);
  return {
    answerCorrect: ansCorrect,
    citationValid: citValid,
    refusalCorrect: refCorrect,
    verdict: ansCorrect && citValid && refCorrect ? 'pass' : 'fail',
  };
}

/** Does this fixture require a judge call? (answerable + answered). */
export function needsJudge(fixture: FixtureLike, answer: AnswerLike): boolean {
  return fixture.isAnswerable && !answer.refused;
}

// ---- Aggregation ----

export interface CategoryTally {
  passed: number;
  total: number;
}

export interface Aggregate {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  byCategory: Record<string, CategoryTally>;
}

export interface ScoredRow {
  category: Category;
  lang: 'he' | 'en';
  verdict: 'pass' | 'fail';
}

/** Aggregate results with per-category AND per-language tallies. */
export function aggregate(rows: ScoredRow[]): Aggregate {
  const byCategory: Record<string, CategoryTally> = {};
  const bump = (key: string, pass: boolean) => {
    const t = (byCategory[key] ??= { passed: 0, total: 0 });
    t.total++;
    if (pass) t.passed++;
  };
  let passed = 0;
  for (const r of rows) {
    const pass = r.verdict === 'pass';
    if (pass) passed++;
    bump(r.category, pass);
    bump(`lang:${r.lang}`, pass);
  }
  const total = rows.length;
  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 0 : passed / total,
    byCategory,
  };
}
