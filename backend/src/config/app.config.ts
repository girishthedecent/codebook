import { readFileSync } from 'node:fs';

// Same relative path from src/config and dist/config.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Tunables that don't need to change per environment. Each phase adds its own section.
export const appConfig = {
  version: pkg.version,
  http: {
    jsonLimit: '1mb',
    // Sign-in / sign-up payloads are a few hundred bytes.
    authBodyLimitBytes: 64 * 1024,
  },
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
  workspaces: {
    maxPerUser: 20,
  },
} as const;
