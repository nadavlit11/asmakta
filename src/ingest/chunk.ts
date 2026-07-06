/**
 * Recursive, sentence-respecting chunker with overlap and heading tracking.
 * See docs/plan.md §3.
 *
 * - PDFs are chunked per page so citations get a clean page number; other formats
 *   are chunked over the full text (no page numbers).
 * - Markdown-style heading lines (`#`..`######`) set the "nearest heading"
 *   attached to subsequent chunks. The HTML parser emits headings in this form.
 * - Sentences are never split (unless a single sentence exceeds the target, in
 *   which case it becomes its own chunk). Overlap carries trailing sentences into
 *   the next chunk for retrieval continuity.
 */
import type { Chunk, ChunkContext, ChunkStrategy, ParsedDocument } from './types.js';
import { estimateTokens, detectChunkLang } from '../lib/tokens.js';

interface Unit {
  text: string;
  tokens: number;
  heading?: string;
}

const HEADING_RE = /^#{1,6}\s+(.+)$/;

/** Split a text block into sentences (Hebrew + English terminators). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?׃])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Turn a text segment into ordered sentence units, tracking headings. */
function buildUnits(segment: string): Unit[] {
  const units: Unit[] = [];
  let currentHeading: string | undefined;
  let paragraph: string[] = [];

  const flush = () => {
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    paragraph = [];
    if (!text) return;
    for (const sentence of splitSentences(text)) {
      units.push({ text: sentence, tokens: estimateTokens(sentence), heading: currentHeading });
    }
  };

  for (const raw of segment.split('\n')) {
    const line = raw.trim();
    const hm = HEADING_RE.exec(line);
    if (hm && hm[1]) {
      flush();
      currentHeading = hm[1].trim();
      continue;
    }
    if (line === '') {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return units;
}

/** Take trailing units summing to at most `budget` tokens (for overlap). */
function tailUnits(units: Unit[], budget: number): Unit[] {
  if (budget <= 0) return [];
  const out: Unit[] = [];
  let tokens = 0;
  for (let k = units.length - 1; k >= 0; k--) {
    const u = units[k]!;
    if (out.length > 0 && tokens + u.tokens > budget) break;
    out.unshift(u);
    tokens += u.tokens;
    if (tokens >= budget) break;
  }
  return out;
}

interface PackedChunk {
  content: string;
  heading?: string;
}

/** Greedily pack units into ~targetToken chunks with sentence overlap. */
function packUnits(units: Unit[], cfg: ChunkStrategy): PackedChunk[] {
  const chunks: PackedChunk[] = [];
  let i = 0;
  let overlap: Unit[] = [];

  while (i < units.length) {
    const current: Unit[] = [...overlap];
    const firstNew = current.length;
    let tokens = current.reduce((s, u) => s + u.tokens, 0);

    while (i < units.length) {
      const u = units[i]!;
      // Stop before exceeding target, but always include at least one new unit.
      if (current.length > firstNew && tokens + u.tokens > cfg.targetTokens) break;
      current.push(u);
      tokens += u.tokens;
      i++;
      if (tokens >= cfg.targetTokens) break;
    }

    const content = current.map((u) => u.text).join(' ').trim();
    const heading = current[firstNew]?.heading ?? current[0]?.heading;
    chunks.push({ content, heading });

    overlap = tailUnits(current, cfg.overlapTokens);
    if (current.length === firstNew) break; // safety: no new unit consumed
  }
  return chunks;
}

export function chunkDocument(parsed: ParsedDocument, cfg: ChunkStrategy, ctx: ChunkContext): Chunk[] {
  const segments: { text: string; page?: number }[] =
    parsed.pages && parsed.pages.length > 0
      ? parsed.pages.map((p) => ({ text: p.text, page: p.pageNumber }))
      : [{ text: parsed.text }];

  const chunks: Chunk[] = [];
  let idx = 0;
  for (const seg of segments) {
    if (!seg.text.trim()) continue;
    for (const packed of packUnits(buildUnits(seg.text), cfg)) {
      if (!packed.content) continue;
      chunks.push({
        documentId: ctx.documentId,
        corpusId: ctx.corpusId,
        corpusVersion: ctx.corpusVersion,
        chunkIndex: idx++,
        content: packed.content,
        tokenCount: estimateTokens(packed.content),
        pageStart: seg.page,
        pageEnd: seg.page,
        heading: packed.heading,
        lang: detectChunkLang(packed.content),
      });
    }
  }
  return chunks;
}
