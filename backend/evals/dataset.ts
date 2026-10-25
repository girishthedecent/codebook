import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import prismaClient from '../src/config/db.config.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import {
  EvalCaseOrigin,
  EvalCaseType,
  EvalSplit,
  MemoryKind,
} from '../src/generated/prisma/enums.js';

// The golden-set file format (evals/datasets/<name>.json) and its import into EvalCase rows.

const line = z.int().positive();
const page = z.int().positive();

export const expectedRefSchema = z.discriminatedUnion('sourceKey', [
  z.strictObject({ sourceKey: z.literal('book'), pageStart: page, pageEnd: page }),
  z.strictObject({
    sourceKey: z.literal('repo'),
    path: z.string().trim().min(1),
    lineStart: line,
    lineEnd: line,
  }),
  z.strictObject({
    sourceKey: z.literal('docs'),
    url: z.url(),
    heading: z.string().trim().min(1).optional(),
  }),
]);

export type ExpectedRef = z.infer<typeof expectedRefSchema>;

export const evalCaseSchema = z
  .strictObject({
    id: z.string().trim().min(1).max(64),
    type: z.enum(EvalCaseType),
    split: z.enum(EvalSplit),
    question: z.string().trim().min(1).max(1_000),
    expectedAnswer: z.string().trim().min(1),
    expectedRefs: z.array(expectedRefSchema),
    tags: z.array(z.string().trim().min(1)).default([]),
    reviewed: z.boolean().default(false),
    // Synthetic and failure cases come from the candidate files once reviewed.
    origin: z.enum(EvalCaseOrigin).default('MANUAL'),
    // Seeded as the eval user's memories before the case runs, for memory-on configs.
    memories: z
      .array(
        z.strictObject({
          kind: z.enum(MemoryKind),
          content: z.string().trim().min(1).max(300),
          importance: z.int().min(1).max(5).default(3),
        }),
      )
      .default([]),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'NO_ANSWER' && value.expectedRefs.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'NO_ANSWER cases have no expected refs' });
    }
    if (value.type !== 'NO_ANSWER' && value.expectedRefs.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Answerable cases need at least one ref' });
    }
    for (const ref of value.expectedRefs) {
      const ordered =
        ref.sourceKey === 'book'
          ? ref.pageStart <= ref.pageEnd
          : ref.sourceKey === 'repo'
            ? ref.lineStart <= ref.lineEnd
            : true;
      if (!ordered) ctx.addIssue({ code: 'custom', message: 'A ref range ends before it starts' });
    }
  });

export type EvalCaseInput = z.infer<typeof evalCaseSchema>;

export const datasetFileSchema = z.array(evalCaseSchema).superRefine((cases, ctx) => {
  const seen = new Set<string>();
  for (const { id } of cases) {
    if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `Case id ${id} appears twice` });
    seen.add(id);
  }
});

export async function readDatasetFile(path: string) {
  const parsed = datasetFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${path} is not a valid dataset:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * Upserts the dataset and its cases by external id. Cases already in the database but gone
 * from the file are kept (old runs point at them) but retired, so no new run scores them, and
 * returned for the caller to report. A case back in the file is active again.
 */
export async function importCases(
  name: string,
  cases: EvalCaseInput[],
  corpus?: Prisma.InputJsonValue,
) {
  return prismaClient.$transaction(async (tx) => {
    const dataset = await tx.evalDataset.upsert({
      where: { name },
      create: { name, corpus: corpus ?? [] },
      update: corpus === undefined ? {} : { corpus },
    });

    for (const item of cases) {
      const fields = {
        question: item.question,
        expectedAnswer: item.expectedAnswer,
        expectedRefs: item.expectedRefs,
        type: item.type,
        split: item.split,
        tags: item.tags,
        reviewed: item.reviewed,
        origin: item.origin,
        memories: item.memories,
        retired: false,
      };
      await tx.evalCase.upsert({
        where: { datasetId_externalId: { datasetId: dataset.id, externalId: item.id } },
        create: { datasetId: dataset.id, externalId: item.id, ...fields },
        update: fields,
      });
    }

    const ids = cases.map((item) => item.id);
    const gone = { datasetId: dataset.id, externalId: { notIn: ids } };
    const missing = await tx.evalCase.findMany({
      where: gone,
      select: { externalId: true },
      orderBy: { externalId: 'asc' },
    });
    await tx.evalCase.updateMany({ where: gone, data: { retired: true } });
    return { dataset, imported: cases.length, missing: missing.map((row) => row.externalId) };
  });
}
