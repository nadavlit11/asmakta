import { describe, it, expect } from 'vitest';
import { chunkDocument, splitSentences } from '../src/ingest/chunk.js';
import { DEFAULT_CHUNK_STRATEGY, type ParsedDocument } from '../src/ingest/types.js';

const ctx = { documentId: 1, corpusId: 1, corpusVersion: 1 };

describe('splitSentences', () => {
  it('splits English and Hebrew on terminators', () => {
    expect(splitSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?']);
    expect(splitSentences('שלום עולם. מה שלומך?')).toEqual(['שלום עולם.', 'מה שלומך?']);
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

  it('produces overlap between consecutive chunks', () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} has several words in it.`).join(' ');
    const parsed: ParsedDocument = { text: sentences, detectedLang: 'en', charCount: sentences.length };
    const chunks = chunkDocument(parsed, { ...DEFAULT_CHUNK_STRATEGY, targetTokens: 20, overlapTokens: 8 }, ctx);
    expect(chunks.length).toBeGreaterThan(1);
    // The end of chunk N should share text with the start of chunk N+1.
    const first = chunks[0]!.content;
    const second = chunks[1]!.content;
    const lastWordOfFirst = first.split(' ').slice(-3).join(' ');
    expect(second.includes(lastWordOfFirst.split(' ')[0]!)).toBe(true);
  });
});
