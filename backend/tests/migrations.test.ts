import { describe, expect, it } from 'vitest';
import prismaClient from '../src/config/db.config.js';

// Prisma can't describe these in schema.prisma, so every new migration it generates tries to
// drop them. `pnpm db:migrate:new` only creates the file; the DROP lines for these objects
// must be deleted from it by hand. This test catches a migration where that was missed.
describe('database objects created with raw SQL', () => {
  it('keeps the vector and keyword indexes on SourceChunk', async () => {
    const rows = await prismaClient.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'SourceChunk'
    `;
    const defs = new Map(rows.map((row) => [row.indexname, row.indexdef]));
    expect(defs.get('SourceChunk_embedding_idx')).toMatch(
      /USING hnsw \(embedding vector_cosine_ops\)/,
    );
    expect(defs.get('SourceChunk_tsv_idx')).toMatch(/USING gin \(tsv\)/);
  });

  it('keeps tsv as a column Postgres generates from searchText', async () => {
    const [column] = await prismaClient.$queryRaw<{ is_generated: string; expr: string }[]>`
      SELECT is_generated, generation_expression AS expr FROM information_schema.columns
      WHERE table_name = 'SourceChunk' AND column_name = 'tsv'
    `;
    expect(column).toMatchObject({
      is_generated: 'ALWAYS',
      expr: expect.stringContaining('searchText'),
    });
  });
});
