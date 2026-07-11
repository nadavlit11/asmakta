/**
 * Offline token/language heuristics — no API key required.
 *
 * `estimateTokens` is an APPROXIMATION used for chunk sizing only. It does NOT
 * need to match Claude/Voyage tokenizers exactly. Exact token counts for cost
 * come from the provider `usage` fields at call time (see src/lib/cost.ts) or,
 * for pre-flight budgeting, Anthropic's count_tokens endpoint.
 */

const HEBREW_RE = /[֐-׿]/;
const LETTER_RE = /[\p{L}]/u;

/** Fraction (0..1) of letters that are Hebrew. Non-letters are ignored. */
export function hebrewRatio(text: string): number {
  let letters = 0;
  let hebrew = 0;
  for (const ch of text) {
    if (LETTER_RE.test(ch)) {
      letters++;
      if (HEBREW_RE.test(ch)) hebrew++;
    }
  }
  return letters === 0 ? 0 : hebrew / letters;
}

/** Chunk-level language label. */
export function detectChunkLang(text: string): 'he' | 'en' {
  return hebrewRatio(text) >= 0.2 ? 'he' : 'en';
}

/** Document-level language label; 'mixed' when both scripts are well-represented. */
export function detectDocLang(text: string): 'he' | 'en' | 'mixed' {
  const r = hebrewRatio(text);
  if (r >= 0.65) return 'he';
  if (r <= 0.15) return 'en';
  return 'mixed';
}

/**
 * Approximate token count. Hebrew tokenizes denser than English, so chars-per-
 * token drops as the Hebrew ratio rises (~4 cpt all-English → ~2.5 cpt all-Hebrew).
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const charsPerToken = 4 - 1.5 * hebrewRatio(trimmed);
  return Math.ceil(trimmed.length / charsPerToken);
}
