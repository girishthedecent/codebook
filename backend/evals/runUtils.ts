import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import prismaClient from '../src/config/db.config.js';
import { Prisma, type EvalCase } from '../src/generated/prisma/client.js';
import type { UsageType } from '../src/generated/prisma/enums.js';

// What every suite needs to record a run: the code version, the cases it ran on, settings
// compared in a stable form, and what the eval user's model calls cost.

/**
 * HEAD, or HEAD plus a hash of the uncommitted changes (tracked diff and untracked files), so
 * two different working trees never record the same version.
 */
export function codeVersion(
  head: string,
  diff: string,
  untracked: { path: string; content: Buffer }[],
) {
  if (!diff && untracked.length === 0) return head;
  const hash = createHash('sha256').update(diff);
  for (const file of untracked)
    hash.update('\0').update(file.path).update('\0').update(file.content);
  return `${head}-dirty-${hash.digest('hex').slice(0, 8)}`;
}

export function gitSha() {
  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
      .split('\0')
      .filter(Boolean)
      .sort()
      .map((path) => ({ path, content: readFileSync(path) }));
    return codeVersion(git('rev-parse', 'HEAD').trim(), git('diff', 'HEAD'), untracked);
  } catch {
    return 'unknown';
  }
}

/** JSON with object keys sorted, so a config read back from jsonb compares equal. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** A hash of what the selected cases ask and expect, so a resume can tell they changed. */
export function casesHash<
  C extends Pick<EvalCase, 'externalId' | 'type' | 'question' | 'expectedRefs'>,
>(
  cases: C[],
  // More fields a suite depends on, e.g. the expected answer for judged runs.
  extra: (evalCase: C) => Record<string, unknown> = () => ({}),
) {
  const fields = cases.map((evalCase) => ({
    externalId: evalCase.externalId,
    type: evalCase.type,
    question: evalCase.question,
    expectedRefs: evalCase.expectedRefs,
    ...extra(evalCase),
  }));
  return createHash('sha256').update(canonical(fields)).digest('hex').slice(0, 16);
}

export function withTimeout<T>(promise: Promise<T>, signal: AbortSignal, ms: number) {
  const timeout = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error(`Timed out after ${ms} ms`)), {
      once: true,
    });
  });
  return Promise.race([promise, timeout]);
}

export type UsageFilter = {
  task?: string;
  type?: UsageType;
  // Only calls made for no chat message (a turn's own calls carry its message id).
  outsideMessages?: boolean;
};

/** What the user's model and embedding calls cost between two moments. */
export async function usageCost(userId: string, from: Date, to: Date, filter: UsageFilter = {}) {
  const { _sum } = await prismaClient.usageEvent.aggregate({
    where: {
      userId,
      createdAt: { gte: from, lte: to },
      ...(filter.task ? { task: filter.task } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.outsideMessages ? { messageId: null } : {}),
    },
    _sum: { costUsd: true },
  });
  return _sum.costUsd ?? new Prisma.Decimal(0);
}

export const errorMessage = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught);
