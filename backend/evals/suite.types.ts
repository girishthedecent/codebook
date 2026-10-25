import type { EvalSplit } from '../src/generated/prisma/enums.js';

// What a suite (retrieval, answer) offers to whoever drives a run: the CLI loops over the
// cases itself, the eval worker's Inngest function runs one case per step.

export type SuiteStartOptions = {
  dataset: string;
  config: string;
  split: EvalSplit;
  limit?: number;
  tags?: string[];
  // An earlier run of the same config: finished cases are kept, failed ones run again.
  resume?: string;
};

export type StartedRun = {
  runId: string;
  // Cases still to run, in order.
  caseIds: string[];
  // Least time between two cases' starts, from the config.
  gapMs: number;
};

export interface EvalSuite {
  suite: string;
  configNames(): Promise<string[]>;
  // Validates the config and the corpus, creates (or reopens) the EvalRun.
  start(options: SuiteStartOptions): Promise<StartedRun>;
  // Runs and stores one case. A case already stored without an error is left alone, so a
  // retried step never runs a case twice.
  runCase(runId: string, caseId: string): Promise<{ line: string }>;
  // Writes the summary and marks the run DONE.
  finish(runId: string): Promise<void>;
  fail(runId: string, message: string): Promise<void>;
}
