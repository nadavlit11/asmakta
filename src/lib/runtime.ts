/**
 * Robust "am I the entry module?" check that works across `tsx file.ts`,
 * `node file.js`, npm scripts, and relative/absolute argv paths. Compares
 * realpath of import.meta.url against realpath of process.argv[1].
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}
