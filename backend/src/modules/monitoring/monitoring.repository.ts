import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PageQuery } from '../../utils/helpers/pagination.helpers.js';

// Time ranges come in as Dates; timestamps are stored as UTC without a zone, so the ISO
// strings are read back as UTC.
const utc = (date: Date) => date.toISOString();

// Rows of system users (the eval runner, the demo's owner) are left out unless asked for.
// `userId` is the row's user column. A row with no user (embeddings for an ingest) stays.
function notSystem(includeSystem: boolean, userId: Prisma.Sql) {
  if (includeSystem) return Prisma.empty;
  return Prisma.sql`AND NOT EXISTS (
    SELECT 1 FROM "user" su WHERE su.id = ${userId} AND su."isSystem"
  )`;
}

const messageUser = Prisma.raw(
  '(SELECT c."userId" FROM "Conversation" c WHERE c.id = "Message"."conversationId")',
);
const usageUser = Prisma.raw('"UsageEvent"."userId"');
const sourceUser = Prisma.raw(
  '(SELECT w."userId" FROM "Workspace" w WHERE w.id = "Source"."workspaceId")',
);

type AnswerRow = {
  answers: number;
  latencyP50: number | null;
  latencyP95: number | null;
  firstTokenP50: number | null;
  firstTokenP95: number | null;
  retrievalP50: number | null;
  retrievalP95: number | null;
  errored: number;
  rated: number;
  thumbsDown: number;
  invalidCitations: number;
  weakRetrieval: number;
};

/** Latency percentiles and quality counts over the assistant's answers in [from, to). */
export async function answerStats(from: Date, to: Date, includeSystem: boolean) {
  const [row] = await prismaClient.$queryRaw<AnswerRow[]>`
    SELECT count(*)::int AS answers,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS "latencyP50",
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "latencyP95",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "firstTokenMs") AS "firstTokenP50",
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "firstTokenMs") AS "firstTokenP95",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "retrievalMs") AS "retrievalP50",
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "retrievalMs") AS "retrievalP95",
      count(*) FILTER (WHERE status = 'ERROR')::int AS errored,
      count(*) FILTER (WHERE feedback IS NOT NULL)::int AS rated,
      count(*) FILTER (WHERE feedback = 'DOWN')::int AS "thumbsDown",
      count(*) FILTER (WHERE "invalidCitations" > 0)::int AS "invalidCitations",
      count(*) FILTER (WHERE "weakRetrieval")::int AS "weakRetrieval"
    FROM "Message"
    WHERE role = 'ASSISTANT'
      AND "createdAt" >= ${utc(from)}::timestamptz AT TIME ZONE 'UTC'
      AND "createdAt" < ${utc(to)}::timestamptz AT TIME ZONE 'UTC'
      ${notSystem(includeSystem, messageUser)}
  `;
  return row!;
}

export type DayRow = {
  day: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
};

/** Model and embedding usage per UTC day, days without any included. */
export async function usagePerDay(from: Date, to: Date, includeSystem: boolean) {
  return prismaClient.$queryRaw<DayRow[]>`
    WITH bounds AS (
      SELECT ${utc(from)}::timestamptz AT TIME ZONE 'UTC' AS "from",
             ${utc(to)}::timestamptz AT TIME ZONE 'UTC' AS "to"
    ), days AS (
      SELECT generate_series(date_trunc('day', b."from"), b."to" - interval '1 millisecond',
                             interval '1 day') AS day
      FROM bounds b
    ), totals AS (
      -- One pass over the range; joining each day to the events would compare every
      -- day with every event.
      SELECT date_trunc('day', u."createdAt") AS day, count(*) AS calls,
        sum(u."tokensIn") AS "tokensIn", sum(u."tokensOut") AS "tokensOut",
        sum(u."costUsd") AS "costUsd"
      FROM "UsageEvent" u, bounds b
      WHERE u."createdAt" >= b."from" AND u."createdAt" < b."to"
        ${notSystem(includeSystem, Prisma.raw('u."userId"'))}
      GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
      coalesce(t.calls, 0)::int AS calls,
      coalesce(t."tokensIn", 0)::int AS "tokensIn",
      coalesce(t."tokensOut", 0)::int AS "tokensOut",
      trim_scale(coalesce(t."costUsd", 0))::text AS "costUsd"
    FROM days d
    LEFT JOIN totals t ON t.day = d.day
    ORDER BY d.day
  `;
}

