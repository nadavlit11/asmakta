/** Parser dispatch by MIME type (with filename-extension fallback). */
import type { ParsedDocument, RawDocument } from '../types.js';
import { SUPPORTED_MIME } from '../types.js';
import { parsePdf } from './pdf.js';
import { parseDocx } from './docx.js';
import { parseHtml } from './html.js';
import { parseMarkdown } from './md.js';

function normalizeMime(doc: RawDocument): string {
  const m = doc.mimeType.toLowerCase();
  if (m.includes('pdf')) return SUPPORTED_MIME.pdf;
  if (m.includes('wordprocessingml') || m.includes('msword')) return SUPPORTED_MIME.docx;
  if (m.includes('html')) return SUPPORTED_MIME.html;
  if (m.includes('markdown')) return SUPPORTED_MIME.markdown;
  // Fallback to extension.
  const ext = doc.filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return SUPPORTED_MIME.pdf;
  if (ext === 'docx') return SUPPORTED_MIME.docx;
  if (ext === 'html' || ext === 'htm') return SUPPORTED_MIME.html;
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return SUPPORTED_MIME.markdown;
  return m;
}

export async function parseDocument(doc: RawDocument): Promise<ParsedDocument> {
  const mime = normalizeMime(doc);
  switch (mime) {
    case SUPPORTED_MIME.pdf:
      return parsePdf(doc);
    case SUPPORTED_MIME.docx:
      return parseDocx(doc);
    case SUPPORTED_MIME.html:
      return parseHtml(doc);
    case SUPPORTED_MIME.markdown:
      return parseMarkdown(doc);
    default:
      throw new Error(`Unsupported document type: ${doc.mimeType} (${doc.filename}).`);
  }
}
