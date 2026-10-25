import { parseArgs } from 'node:util';
import prismaClient from '../src/config/db.config.js';
import {
  addNew,
  FAILURE_FILE,
  failureCandidates,
  readCandidates,
  writeJson,
  type FailureScope,
} from './candidates.js';

// pnpm evals:failures -- --workspace <id> | --user <id> [--limit 200]
// Collects answers that went wrong (thumbs down, invalid citations, weak retrieval) into
// evals/datasets/failure-candidates.json. Fill in each one's type, expected answer and refs,
// set "accepted": true, then: pnpm evals:import -- --candidates <that file>

async function main() {
  const { values } = parseArgs({
    // `pnpm evals:failures -- --workspace x` passes the "--" through.
    args: process.argv.slice(2).filter((arg, i) => i > 0 || arg !== '--'),
    options: {
      workspace: { type: 'string' },
      user: { type: 'string' },
      limit: { type: 'string', default: '200' },
    },
  });
  // Always one workspace or one user: other people's questions don't belong in a test set
  // unless someone chose them.
  if (Boolean(values.workspace) === Boolean(values.user)) {
    throw new Error('Pass exactly one of --workspace <id> or --user <id>');
  }
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('--limit must be 1 to 1000');
  }
  const scope: FailureScope = values.workspace
    ? { workspaceId: values.workspace }
    : { userId: values.user! };

  const found = await failureCandidates(scope, limit);
  const { candidates, added } = addNew(await readCandidates(FAILURE_FILE), found);
  await writeJson(FAILURE_FILE, candidates);
  console.log(`Found ${found.length} failed answers, ${added} new, in ${FAILURE_FILE}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
