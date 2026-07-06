/**
 * HTML parser (cheerio). Strips boilerplate and emits headings as markdown-style
 * lines (`## Heading`) so the chunker can attach the nearest heading to a chunk.
 */
import * as cheerio from 'cheerio';
import type { ParsedDocument, RawDocument } from '../types.js';
import { detectDocLang } from '../../lib/tokens.js';

export async function parseHtml(doc: RawDocument): Promise<ParsedDocument> {
  const $ = cheerio.load(doc.bytes.toString('utf8'));
  $('script, style, nav, footer, header, noscript, aside, form, svg').remove();

  const parts: string[] = [];
  $('h1, h2, h3, h4, h5, h6, p, li').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName ?? '';
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    if (!txt) return;
    const h = /^h([1-6])$/.exec(tag);
    parts.push(h && h[1] ? `${'#'.repeat(Number(h[1]))} ${txt}` : txt);
  });

  const text = parts.join('\n\n').trim();
  if (text.length < 20) {
    throw new Error(`HTML extraction produced almost no text (${text.length} chars).`);
  }
  return {
    text,
    detectedLang: doc.declaredLang ?? detectDocLang(text),
    charCount: text.length,
  };
}
