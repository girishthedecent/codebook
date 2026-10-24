import { countTokens } from '../../../utils/tokens.js';
import type { ChunkPlan } from '../ingestion.types.js';

// Top-level imports in the languages we parse: ES modules, CommonJS and Python.
const IMPORT_LINE =
  /^(import\s.+|export\s+(\*|\{[^}]*\})\s+from\s.+|from\s+\S+\s+import\s.+|(const|let|var)\s+.+=\s*require\(.+)$/;

/**
 * A short outline of a repository file for the contextualize prompt: its import lines and
 * the names its chunks belong to (symbols for code, headings for markdown), cut to about
 * `maxTokens`.
 */
export function fileOutline(text: string, plan: ChunkPlan, maxTokens = 300) {
  const imports = text.split('\n').filter((line) => IMPORT_LINE.test(line));
  const names = new Set<string>();
  for (const chunk of [...plan.parents, ...plan.children]) {
    // The first entry is the file path itself.
    if (chunk.headingPath.length > 1) names.add(chunk.headingPath.slice(1).join(' > '));
  }
  const lines = [...imports, ...[...names].map((name) => `defines: ${name}`)];

  const kept: string[] = [];
  let tokens = 0;
  for (const line of lines) {
    const cost = countTokens(line) + 1;
    if (tokens + cost > maxTokens) break;
    kept.push(line);
    tokens += cost;
  }
  return kept.join('\n');
}
