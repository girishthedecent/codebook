import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { appConfig } from '../src/config/app.config.js';
import { EvalCaseType } from '../src/generated/prisma/enums.js';
import { QUERY_MODES } from '../src/modules/retrieval/retrieval.types.js';
import { SEARCH_MODES } from '../src/modules/workspaces/workspace.validator.js';

// A retrieval eval config: evals/configs/retrieval/<name>.json.

export const CONFIG_DIR = 'evals/configs/retrieval';

export const retrievalConfigSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  corpus: z.enum(['context', 'nocontext']).default('context'),
  search: z.strictObject({
    mode: z.enum(SEARCH_MODES),
    rerank: z.boolean(),
    queryMode: z.enum(QUERY_MODES).default('none'),
    rerankerModel: z
      .string()
      .refine(
        (model) => model in appConfig.retrieval.reranker.thresholds,
        'needs score thresholds in appConfig.retrieval.reranker',
      )
      .optional(),
    // Recall@10 needs at least 10 results to look at.
    topK: z.int().min(10).max(appConfig.retrieval.maxTopK).default(appConfig.retrieval.maxTopK),
  }),
  // Least time between two cases' starts; query modes stay under Groq's tokens per minute.
  gapMs: z.int().min(0).default(0),
  timeoutMs: z.int().positive().default(60_000),
  // A corpus without some sources is only compared on the case types it can answer.
  caseTypes: z.array(z.enum(EvalCaseType)).min(1).optional(),
});

export type RetrievalConfig = z.infer<typeof retrievalConfigSchema>;

export async function loadConfig(name: string, dir = CONFIG_DIR): Promise<RetrievalConfig> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Bad config name "${name}"`);
  let raw: string;
  try {
    raw = await readFile(join(dir, `${name}.json`), 'utf8');
  } catch {
    throw new Error(`No config "${name}" in ${dir}`);
  }
  const parsed = retrievalConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Config ${name}:\n${z.prettifyError(parsed.error)}`);
  if (parsed.data.name !== name) {
    throw new Error(`Config ${name}.json is named "${parsed.data.name}"`);
  }
  return parsed.data;
}

export async function configNames(dir = CONFIG_DIR) {
  const files = await readdir(dir);
  return files
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();
}
