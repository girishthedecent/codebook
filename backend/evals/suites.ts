import { answerSuite } from './answerSuite.js';
import { retrievalSuite } from './retrievalSuite.js';
import type { EvalSuite } from './suite.types.js';

// Every suite a run can be started for, by name (the CLI and the eval worker).
export const suites: Record<string, EvalSuite> = {
  [retrievalSuite.suite]: retrievalSuite,
  [answerSuite.suite]: answerSuite,
};