export type ProviderRow = {
  provider: string;
  calls: number;
  failed: number;
  modelCalls: number;
  fallbacks: number;
};

/** Calls per provider: how many failed, and how many model calls the fallback answered. */
export async function providerStats(from: Date, to: Date, includeSystem: boolean) {
  return prismaClient.$queryRaw<ProviderRow[]>`
    SELECT provider,
      count(*)::int AS calls,
      count(*) FILTER (WHERE NOT ok)::int AS failed,
      count(*) FILTER (WHERE type = 'LLM')::int AS "modelCalls",
      count(*) FILTER (WHERE type = 'LLM' AND "fallbackUsed")::int AS fallbacks
    FROM "UsageEvent"
    WHERE "createdAt" >= ${utc(from)}::timestamptz AT TIME ZONE 'UTC'
      AND "createdAt" < ${utc(to)}::timestamptz AT TIME ZONE 'UTC'
      ${notSystem(includeSystem, usageUser)}
    GROUP BY provider
    ORDER BY provider
  `;
}

type IngestionRow = {
  ready: number;
  failed: number;
  inProgress: number;
  avgSeconds: number | null;
};

/**
 * Sources created in the range by how their last ingest ended. The duration is from
 * creation to the last successful ingest: close for a first ingest, but it also counts
 * queue time, and a resynced source's runs aren't stored one by one.
 */
export async function ingestionStats(from: Date, to: Date, includeSystem: boolean) {
  const [row] = await prismaClient.$queryRaw<IngestionRow[]>`
    SELECT count(*) FILTER (WHERE status = 'READY')::int AS ready,
      count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING'))::int AS "inProgress",
      avg(extract(epoch FROM "lastIngestedAt" - "createdAt"))
        FILTER (WHERE status = 'READY' AND "lastIngestedAt" IS NOT NULL)::float8 AS "avgSeconds"
    FROM "Source"
    WHERE "createdAt" >= ${utc(from)}::timestamptz AT TIME ZONE 'UTC'
      AND "createdAt" < ${utc(to)}::timestamptz AT TIME ZONE 'UTC'
      ${notSystem(includeSystem, sourceUser)}
  `;
  return row!;
}

export type ModelUsageRow = {
  type: string;
  provider: string;
  model: string;
  key: string | null;
  calls: number;
  errors: number;
  fallbacks: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
};

/** Calls, failures, fallbacks, tokens and cost per model (and the key it was called with). */
export async function usageByModel(from: Date, to: Date, includeSystem: boolean) {
  return prismaClient.$queryRaw<ModelUsageRow[]>`
    SELECT type::text AS type, provider, model,
      -- Rows from before keys were numbered call the second Gemini key "backup".
      CASE WHEN key = 'backup' THEN '2' ELSE key END AS key,
      count(*)::int AS calls,
      count(*) FILTER (WHERE NOT ok)::int AS errors,
      count(*) FILTER (WHERE "fallbackUsed")::int AS fallbacks,
      coalesce(sum("tokensIn"), 0)::int AS "tokensIn",
      coalesce(sum("tokensOut"), 0)::int AS "tokensOut",
      trim_scale(coalesce(sum("costUsd"), 0))::text AS "costUsd"
    FROM "UsageEvent"
    WHERE "createdAt" >= ${utc(from)}::timestamptz AT TIME ZONE 'UTC'
      AND "createdAt" < ${utc(to)}::timestamptz AT TIME ZONE 'UTC'
      ${notSystem(includeSystem, usageUser)}
    GROUP BY 1, 2, 3, 4
    ORDER BY calls DESC, provider, model, key
  `;
}

export type TaskUsageRow = Omit<ModelUsageRow, 'type' | 'provider' | 'model' | 'key'> & {
  task: string;
};

