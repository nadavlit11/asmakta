import { describe, it, expect } from 'vitest';
import { parseDocument } from '../src/ingest/parse/index.js';
import { parseHtml } from '../src/ingest/parse/html.js';
import { parseMarkdown } from '../src/ingest/parse/md.js';
import type { RawDocument } from '../src/ingest/types.js';

function raw(partial: Partial<RawDocument> & { bytes: Buffer }): RawDocument {
  return { corpusId: 0, version: 1, filename: 'x', mimeType: 'application/octet-stream', ...partial };
}

describe('parseMarkdown', () => {
  it('strips fenced code blocks and keeps prose', async () => {
    const md = '# Title\n\nHere is prose about vacation days.\n\n```js\nconst secret = 1;\n```\n\nMore prose here.';
    const parsed = await parseMarkdown(raw({ bytes: Buffer.from(md), filename: 'a.md' }));
    expect(parsed.text).toContain('Here is prose');
    expect(parsed.text).toContain('More prose');
    expect(parsed.text).not.toContain('const secret');
    expect(parsed.detectedLang).toBe('en');
  });

  it('throws on near-empty input', async () => {
    await expect(parseMarkdown(raw({ bytes: Buffer.from('# x'), filename: 'a.md' }))).rejects.toThrow(/almost no text/);
  });
});

describe('parseHtml', () => {
  it('emits markdown-style headings and drops script/style', async () => {
    const html =
      '<html><head><style>.x{}</style></head><body>' +
      '<script>alert(1)</script>' +
      '<h2>Weekly Rest</h2><p>At least 36 consecutive hours of rest.</p>' +
      '<nav>menu junk</nav></body></html>';
    const parsed = await parseHtml(raw({ bytes: Buffer.from(html), mimeType: 'text/html', filename: 'a.html' }));
    expect(parsed.text).toContain('## Weekly Rest');
    expect(parsed.text).toContain('36 consecutive hours');
    expect(parsed.text).not.toContain('alert(1)');
    expect(parsed.text).not.toContain('menu junk');
  });
});

describe('parseDocument dispatch (normalizeMime)', () => {
  it('routes by MIME type', async () => {
    const p = await parseDocument(
      raw({ bytes: Buffer.from('# H\n\nSome markdown body text that is long enough.'), mimeType: 'text/markdown', filename: 'a.md' }),
    );
    expect(p.text).toContain('markdown body');
  });

  it('falls back to the filename extension when MIME is generic', async () => {
    const p = await parseDocument(
      raw({ bytes: Buffer.from('Plain body text long enough to pass the guard.'), mimeType: 'application/octet-stream', filename: 'notes.md' }),
    );
    expect(p.charCount).toBeGreaterThan(20);
  });

  it('throws on an unsupported type', async () => {
    await expect(
      parseDocument(raw({ bytes: Buffer.from('zzzz'), mimeType: 'application/zip', filename: 'a.zip' })),
    ).rejects.toThrow(/Unsupported/);
  });
});
