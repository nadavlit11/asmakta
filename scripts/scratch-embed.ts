/**
 * Manual check: embed a string and print the vector length + token usage.
 *   npm run scratch:embed "שלום עולם"
 * Requires VOYAGE_API_KEY.
 */
import { embedQuery } from '../src/lib/voyage.js';
import { embeddingCost } from '../src/lib/cost.js';

async function main(): Promise<void> {
  const text = process.argv.slice(2).join(' ') || 'שלום עולם / hello world';
  const { embedding, totalTokens, model } = await embedQuery(text);
  console.log(`model:        ${model}`);
  console.log(`input:        ${text}`);
  console.log(`vector length: ${embedding.length}`);
  console.log(`first 5 dims:  [${embedding.slice(0, 5).map((n) => n.toFixed(4)).join(', ')}]`);
  console.log(`tokens:        ${totalTokens}`);
  console.log(`cost:          $${embeddingCost(model, totalTokens).toFixed(6)}`);
}

void main();
