import 'dotenv/config';
import { isIP } from 'node:net';
import { z } from 'zod';
import { appConfig } from './app.config.js';

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

const baseSchema = z.object({
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

  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Required in production: OAuth callbacks and cookies are built from it.
  BETTER_AUTH_URL: httpUrl.optional(),
  // GitHub login is turned on only when both are set.
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  TRUSTED_ORIGINS: originList,

  // Providers and storage become required (in production) in the phases that use them.
  GITHUB_TOKEN: optional,

  S3_ENDPOINT: httpUrl.optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: optional,
  S3_ACCESS_KEY: optional,
  S3_SECRET_KEY: optional,
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  INNGEST_DEV: z.stringbool().default(false),
  INNGEST_BASE_URL: httpUrl.optional(),
  INNGEST_EVENT_KEY: optional,
  INNGEST_SIGNING_KEY: optional,

  GROQ_API_KEY: optional,
  GEMINI_API_KEY: optional,
  TAVILY_API_KEY: optional,

  // bge-reranker-base scores a little better but takes ~23s for 20 chunks on a 4-core CPU;
  // MiniLM takes ~2s. Evals compare the two.
  RERANKER_MODEL: z
    .string()
    .default('Xenova/ms-marco-MiniLM-L-6-v2')
    .refine(
      (model) => model in appConfig.retrieval.reranker.thresholds,
      'needs score thresholds in appConfig.retrieval.reranker',
    ),
  RERANKER_CACHE_DIR: z.string().default('.cache/models'),

  LIVE_TESTS: z.stringbool().default(false),
});

const schema = baseSchema
  .superRefine((config, ctx) => {
    // `true` takes the left-most X-Forwarded-For entry, which the client writes, so anyone could
    // pick their own IP and dodge the sign-in rate limit.
    if (config.NODE_ENV === 'production' && config.TRUST_PROXY === true) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'true trusts client-supplied X-Forwarded-For; use a hop count or proxy IPs',
      });
    }
    if (config.NODE_ENV === 'production') {
      // Locally these have dev defaults or mocks; a deploy without them would only fail later,
      // on the first upload, queued job or model call.
      const required = [
        'BETTER_AUTH_URL',
        'GROQ_API_KEY',
        'GEMINI_API_KEY',
        'S3_ENDPOINT',
        'S3_BUCKET',
        'S3_ACCESS_KEY',
        'S3_SECRET_KEY',
        'INNGEST_EVENT_KEY',
        'INNGEST_SIGNING_KEY',
      ] as const;
      for (const name of required) {
        if (!config[name]) {
          ctx.addIssue({ code: 'custom', path: [name], message: 'required in production' });
        }
      }
      // Dev mode skips request signing, so anyone could call /api/inngest and run functions.
      if (config.INNGEST_DEV) {
        ctx.addIssue({
          code: 'custom',
          path: ['INNGEST_DEV'],
          message: 'must be off in production (it turns off request signing)',
        });
      }
    }
    if (!!config.GITHUB_CLIENT_ID !== !!config.GITHUB_CLIENT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['GITHUB_CLIENT_SECRET'],
        message: 'set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or neither',
      });
    }
  })
  .transform((config) => ({
    ...config,
    BETTER_AUTH_URL: config.BETTER_AUTH_URL ?? 'http://localhost:4000',
  }));

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
