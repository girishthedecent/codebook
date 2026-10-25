import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { EvalSplit } from '../src/generated/prisma/enums.js';
import { answerConfigNames, loadAnswerConfig } from './answerConfig.js';
import { runAnswers, SUITE as ANSWER } from './answerSuite.js';
import { configNames, loadConfig } from './config.js';
import { CORPUS_VARIANTS, type CorpusVariant } from './corpusWorkspace.js';
import { runRetrieval, SUITE as RETRIEVAL } from './retrievalSuite.js';

// pnpm evals -- --suite retrieval --config hybrid-rerank [--split DEV] [--limit 20]
//   [--tags auth,flow] [--matrix a,b,c | --matrix all] [--resume <runId>] [--dataset core]
// pnpm evals -- --suite answer --config adaptive-agent --limit 10 (same options)
//   [--corpus gate]: another corpus variant than the config's (CI has no book)

const list = (value: string | undefined) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);

async function main() {
  const { values } = parseArgs({
    // `pnpm evals -- --config x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      suite: { type: 'string', default: RETRIEVAL },
      config: { type: 'string' },
      matrix: { type: 'string' },
      split: { type: 'string', default: 'DEV' },
      limit: { type: 'string' },
      tags: { type: 'string' },
      resume: { type: 'string' },
      dataset: { type: 'string', default: 'core' },
      corpus: { type: 'string' },
    },
  });

  if (values.suite !== RETRIEVAL && values.suite !== ANSWER) {
    throw new Error(`Unknown suite "${values.suite}" (${RETRIEVAL} or ${ANSWER})`);
  }
  const split = values.split.toUpperCase();
  if (!(split in EvalSplit)) throw new Error(`--split must be DEV or HELDOUT`);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive whole number');
  }

  const corpus = values.corpus as CorpusVariant | undefined;
  if (corpus !== undefined && !CORPUS_VARIANTS.includes(corpus)) {
    throw new Error(`--corpus must be one of ${CORPUS_VARIANTS.join(', ')}`);
  }
  // The variant becomes part of the run's config, so a resume needs the same --corpus.
  const withCorpus = <C extends { corpus: CorpusVariant }>(config: C) =>
    corpus ? { ...config, corpus } : config;

  const answers = values.suite === ANSWER;
  const allNames = answers ? answerConfigNames : configNames;
  const names =
    values.matrix === 'all' ? await allNames() : (list(values.matrix) ?? list(values.config));
  if (!names?.length) throw new Error('Pass --config <name> or --matrix a,b,c');
  if (values.resume && names.length > 1) throw new Error('--resume takes a single --config');

  const selection = {
    dataset: values.dataset,
    split: split as EvalSplit,
    limit,
    tags: list(values.tags),
    resume: values.resume,
    log: (line: string) => console.log(line),
  };

  if (answers) {
    // Fail on a bad name before spending any quota.
    const configs = await Promise.all(
      names.map(async (name) => withCorpus(await loadAnswerConfig(name))),
    );
    for (const config of configs) {
      const { runId, summary } = await runAnswers({ ...selection, config });
      const value = (n: number | null) => (n === null ? '–' : n.toFixed(3));
      const { overall } = summary;
      console.log(
        `${config.name} (${runId}): correctness ${value(overall.correctness)}, ` +
          `faithfulness ${value(overall.faithfulness)}, ` +
          `citation precision ${value(overall.citationPrecision)}, errors ${overall.errors}`,
      );
    }
    return;
  }

  const configs = await Promise.all(names.map(async (name) => withCorpus(await loadConfig(name))));
  for (const config of configs) {
    const { runId, summary } = await runRetrieval({ ...selection, config });
    const { overall } = summary;
    console.log(
      `${config.name} (${runId}): recall@5 ${overall.recall5.toFixed(3)}, ` +
        `recall@10 ${overall.recall10.toFixed(3)}, MRR ${overall.mrr.toFixed(3)}, ` +
        `errors ${overall.errors}, tainted ${summary.taintedCases}`,
    );
  }
  console.log('Write the report with: pnpm evals:report');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
