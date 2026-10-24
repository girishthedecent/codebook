import { InngestTestEngine } from '@inngest/test';
import prismaClient from '../../src/config/db.config.js';
import { ingestSource } from '../../src/modules/ingestion/ingest.function.js';
import { pdfStorageKey } from '../../src/modules/sources/source.storage.js';
import { putObject } from '../../src/utils/storage.js';
import { buildPdf, type OutlineItem } from './pdf.js';

// Test files that ingest also need, at the top:
//   vi.mock('../src/llm/providers.js', () => import('./helpers/llm-mock.js'));
//   vi.mock('../src/utils/pacer.js', () => import('./helpers/no-pacing.js'));

// 12 one-page sections, so the parents need two contextualize steps (10 per step).
export const SECTIONS = Array.from({ length: 12 }, (_, i) => `Topic ${i + 1}`);

export const BOOK_PAGES = [
  'The Fixture Book\nA small book for tests. It checks how a PDF turns into sections, ' +
    'chunks and contexts, and this cover page is long enough to be a section of its own.',
  ...SECTIONS.map(
    (title, i) =>
      `${title}\nPage ${i + 2} says the fact number ${i + 2} is about buckets. ` +
      `Each bucket holds keys for topic ${i + 1}. The end of this page is near.`,
  ),
];

// "Part One" holds the first six topics; the other six are top-level.
export const OUTLINE: OutlineItem[] = [
  {
    title: 'Part One',
    page: 2,
    items: SECTIONS.slice(0, 6).map((title, i) => ({ title, page: i + 2 })),
  },
  ...SECTIONS.slice(6).map((title, i) => ({ title, page: i + 8 })),
];

export const fixtureBook = () => buildPdf({ pages: BOOK_PAGES, outline: OUTLINE });

/** The contextualize model's answer: one context per numbered chunk, naming its section. */
export function contextReply(prompt: string) {
  const section = /Section: (.*)/.exec(prompt)![1]!;
  const chunks = [...prompt.matchAll(/<chunk n="(\d+)">/g)].map((m) => Number(m[1]));
  return JSON.stringify({
    contexts: chunks.map((chunk) => ({ chunk, context: `Context ${chunk} of ${section}.` })),
  });
}

/** The code contextualize model's answer: one context per chunk, naming the chunk's file. */
export function codeContextReply(prompt: string) {
  const contexts: { chunk: number; context: string }[] = [];
  let path = '';
  for (const match of prompt.matchAll(/<file path="([^"]+)">|<chunk n="(\d+)">/g)) {
    if (match[1]) path = match[1];
    else contexts.push({ chunk: Number(match[2]), context: `Context ${match[2]} of ${path}.` });
  }
  return JSON.stringify({ contexts });
}

/** A GitHub repository source, as creating one through the API leaves it. */
export async function createRepoSource(workspaceId: string, ref = 'main') {
  const source = await prismaClient.source.create({
    data: {
      workspaceId,
      type: 'GITHUB_REPO',
      title: 'acme/widgets',
      origin: { owner: 'acme', repo: 'widgets', ref, defaultBranch: 'main' },
      dedupeKey: `github:acme/widgets@${ref}`,
    },
  });
  return source.id;
}

/** A PDF source with its file in the test bucket, as an upload leaves it. */
export async function createPdfSource(
  userId: string,
  workspaceId: string,
  file: Buffer = fixtureBook(),
  title = 'Fixture Book',
) {
  const source = await prismaClient.source.create({
    data: { workspaceId, type: 'PDF', title, origin: {}, dedupeKey: `pdf:${title}` },
  });
  const storageKey = pdfStorageKey(userId, workspaceId, source.id);
  await putObject(storageKey, file, { contentType: 'application/pdf', contentLength: file.length });
  await prismaClient.source.update({
    where: { id: source.id },
    data: {
      origin: { storageKey, fileName: 'fixture.pdf', size: file.length, mime: 'application/pdf' },
    },
  });
  return source.id;
}

let runs = 0;

/** Runs the ingest function in-process, steps and all (no Inngest server). */
export async function ingest(sourceId: string) {
  // The test engine makes up a new run id for every step it executes; real Inngest keeps one
  // per run, and the draft's owner check depends on that.
  const runId = `test-run-${++runs}`;
  const engine = new InngestTestEngine({
    function: ingestSource,
    events: [{ name: 'source/ingest.requested', data: { sourceId, reason: 'created' } }],
    transformCtx: (ctx) => ({ ...ctx, runId }),
  });
  return engine.execute();
}
