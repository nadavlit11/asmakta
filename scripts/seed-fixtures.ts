/**
 * Seed eval fixtures for the labor-rights corpus from
 * src/eval/fixtures/labor-rights.json. Idempotent (replaces existing fixtures).
 *   npm run seed:fixtures            # write to DB (needs DATABASE_URL only)
 *   npm run seed:fixtures -- --dry   # validate + print category/lang spread
 *
 * Fixtures reference expected sources by filename, so this does NOT depend on
 * the corpus being embedded — safe to run before or after seed:corpus.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { query } from '../src/db/client.js';
import { getCorpusBySlug } from '../src/db/queries.js';
import { closePool } from '../src/db/client.js';

const FIXTURES_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'eval', 'fixtures', 'labor-rights.json');

const FixtureSchema = z
  .object({
    question: z.string().min(1),
    lang: z.enum(['he', 'en']),
    category: z.enum(['answerable', 'trap', 'multi_hop']),
    isAnswerable: z.boolean(),
    goldAnswer: z.string().nullable(),
    expectedDocFilenames: z.array(z.string()),
  })
  .refine((f) => (f.isAnswerable ? f.goldAnswer !== null : f.goldAnswer === null), {
    message: 'answerable fixtures need a goldAnswer; traps must have goldAnswer null',
  })
  .refine((f) => (f.isAnswerable ? true : f.expectedDocFilenames.length === 0), {
    message: 'traps must have no expected source documents',
  });

const FixturesSchema = z.array(FixtureSchema);
type Fixture = z.infer<typeof FixtureSchema>;

function load(): Fixture[] {
  const raw = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as unknown;
  return FixturesSchema.parse(raw);
}

function summarize(fixtures: Fixture[]): void {
  const byCat = new Map<string, number>();
  const byLang = new Map<string, number>();
  for (const f of fixtures) {
    byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
    byLang.set(f.lang, (byLang.get(f.lang) ?? 0) + 1);
  }
  console.log(`total: ${fixtures.length}`);
  console.log('by category:', Object.fromEntries(byCat));
  console.log('by language:', Object.fromEntries(byLang));
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const fixtures = load();
  summarize(fixtures);
  if (dry) {
    console.log('\n[dry] valid — not written.');
    return;
  }

  const corpus = await getCorpusBySlug('labor-rights');
  if (!corpus) throw new Error('corpus not found — run `npm run migrate`');

  await query('DELETE FROM eval_fixtures WHERE corpus_id = $1', [corpus.id]);
  for (const f of fixtures) {
    await query(
      `INSERT INTO eval_fixtures (corpus_id, question, lang, category, is_answerable, gold_answer, expected_doc_filenames)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [corpus.id, f.question, f.lang, f.category, f.isAnswerable, f.goldAnswer, f.expectedDocFilenames],
    );
  }
  console.log(`\nseeded ${fixtures.length} fixtures for corpus ${corpus.slug}.`);
  await closePool();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
