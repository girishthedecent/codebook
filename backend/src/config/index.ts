import 'dotenv/config';
import { isIP } from 'node:net';
import { z } from 'zod';

const optional = z.string().optional();

// z.url() alone accepts things like `localhost:5432/db` (scheme "localhost").
const httpUrl = z.url({ protocol: /^https?$/ });
const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const originList = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(httpUrl));

// Names Express understands, plus plain IPs and CIDR subnets.
const PROXY_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isTrustProxyValue(value: string) {
  if (value === 'true' || value === 'false' || /^\d+$/.test(value)) return true;
  return value.split(',').every((part) => {
    const item = part.trim();
    if (PROXY_NAMES.has(item)) return true;
    const [ip, prefix, ...rest] = item.split('/');
    const version = ip ? isIP(ip) : 0;
    if (rest.length > 0 || version === 0) return false;
    if (prefix === undefined) return true;
    const bits = Number(prefix);
    return /^\d+$/.test(prefix) && bits >= 1 && bits <= (version === 4 ? 32 : 128);
  });
}

const schema = z.object({
  // Defaults to production so a deploy that forgets NODE_ENV doesn't run with dev settings.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: httpUrl.default('http://localhost:4000'),
  // Express "trust proxy": false, true, a hop count, or a list of proxy IPs/subnets.
  // Behind a load balancer this must be set or every client gets the proxy's IP.
  TRUST_PROXY: z
    .string()
    .default('false')
    .refine(isTrustProxyValue, 'must be true, false, a hop count, or a comma list of IPs/subnets')
    .transform((v): boolean | number | string => {
      if (v === 'true') return true;
      if (v === 'false') return false;
      return /^\d+$/.test(v) ? Number(v) : v;
    }),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly', 'silent'])
    .default('info'),
  // Rotating files are for local runs; in containers logs go to stdout and the platform collects them.
  LOG_TO_FILE: z.stringbool().default(false),

  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: optional,

  TRUSTED_ORIGINS: originList,

  // Auth, providers and storage become required in the phases that use them.
  BETTER_AUTH_SECRET: optional,
  BETTER_AUTH_URL: httpUrl.optional(),
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  GITHUB_TOKEN: optional,

  S3_ENDPOINT: optional,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: optional,
  S3_ACCESS_KEY: optional,
  S3_SECRET_KEY: optional,
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  INNGEST_DEV: z.stringbool().default(false),
  INNGEST_BASE_URL: optional,
  INNGEST_EVENT_KEY: optional,
  INNGEST_SIGNING_KEY: optional,

  GROQ_API_KEY: optional,
  GEMINI_API_KEY: optional,
  TAVILY_API_KEY: optional,

  RERANKER_MODEL: z.string().default('Xenova/bge-reranker-base'),
  RERANKER_CACHE_DIR: z.string().default('.cache/models'),

  LIVE_TESTS: z.stringbool().default(false),
});

export type ServerConfig = z.infer<typeof schema>;

export function parseServerConfig(source: NodeJS.ProcessEnv): ServerConfig {
  // `NAME=` in .env means "not set", so empty values get their default (or stay undefined).
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(present);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

function loadServerConfig(): ServerConfig {
  try {
    return parseServerConfig(process.env);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

export const serverConfig = loadServerConfig();
