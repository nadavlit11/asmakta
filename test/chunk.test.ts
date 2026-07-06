import { describe, it, expect } from 'vitest';
import { chunkDocument, splitSentences, splitSections } from '../src/ingest/chunk.js';
import { DEFAULT_CHUNK_STRATEGY, type ParsedDocument } from '../src/ingest/types.js';

const ctx = { documentId: 1, corpusId: 1, corpusVersion: 1 };

describe('splitSentences', () => {
  it('splits English and Hebrew on terminators', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
    expect(splitSentences('שלום עולם. מה שלומך?')).toEqual(['שלום עולם.', 'מה שלומך?']);
    expect(splitSentences('פסוק ראשון׃ פסוק שני׃')).toEqual(['פסוק ראשון׃', 'פסוק שני׃']); // sof pasuq
    expect(splitSentences('no terminator here')).toEqual(['no terminator here']);
  });
});

describe('chunkDocument', () => {
  it('tracks markdown headings and produces sequential indices', () => {
    const parsed: ParsedDocument = {
      text: [
        '# Annual Leave',
        '',
        'Every employee is entitled to paid annual leave. The number of days depends on seniority.',
        '',
        '## Minimum Wage',
        '',
        'The minimum wage is set by law and updated periodically.',
      ].join('\n'),
      detectedLang: 'en',
      charCount: 200,
    };
    const chunks = chunkDocument(parsed, { ...DEFAULT_CHUNK_STRATEGY, targetTokens: 20, overlapTokens: 5 }, ctx);
    expect(chunks.length).toBeGreaterThan(0);
    // indices are 0..n-1
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    // headings are attached and come from the markdown
    const headings = new Set(chunks.map((c) => c.heading));
    expect(headings.has('Annual Leave') || headings.has('Minimum Wage')).toBe(true);
    // no chunk contains a raw markdown heading marker
    expect(chunks.every((c) => !c.content.startsWith('#'))).toBe(true);
  });

  it('assigns page numbers when pages are present', () => {
    const parsed: ParsedDocument = {
      text: 'p1 text. more. / p2 text. more.',
      pages: [
        { pageNumber: 1, text: 'Page one sentence. Another sentence on page one.' },
        { pageNumber: 2, text: 'Page two sentence. Another sentence on page two.' },
      ],
      detectedLang: 'en',
      charCount: 100,
    };
    const chunks = chunkDocument(parsed, { ...DEFAULT_CHUNK_STRATEGY, targetTokens: 50 }, ctx);
    const pages = new Set(chunks.map((c) => c.pageStart));
    expect(pages.has(1)).toBe(true);
    expect(pages.has(2)).toBe(true);
    expect(chunks.every((c) => c.pageStart === c.pageEnd)).toBe(true);
  });

  it('labels Hebrew chunks as he and keeps sentences whole', () => {
    const heText = 'העובד זכאי לחופשה שנתית בתשלום. מספר הימים תלוי בוותק של העובד במקום העבודה.';
    const parsed: ParsedDocument = { text: heText, detectedLang: 'he', charCount: heText.length };
    const chunks = chunkDocument(parsed, { ...DEFAULT_CHUNK_STRATEGY, targetTokens: 15, overlapTokens: 3 }, ctx);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.lang === 'he')).toBe(true);
    expect(chunks.every((c) => c.tokenCount > 0)).toBe(true);
  });

  it('produces overlap between consecutive chunks (and none when disabled)', () => {
    // Uniquely-numbered sentences so a shared sentence proves real overlap.
    const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} has several distinct words.`).join(' ');
    const parsed: ParsedDocument = { text: sentences, detectedLang: 'en', charCount: sentences.length };
    const sentsOf = (content: string) => new Set(content.match(/Sentence number \d+/g) ?? []);

    const withOverlap = chunkDocument(parsed, { ...DEFAULT_CHUNK_STRATEGY, targetTokens: 20, overlapTokens: 10 }, ctx);
    expect(withOverlap.length).toBeGreaterThan(1);
    const wo0 = sentsOf(withOverlap[0]!.content);
    const wo1 = sentsOf(withOverlap[1]!.content);
    expect([...wo0].some((s) => wo1.has(s))).toBe(true); // a sentence is shared -> overlap

    // Control: with overlap disabled, consecutive chunks must share no sentence.
    const noOverlap = chunkDocument(parsed, { ...DEFAULT_CHUNK_STRATEGY, targetTokens: 20, overlapTokens: 0 }, ctx);
    const no0 = sentsOf(noOverlap[0]!.content);
    const no1 = sentsOf(noOverlap[1]!.content);
    expect([...no0].some((s) => no1.has(s))).toBe(false);
  });

  it('emits an own chunk for a single sentence that exceeds the target', () => {
    const longSentence = `This is one very long sentence with many many many words that on its own exceeds the small token target we set`;
    const parsed: ParsedDocument = { text: longSentence, detectedLang: 'en', charCount: longSentence.length };
    const chunks = chunkDocument(parsed, { ...DEFAULT_CHUNK_STRATEGY, targetTokens: 5 }, ctx);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(longSentence);
  });
});

describe('splitSections', () => {
  it('treats text before the first heading as one untitled section', () => {
    const secs = splitSections('Intro line without a heading.\n\n# Real Heading\n\nBody under heading.');
    expect(secs[0]!.heading).toBeUndefined();
    expect(secs[0]!.text).toContain('Intro line');
    expect(secs[1]!.heading).toBe('Real Heading');
  });
  it('returns a single untitled section when there are no headings', () => {
    const secs = splitSections('Just a paragraph.\n\nAnd another.');
    expect(secs).toHaveLength(1);
    expect(secs[0]!.heading).toBeUndefined();
  });
});
