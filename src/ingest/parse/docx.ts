/** DOCX parser (mammoth → raw text). No page structure. */
import mammoth from 'mammoth';
import type { ParsedDocument, RawDocument } from '../types.js';
import { detectDocLang } from '../../lib/tokens.js';

export async function parseDocx(doc: RawDocument): Promise<ParsedDocument> {
  const { value } = await mammoth.extractRawText({ buffer: doc.bytes });
  const text = value.trim();
  if (text.length < 20) {
    throw new Error(`DOCX extraction produced almost no text (${text.length} chars).`);
  }
  return {
    text,
    detectedLang: doc.declaredLang ?? detectDocLang(text),
    charCount: text.length,
  };
}
