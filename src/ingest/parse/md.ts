/**
 * Markdown parser. Markdown is already plain text; we keep heading lines
 * (`#`, `##`, …) intact so the chunker can attach the nearest heading, and drop
 * fenced code blocks (rare in a labor-law corpus, noisy if present).
 */
import type { ParsedDocument, RawDocument } from '../types.js';
import { detectDocLang } from '../../lib/tokens.js';

export async function parseMarkdown(doc: RawDocument): Promise<ParsedDocument> {
  let text = doc.bytes.toString('utf8');
  // Strip fenced code blocks.
  text = text.replace(/```[\s\S]*?```/g, '').trim();
  if (text.length < 20) {
    throw new Error(`Markdown produced almost no text (${text.length} chars).`);
  }
  return {
    text,
    detectedLang: doc.declaredLang ?? detectDocLang(text),
    charCount: text.length,
  };
}
