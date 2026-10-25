import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import prismaClient from '../src/config/db.config.js';
import { writeJson } from './candidates.js';
import { loadConfig } from './config.js';
import type { CorpusSourceRef } from './corpusWorkspace.js';
import {
  baselineSchema,
  DEFAULT_TOLERANCES,
  GATED_METRICS,
  type Baseline,
  type GateFingerprint,
} from './gateCompare.js';
import { runRetrieval } from './retrievalSuite.js';
import type { Metrics, RunSummary } from './scorers/retrieval.js';

// The gate's database side, shared by `pnpm evals:gate` and `pnpm evals:baseline`.

export const GATE_CONFIG_DIR = 'evals/configs/gate';
export const GATE_CONFIG = 'gate';
export const GATE_TAGS = ['gate'];
export const BASELINE_FILE = 'evals/baseline.json';

/** Runs the gate config over the gate cases of the DEV split; returns the run id. */
export async function runGateCases(dataset: string, log: (line: string) => void) {
  const config = await loadConfig(GATE_CONFIG, GATE_CONFIG_DIR);
  const { runId } = await runRetrieval({ dataset, config, split: 'DEV', tags: GATE_TAGS, log });
  return runId;
}

type StoredRunConfig = {
  casesHash?: string;
  selection?: { tags?: string[] };
  corpus?: { corpusVersion?: string; sources?: CorpusSourceRef[] };
};

/** What a finished gate run measured, and on which corpus and cases. */
export async function gateRunState(runId: string) {
  const run = await prismaClient.evalRun.findUnique({
    where: { id: runId },
    include: { dataset: { select: { name: true } }, _count: { select: { results: true } } },
  });
  if (!run) throw new Error(`No run ${runId}`);
  if (run.status !== 'DONE' || !run.summary) {
    throw new Error(`Run ${runId} is ${run.status}, not finished`);
  }
  const config = run.config as StoredRunConfig;
  if (run.name !== GATE_CONFIG || !config.selection?.tags?.includes('gate')) {
    throw new Error(`Run ${runId} is not a gate run (${run.name})`);
  }

  const refs = config.corpus?.sources ?? [];
  const sources = await prismaClient.source.findMany({
    where: { id: { in: refs.map((ref) => ref.sourceId) } },
    select: { id: true, contentHash: true },
  });
  const sourceHashes = Object.fromEntries(
    refs.map((ref) => [
      ref.sourceKey,
      sources.find((source) => source.id === ref.sourceId)?.contentHash ?? null,
    ]),
  );

  const fingerprint: GateFingerprint = {
    corpusVersion: config.corpus?.corpusVersion ?? 'unknown',
    sourceHashes,
    casesHash: config.casesHash ?? 'unknown',
    cases: run._count.results,
  };
  const metrics = (run.summary as unknown as RunSummary).overall;
  return { run, fingerprint, metrics };
}

export async function readBaseline(file = BASELINE_FILE): Promise<Baseline> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(
      `No ${file}. Make it where the gate corpus is built: pnpm evals:corpus -- --variant gate, ` +
        'then pnpm evals:baseline, and commit the file.',
    );
  }
  const parsed = baselineSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`${file}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const SHOWN: (keyof Metrics)[] = [
  ...GATED_METRICS,
  'hit5',
  'ndcg10',
  'noAnswerAccuracy',
  'falseWeakRate',
];

/** Writes the baseline from a finished gate run; the file is meant to be reviewed in a PR. */
export async function writeBaseline(runId: string, file = BASELINE_FILE) {
  const { run, fingerprint, metrics } = await gateRunState(runId);
  const baseline: Baseline = {
    dataset: run.dataset.name,
    config: run.name,
    split: run.split,
    tags: GATE_TAGS,
    ...fingerprint,
    metrics: Object.fromEntries(SHOWN.map((metric) => [metric, metrics[metric]])),
    tolerances: DEFAULT_TOLERANCES,
    runId: run.id,
    gitSha: run.gitSha,
    createdAt: new Date().toISOString(),
  };
  // Formatted as prettier would, so `pnpm format:check` passes on a fresh baseline.
  await writeJson(file, baseline);
  return baseline;
}
