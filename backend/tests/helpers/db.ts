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

/** Connections in this database that are waiting on a lock (for race tests). */
export async function countLockWaiters() {
  const [row] = await prismaClient.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `;
  return row?.count ?? 0;
}
