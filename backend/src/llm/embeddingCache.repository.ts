import prismaClient from '../config/db.config.js';

// pgvector reads and prints vectors as "[0.1,0.2,...]".
function toVectorLiteral(vector: number[]) {
  return `[${vector.join(',')}]`;
}

export async function findCachedEmbeddings(keys: string[]) {
  if (keys.length === 0) return new Map<string, number[]>();
  const rows = await prismaClient.$queryRaw<{ key: string; embedding: string }[]>`
    SELECT key, embedding::text AS embedding FROM "EmbeddingCache" WHERE key = ANY(${keys}::text[])
  `;
  return new Map(rows.map((row) => [row.key, JSON.parse(row.embedding) as number[]]));
}

/** Two calls embedding the same text at once both get here; the second insert is a no-op. */
export async function saveCachedEmbeddings(entries: { key: string; embedding: number[] }[]) {
  if (entries.length === 0) return;
  const keys = entries.map((entry) => entry.key);
  const vectors = entries.map((entry) => toVectorLiteral(entry.embedding));
  await prismaClient.$executeRaw`
    INSERT INTO "EmbeddingCache" (key, embedding)
    SELECT key, embedding::vector FROM unnest(${keys}::text[], ${vectors}::text[]) AS t(key, embedding)
    ON CONFLICT (key) DO NOTHING
  `;
}
