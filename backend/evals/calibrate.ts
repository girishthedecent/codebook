import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import { judgeGroundingPrompt } from '../src/llm/prompts/judgeGrounding.js';
import { agreement, candidatesFrom, fileSchema, LABELS_FILE, sampleLabels } from './calibration.js';
import { judgeModel } from './scorers/judge.js';

// pnpm evals:calibrate [--runs id,id] [--count 20] [--force]   writes claims to label
// pnpm evals:calibrate -- --score                              reports the judge's agreement

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      runs: { type: 'string' },
      count: { type: 'string', default: '20' },
      score: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  });

  if (values.score) {
    const file = fileSchema.parse(JSON.parse(await readFile(LABELS_FILE, 'utf8')));
    const result = agreement(file.items);
    if (result.rate === null) throw new Error(`No labels yet: fill in "human" in ${LABELS_FILE}`);
    console.log(
      `Judge ${file.judge} (${file.prompt}) agrees with you on ${result.agree} of ` +
        `${result.labelled} claims (${(result.rate * 100).toFixed(0)}%). Judged supported but ` +
        `not: ${result.falseSupported}; judged unsupported but supported: ${result.falseUnsupported}.`,
    );
    return;
  }

  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive number');
  if (existsSync(LABELS_FILE) && !values.force) {
    const current = fileSchema.safeParse(JSON.parse(await readFile(LABELS_FILE, 'utf8')));
    if (current.success && current.data.items.some((item) => item.human !== null)) {
      throw new Error(`${LABELS_FILE} already has labels; pass --force to replace it`);
    }
  }
  const ids = values.runs
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const items = sampleLabels(await candidatesFrom(ids), count);
  if (items.length === 0) throw new Error('No judged claims in those runs');

  await mkdir('evals/calibration', { recursive: true });
  await writeFile(
    LABELS_FILE,
    `${JSON.stringify(
      {
        judge: judgeModel(),
        prompt: judgeGroundingPrompt.id,
        createdAt: new Date().toISOString(),
        items,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Wrote ${items.length} claims to ${LABELS_FILE}. Set "human" to true or false on each, ` +
      'then run pnpm evals:calibrate -- --score',
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
