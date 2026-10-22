import { execFileSync } from 'node:child_process';
import { useTestEnv } from './testEnv.js';

export default function setup() {
  useTestEnv();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: process.env,
    stdio: 'pipe',
  });
}