/** The same per task (agent, title, contextualize...). */
export async function usageByTask(from: Date, to: Date, includeSystem: boolean) {
  return prismaClient.$queryRaw<TaskUsageRow[]>`
    SELECT task,
      count(*)::int AS calls,
      count(*) FILTER (WHERE NOT ok)::int AS errors,
      count(*) FILTER (WHERE "fallbackUsed")::int AS fallbacks,
      coalesce(sum("tokensIn"), 0)::int AS "tokensIn",
      coalesce(sum("tokensOut"), 0)::int AS "tokensOut",
      trim_scale(coalesce(sum("costUsd"), 0))::text AS "costUsd"
    FROM "UsageEvent"
    WHERE "createdAt" >= ${utc(from)}::timestamptz AT TIME ZONE 'UTC'
      AND "createdAt" < ${utc(to)}::timestamptz AT TIME ZONE 'UTC'
      ${notSystem(includeSystem, usageUser)}
    GROUP BY task
    ORDER BY calls DESC, task
  `;
}

/** Sources whose last ingest failed, the latest first. */
export async function findIngestionFailures(limit: number, includeSystem: boolean) {
  return prismaClient.source.findMany({
    where: {
      status: 'FAILED',
      ...(includeSystem ? {} : { workspace: { user: { isSystem: false } } }),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      workspaceId: true,
      title: true,
      type: true,
      stage: true,
      error: true,
      updatedAt: true,
      workspace: { select: { userId: true } },
    },
  });
}

export type RateLimitRow = {
  name: string;
  requests: number;
  blocked: number;
  clientsBlocked: number;
};

/**
 * What each limit counted over the range: all requests, the ones past its points (turned
 * away) and the clients that went past it. Counters are pruned a couple of days after their
 * window ends, so older ranges come back empty.
 */
export async function rateLimitUse(from: Date, to: Date) {
  const limits = Object.entries(appConfig.limits.windows);
  const names = limits.map(([name]) => name);
  const points = limits.map(([, window]) => window.points);
  return prismaClient.$queryRaw<RateLimitRow[]>`
    WITH limits(name, points) AS (
      SELECT * FROM unnest(${names}::text[], ${points}::int[])
    )
    SELECT l.name,
      coalesce(sum(h.count), 0)::int AS requests,
      coalesce(sum(h.count - l.points) FILTER (WHERE h.count > l.points), 0)::int AS blocked,
      count(DISTINCT h.key) FILTER (WHERE h.count > l.points)::int AS "clientsBlocked"
    FROM limits l
    LEFT JOIN "RateLimitHit" h
      ON split_part(h.key, ':', 1) = l.name
      AND h."windowStart" >= ${utc(from)}::timestamptz AT TIME ZONE 'UTC'
      AND h."windowStart" < ${utc(to)}::timestamptz AT TIME ZONE 'UTC'
    GROUP BY l.name
    ORDER BY l.name
  `;
}

const FAILED_FIELDS = {
  id: true,
  conversationId: true,
  content: true,
  status: true,
  error: true,
  feedback: true,
  feedbackNote: true,
  invalidCitations: true,
  weakRetrieval: true,
  createdAt: true,
  conversation: { select: { workspaceId: true, userId: true } },
} as const;

/** Answers that went wrong one way or another, newest first. Eval runs aren't users' failures. */
export async function findFailedAnswers(page: PageQuery) {
  return prismaClient.message.findMany({
    where: {
      AND: [
        page.where,
        {
          role: 'ASSISTANT',
          conversation: { user: { isSystem: false } },
          OR: [
            { feedback: 'DOWN' },
            { status: 'ERROR' },
            { invalidCitations: { gt: 0 } },
            { weakRetrieval: true },
          ],
        },
      ],
    },
    orderBy: page.orderBy,
    take: page.take,
    select: FAILED_FIELDS,
  });
}

/** The user's question each answer replied to: the USER message just before it. */
export async function questionsFor(answerIds: string[]) {
  if (answerIds.length === 0) return new Map<string, string>();
  const rows = await prismaClient.$queryRaw<{ id: string; question: string }[]>`
    SELECT a.id, q.content AS question
    FROM "Message" a
    JOIN LATERAL (
      SELECT u.content FROM "Message" u
      WHERE u."conversationId" = a."conversationId" AND u.role = 'USER'
        AND (u."createdAt", u.id) < (a."createdAt", a.id)
      ORDER BY u."createdAt" DESC, u.id DESC
      LIMIT 1
    ) q ON true
    WHERE a.id = ANY(${answerIds}::text[])
  `;
  return new Map(rows.map((row) => [row.id, row.question]));
}
