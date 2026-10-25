import prismaClient from '../../config/db.config.js';
import type { PageQuery } from '../../utils/helpers/pagination.helpers.js';

// Time ranges come in as Dates; timestamps are stored as UTC without a zone, so the ISO
// strings are read back as UTC.
const utc = (date: Date) => date.toISOString();

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
export async function answerStats(from: Date, to: Date) {
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
export async function usagePerDay(from: Date, to: Date) {
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
export async function providerStats(from: Date, to: Date) {
  return prismaClient.$queryRaw<ProviderRow[]>`
    SELECT provider,
      count(*)::int AS calls,
      count(*) FILTER (WHERE NOT ok)::int AS failed,
      count(*) FILTER (WHERE type = 'LLM')::int AS "modelCalls",
      count(*) FILTER (WHERE type = 'LLM' AND "fallbackUsed")::int AS fallbacks
    FROM "UsageEvent"
    WHERE "createdAt" >= ${utc(from)}::timestamptz AT TIME ZONE 'UTC'
      AND "createdAt" < ${utc(to)}::timestamptz AT TIME ZONE 'UTC'
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
export async function ingestionStats(from: Date, to: Date) {
  const [row] = await prismaClient.$queryRaw<IngestionRow[]>`
    SELECT count(*) FILTER (WHERE status = 'READY')::int AS ready,
      count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING'))::int AS "inProgress",
      avg(extract(epoch FROM "lastIngestedAt" - "createdAt"))
        FILTER (WHERE status = 'READY' AND "lastIngestedAt" IS NOT NULL)::float8 AS "avgSeconds"
    FROM "Source"
    WHERE "createdAt" >= ${utc(from)}::timestamptz AT TIME ZONE 'UTC'
      AND "createdAt" < ${utc(to)}::timestamptz AT TIME ZONE 'UTC'
  `;
  return row!;
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
