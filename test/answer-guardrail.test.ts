import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Anthropic wrapper so we can exercise answer()'s guardrail branches
// that sit behind the LLM call, without an API key.
vi.mock('../src/lib/anthropic.js', () => ({ chatStructured: vi.fn() }));

import { chatStructured } from '../src/lib/anthropic.js';
import { answer } from '../src/answer/answer.js';
import { refusalString } from '../src/answer/prompt.js';
import type { RetrievedChunk } from '../src/retrieve/retrieve.js';

const mockChat = vi.mocked(chatStructured);

function chunk(id: number): RetrievedChunk {
  return { chunkId: id, documentId: 1, filename: 'a.md', content: `content ${id}`, similarity: 0.8, lang: 'en' };
}
const retrieved = [chunk(1), chunk(2)];

function mockAnswer(parsed: { refused: boolean; answer: string; citations: number[] }): void {
  mockChat.mockResolvedValue({
    parsed,
    usage: { inputTokens: 10, outputTokens: 5 },
    costUsd: 0.001,
    model: 'claude-sonnet-5',
  } as Awaited<ReturnType<typeof chatStructured>>);
}

beforeEach(() => mockChat.mockReset());

describe('answer() guardrail with a mocked LLM', () => {
  it('returns the answer when the model answers with a valid citation', async () => {
    mockAnswer({ refused: false, answer: 'You are entitled to 12 days.', citations: [1] });
    const a = await answer('How many vacation days?', retrieved);
    expect(a.refused).toBe(false);
    expect(a.text).toBe('You are entitled to 12 days.');
    expect(a.citations).toEqual([{ chunkId: 1 }]);
  });

  it('forces a refusal when the model cites only invented ids (never an invented citation)', async () => {
    mockAnswer({ refused: false, answer: 'Made-up answer.', citations: [999] });
    const a = await answer('q', retrieved);
    expect(a.refused).toBe(true);
    expect(a.text).toBe(refusalString('en'));
    expect(a.citations).toEqual([]);
  });

  it('honors an explicit model refusal', async () => {
    mockAnswer({ refused: true, answer: '', citations: [] });
    const a = await answer('q', retrieved);
    expect(a.refused).toBe(true);
    expect(a.text).toBe(refusalString('en'));
  });

  it('forces a refusal when the answer text is empty even with a valid citation', async () => {
    mockAnswer({ refused: false, answer: '   ', citations: [1] });
    const a = await answer('q', retrieved);
    expect(a.refused).toBe(true);
  });

  it('keeps only the valid citations when the model mixes real and invented ids', async () => {
    mockAnswer({ refused: false, answer: 'Partly grounded.', citations: [1, 999, 2] });
    const a = await answer('q', retrieved);
    expect(a.refused).toBe(false);
    expect(a.citations).toEqual([{ chunkId: 1 }, { chunkId: 2 }]);
  });
});
