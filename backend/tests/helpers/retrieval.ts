import { randomUUID } from 'node:crypto';
import prismaClient from '../../src/config/db.config.js';
import type { SourceType } from '../../src/generated/prisma/enums.js';

// Search fixtures written straight to the database, with vectors chosen by the test: a
// query embedded as vectorOf(1) has cosine similarity `s` with a chunk stored as
// similarTo(s), so the vector ranking is known in advance.

const DIMENSIONS = 1536;

/** A unit vector with these leading components, zero after them. */
export function vectorOf(...components: number[]) {
  const length = Math.hypot(...components);
  const vector = new Array<number>(DIMENSIONS).fill(0);
  components.forEach((component, i) => (vector[i] = component / length));
  return vector;
}

/** A unit vector whose cosine similarity with vectorOf(1) is `similarity`. */
export function similarTo(similarity: number, axis = 1) {
  const components = new Array<number>(axis + 1).fill(0);
  components[0] = similarity;
  components[axis] = Math.sqrt(1 - similarity ** 2);
  return vectorOf(...components);
}

export type SeedParent = {
  content: string;
  tokenCount: number;
  headingPath?: string[];
  path?: string;
};

export type SeedChunk = {
  content: string;
  // Defaults to the content; tsv is generated from it.
  searchText?: string;
  // Left out: the chunk has no embedding, so only keyword search can find it.
  vector?: number[];
  // Key of a parent in the same seedSource call.
  parent?: string;
  headingPath?: string[];
  symbolName?: string;
  path?: string;
};

type SeedSource = {
  type?: SourceType;
  title?: string;
  // Document path for parents and chunks that don't name their own.
  path?: string;
  parents?: Record<string, SeedParent>;
  chunks: Record<string, SeedChunk>;
};

/** A READY source with its documents, parents and children. Returns the ids by key. */
export async function seedSource(workspaceId: string, seed: SeedSource) {
  const { type = 'PDF', title = 'Fixture', path = 'fixture.pdf', parents = {}, chunks } = seed;
  const source = await prismaClient.source.create({
    data: {
      workspaceId,
      type,
      title,
      status: 'READY',
      stage: 'DONE',
      progress: 100,
      origin: {},
      dedupeKey: `fixture:${randomUUID()}`,
    },
  });

  const documents = new Map<string, string>();
  async function documentFor(docPath: string) {
    let id = documents.get(docPath);
    if (!id) {
      id = randomUUID();
      await prismaClient.sourceDocument.create({
        data: { id, sourceId: source.id, path: docPath, content: '', sizeBytes: 0, hash: 'h' },
      });
      documents.set(docPath, id);
    }
    return id;
  }

  const ids: Record<string, string> = {};
  let ordinal = 0;
  for (const [key, parent] of Object.entries(parents)) {
    ids[key] = randomUUID();
    await prismaClient.sourceChunk.create({
      data: {
        id: ids[key],
        sourceId: source.id,
        documentId: await documentFor(parent.path ?? path),
        workspaceId,
        kind: 'PARENT',
        ordinal: ordinal++,
        content: parent.content,
        headingPath: parent.headingPath ?? [],
        tokenCount: parent.tokenCount,
        hash: 'h',
        searchText: '',
      },
    });
  }

  ordinal = 0;
  for (const [key, chunk] of Object.entries(chunks)) {
    ids[key] = randomUUID();
    await prismaClient.sourceChunk.create({
      data: {
        id: ids[key],
        sourceId: source.id,
        documentId: await documentFor(chunk.path ?? path),
        workspaceId,
        parentId: chunk.parent ? ids[chunk.parent] : null,
        kind: 'CHILD',
        ordinal: ordinal++,
        content: chunk.content,
        headingPath: chunk.headingPath ?? [],
        symbolName: chunk.symbolName ?? null,
        tokenCount: Math.ceil(chunk.content.length / 4),
        hash: 'h',
        searchText: chunk.searchText ?? chunk.content,
      },
    });
    if (chunk.vector) {
      await prismaClient.$executeRaw`
        UPDATE "SourceChunk" SET embedding = ${`[${chunk.vector.join(',')}]`}::vector
        WHERE id = ${ids[key]}
      `;
    }
  }

  return { sourceId: source.id, ids };
}
