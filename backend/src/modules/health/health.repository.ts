import prismaClient from '../../config/db.config.js';

export async function pingDatabase() {
  await prismaClient.$queryRaw`SELECT 1`;
}
