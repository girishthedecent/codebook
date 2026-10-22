import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import prismaClient from './db.config.js';
import { serverConfig } from './index.js';
import logger from './logger.config.js';

// Set from req.ip on every request (clientIp.middleware.ts); a client-sent value is overwritten.
export const CLIENT_IP_HEADER = 'x-client-ip';

const DAY = 60 * 60 * 24;

const github =
  serverConfig.GITHUB_CLIENT_ID && serverConfig.GITHUB_CLIENT_SECRET
    ? { clientId: serverConfig.GITHUB_CLIENT_ID, clientSecret: serverConfig.GITHUB_CLIENT_SECRET }
    : undefined;

export const auth = betterAuth({
  baseURL: serverConfig.BETTER_AUTH_URL,
  secret: serverConfig.BETTER_AUTH_SECRET,
  trustedOrigins: serverConfig.TRUSTED_ORIGINS,
  database: prismaAdapter(prismaClient, { provider: 'postgresql' }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders: github ? { github } : {},

  session: {
    expiresIn: 7 * DAY,
    updateAge: DAY,
  },

  user: {
    additionalFields: {
      // Set by the server only (guest sign-in, demo workspace owner), never from a sign-up body.
      isGuest: { type: 'boolean', defaultValue: false, input: false },
      isSystem: { type: 'boolean', defaultValue: false, input: false },
    },
  },

  // The built-in limiter is on in production by default; keep it on in dev too so
  // auth behaves the same, and off in tests where many sign-ups run back to back.
  rateLimit: {
    enabled: serverConfig.NODE_ENV !== 'test',
  },

  advanced: {
    useSecureCookies: serverConfig.NODE_ENV === 'production',
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    // better-auth skips its CSRF origin check when NODE_ENV=test; keep it on so tests
    // exercise the same protection as production.
    disableOriginCheck: false,
  },

  // Route better-auth's own messages through winston so they get the correlation id.
  logger: {
    log: (level, message, ...args) =>
      logger.log(level, `[better-auth] ${message}`, args.length > 0 ? { args } : {}),
  },
});

export type AuthSession = typeof auth.$Infer.Session;
