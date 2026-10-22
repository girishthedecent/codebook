import { afterAll } from 'vitest';
import { useTestEnv } from './testEnv.js';

useTestEnv();

afterAll(async () => {
  const { default: prismaClient } = await import('../src/config/db.config.js');
  await prismaClient.$disconnect();
});
