import prismaClient from '../../src/config/db.config.js';

/** Empties every table except Prisma's migration history. */
export async function resetDb() {
  const tables = await prismaClient.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const names = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prismaClient.$executeRawUnsafe(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}
