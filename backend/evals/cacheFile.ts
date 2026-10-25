import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import prismaClient from '../src/config/db.config.js';
import {
  findCachedEmbeddings,
  saveCachedEmbeddings,
} from '../src/llm/embeddingCache.repository.js';
import { embeddingCacheKey, embeddingInput } from '../src/llm/embeddings.js';
import { saveContexts } from '../src/modules/ingestion/ingestion.repository.js';
import {
  isSpecSource,
  loadCorpusSpec,
  localPdfKey,
  sourcesFor,
  workspaceName,
  type CorpusVariant,
} from './corpusWorkspace.js';

// The model output a corpus needs, as a file: the cached embeddings of its chunks and of
// the eval questions, and the cached contexts of its chunks. The gate's file is committed;
// CI loads it before ingesting, so building the gate corpus and running the gate make no
// model calls at all, and need no API keys.

export const GATE_CACHE_FILE = 'evals/cache/gate-cache.jsonl.gz';

// Vectors as their float32 bytes (what pgvector stores), base64: exact, and a third of the
// size of the numbers written out.
type Line =
  | { type: 'embedding'; key: string; f32: string }
  | { type: 'context'; key: string; context: string };

const toBase64 = (vector: number[]) =>
  Buffer.from(new Float32Array(vector).buffer).toString('base64');

function fromBase64(text: string) {
  const bytes = Buffer.from(text, 'base64');
  // Copied into its own buffer: a Float32Array needs a 4-byte aligned offset.
  return Array.from(new Float32Array(new Uint8Array(bytes).buffer));
}

const BATCH = 200;

/** Embedding keys of the sources' indexed chunks, computed as ingestion computes them. */
async function chunkEmbeddingKeys(sourceIds: string[]) {
  const chunks = await prismaClient.sourceChunk.findMany({
    where: { sourceId: { in: sourceIds }, kind: 'CHILD' },
    select: { searchText: true, source: { select: { title: true } } },
  });
  return chunks.map((chunk) =>
    embeddingCacheKey('document', embeddingInput(chunk.searchText, 'document', chunk.source.title)),
  );
}

function questionEmbeddingKeys(questions: string[]) {
  return questions.map((question) => embeddingCacheKey('query', embeddingInput(question, 'query')));
}

/**
 * The cached contexts of the sources' chunks. Their keys depend on the parsed draft, which
 * isn't stored, so they are found by their text. A chunk without a context, or whose context
 * isn't cached, would make the next ingest call the model: that fails the export instead.
 */
async function sourceContexts(sourceIds: string[]) {
  const chunks = await prismaClient.sourceChunk.findMany({
    where: { sourceId: { in: sourceIds }, kind: 'CHILD' },
    select: { context: true },
  });
  const missing = chunks.filter((chunk) => chunk.context === null).length;
  if (missing > 0) {
    throw new Error(`${missing} of ${chunks.length} chunks have no context: resync those sources`);
  }
  const texts = [...new Set(chunks.map((chunk) => chunk.context!))];
  const rows = await prismaClient.contextCache.findMany({
    where: { context: { in: texts } },
    select: { key: true, context: true },
    orderBy: { key: 'asc' },
  });
  const cached = new Set(rows.map((row) => row.context));
  const uncached = texts.filter((text) => !cached.has(text)).length;
  if (uncached > 0) throw new Error(`${uncached} chunk contexts are not in the context cache`);
  return rows;
}

export async function writeCacheFile(file: string, lines: AsyncIterable<Line> | Line[]) {
  await mkdir(dirname(file), { recursive: true });
  async function* text() {
    for await (const line of lines) yield `${JSON.stringify(line)}\n`;
  }
  await pipeline(text, createGzip(), createWriteStream(file));
}

/**
 * Writes the cached rows for these keys, sorted so the same caches give the same file.
 * Throws, writing nothing, when a key has nothing cached: the file must be complete.
 */
