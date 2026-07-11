/**
 * Recursive, sentence-respecting chunker with heading-boundary splitting and
 * overlap. See docs/plan.md §3.
 *
 * - PDFs are chunked per page so citations get a clean page number; other formats
 *   are chunked over the full text.
 * - Markdown-style heading lines (`#`..`######`) start a new section; each
 *   section becomes one or more chunks carrying that heading. This gives
 *   section-level citation precision. The HTML parser emits headings in this form.
 * - Sentences are never split (unless a single sentence exceeds the target, in
 *   which case it becomes its own chunk). Overlap carries trailing sentences into
 *   the next chunk within a section for retrieval continuity.
 */
import type { Chunk, ChunkContext, ChunkStrategy, ParsedDocument } from './types.js';
import { estimateTokens, detectChunkLang } from '../lib/tokens.js';

interface Unit {
  text: string;
  tokens: number;
}

interface Section {
  heading?: string;
  text: string;
}

const HEADING_RE = /^#{1,6}\s+(.+)$/;

/** Split a text block into sentences (Hebrew + English terminators). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?׃])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split a segment into heading-delimited sections. Text before the first heading
 * (or a document with no headings) forms a single untitled section. */
export function splitSections(segment: string): Section[] {
  const sections: Section[] = [];
  let heading: string | undefined;
  let body: string[] = [];

  const flush = () => {
    const text = body.join('\n').trim();
    body = [];
    if (text) sections.push({ heading, text });
  };

  for (const raw of segment.split('\n')) {
    const line = raw.trim();
    const hm = HEADING_RE.exec(line);
    if (hm && hm[1]) {
      flush();
      heading = hm[1].trim();
      continue;
    }
    body.push(line);
  }
  flush();
  return sections;
}

/** Turn section text into ordered sentence units (paragraph-aware). */
function buildUnits(text: string): Unit[] {
  const units: Unit[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const joined = para.replace(/\s+/g, ' ').trim();
    if (!joined) continue;
    for (const sentence of splitSentences(joined)) {
      units.push({ text: sentence, tokens: estimateTokens(sentence) });
    }
  }
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

/** Greedily pack units into ~targetToken chunks with sentence overlap. */
function packUnits(units: Unit[], cfg: ChunkStrategy): string[] {
  const chunks: string[] = [];
  let i = 0;
  let overlap: Unit[] = [];

  while (i < units.length) {
    const current: Unit[] = [...overlap];
    const firstNew = current.length;
    let tokens = current.reduce((s, u) => s + u.tokens, 0);

    while (i < units.length) {
      const u = units[i]!;
      if (current.length > firstNew && tokens + u.tokens > cfg.targetTokens) break;
      current.push(u);
      tokens += u.tokens;
      i++;
      if (tokens >= cfg.targetTokens) break;
    }

    chunks.push(current.map((u) => u.text).join(' ').trim());
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
    for (const section of splitSections(seg.text)) {
      for (const content of packUnits(buildUnits(section.text), cfg)) {
        if (!content) continue;
        chunks.push({
          documentId: ctx.documentId,
          corpusId: ctx.corpusId,
          corpusVersion: ctx.corpusVersion,
          chunkIndex: idx++,
          content,
          tokenCount: estimateTokens(content),
          pageStart: seg.page,
          pageEnd: seg.page,
          heading: section.heading,
          lang: detectChunkLang(content),
        });
      }
    }
  }
  return chunks;
}
