/**
 * PDF parser (unpdf → pdf.js). Extracts per-page text so citations can carry
 * a page number.
 *
 * ⚠️ Hebrew PDF extraction is the #1 technical risk (RTL/ligatures/fonts). If a
 * PDF yields little/no text we throw a clear error so the orchestrator marks the
 * document `failed` (it lands in the admin failed-parse queue) instead of
 * silently indexing garbage. See docs/plan.md §3, §10.
 */
import { extractText } from 'unpdf';
import type { ParsedDocument, ParsedPage, RawDocument } from '../types.js';
import { detectDocLang } from '../../lib/tokens.js';

export async function parsePdf(doc: RawDocument): Promise<ParsedDocument> {
  const { totalPages, text } = await extractText(new Uint8Array(doc.bytes), { mergePages: false });

  const pages: ParsedPage[] = text.map((t, i) => ({ pageNumber: i + 1, text: (t ?? '').trim() }));
  const joined = pages.map((p) => p.text).join('\n\n').trim();

  // Extraction-quality guard: a PDF that yields almost no text is a parse
  // failure (scanned/garbled), not an empty document.
  const nonEmptyPages = pages.filter((p) => p.text.length > 0).length;
  if (joined.length < 20 || nonEmptyPages === 0) {
    throw new Error(
      `PDF extraction produced almost no text (${joined.length} chars over ${totalPages} pages). ` +
        `Likely a scanned or Hebrew-font PDF that needs OCR (a later phase).`,
    );
  }

  return {
    text: joined,
    pages,
    detectedLang: doc.declaredLang ?? detectDocLang(joined),
    charCount: joined.length,
  };
}