export async function exportCache(
  file: string,
  keys: { embeddings: string[]; contexts: { key: string; context: string }[] },
) {
  const unique = [...new Set(keys.embeddings)].sort();
  const found = new Map<string, number[]>();
  for (let i = 0; i < unique.length; i += BATCH) {
    for (const [key, embedding] of await findCachedEmbeddings(unique.slice(i, i + BATCH))) {
      found.set(key, embedding);
    }
  }
  const missing = unique.length - found.size;
  if (missing > 0) {
    throw new Error(`${missing} of ${unique.length} embeddings are not cached: run the gate once`);
  }
  const contexts = [...keys.contexts].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const lines: Line[] = [
    ...unique.map((key): Line => ({ type: 'embedding', key, f32: toBase64(found.get(key)!) })),
    ...contexts.map(({ key, context }): Line => ({ type: 'context', key, context })),
  ];
  await writeCacheFile(file, lines);
  return { embeddings: unique.length, contexts: contexts.length };
}

/** Adds the file's rows to the caches; rows already there are left as they are. */
export async function importCache(file: string) {
  const counts = { embeddings: 0, contexts: 0 };
  let embeddings: { key: string; embedding: number[] }[] = [];
  let contexts: { key: string; context: string }[] = [];
  const flush = async () => {
    await saveCachedEmbeddings(embeddings);
    await saveContexts(contexts);
    counts.embeddings += embeddings.length;
    counts.contexts += contexts.length;
    embeddings = [];
    contexts = [];
  };

  const reader = createInterface({ input: createReadStream(file).pipe(createGunzip()) });
  for await (const raw of reader) {
    if (!raw.trim()) continue;
    const line = JSON.parse(raw) as Line;
    if (line.type === 'embedding')
      embeddings.push({ key: line.key, embedding: fromBase64(line.f32) });
    else if (line.type === 'context') contexts.push({ key: line.key, context: line.context });
    else throw new Error(`Unknown line in ${file}: ${raw.slice(0, 80)}`);
    if (embeddings.length + contexts.length >= BATCH) await flush();
  }
  await flush();
  return counts;
}

/**
 * What a variant needs cached: the chunks of its sources and the questions of the tagged
 * cases. Read from any variant's workspace that has those sources indexed the same way (the
 * gate's sources are indexed with contexts in `context` too), and only ever its sources: the
 * book is never part of the gate, nor of the committed file.
 */
export async function corpusCacheKeys(
  dataset: string,
  variant: CorpusVariant,
  tags: string[],
  from: CorpusVariant = variant,
) {
  const name = workspaceName(dataset, from);
  const workspace = await prismaClient.workspace.findFirst({
    where: { name, user: { isSystem: true } },
    select: { id: true },
  });
  if (!workspace) throw new Error(`No eval workspace "${name}"`);

  const rows = await prismaClient.source.findMany({
    where: { workspaceId: workspace.id, status: 'READY' },
    select: { id: true, type: true, title: true, origin: true, dedupeKey: true },
  });
  const sourceIds: string[] = [];
  for (const entry of sourcesFor(loadCorpusSpec(dataset), variant)) {
    const pdfKey = await localPdfKey(entry);
    const row = rows.find((candidate) => isSpecSource(entry, candidate, pdfKey));
    if (!row) throw new Error(`"${name}" has no READY ${entry.sourceKey}`);
    sourceIds.push(row.id);
  }

  const cases = await prismaClient.evalCase.findMany({
    where: { dataset: { name: dataset }, retired: false, tags: { hasSome: tags } },
    select: { question: true },
  });
  const chunkKeys = await chunkEmbeddingKeys(sourceIds);
  return {
    embeddings: [...chunkKeys, ...questionEmbeddingKeys(cases.map((c) => c.question))],
    contexts: await sourceContexts(sourceIds),
    chunks: chunkKeys.length,
    questions: cases.length,
  };
}
