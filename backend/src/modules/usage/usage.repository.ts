import prismaClient from '../../config/db.config.js';

export type UsageWindow = {
  messages: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
};

type WindowRow = UsageWindow & { name: string };

/**
 * Questions asked and model usage since each window's start. Messages are the user's own
 * (USER role) in their conversations; tokens are model calls (LLM), cost is every kind of
 * call at list price.
 */
export async function usageWindows(userId: string, starts: Record<string, Date>) {
  const names = Object.keys(starts);
  const dates = names.map((name) => starts[name]!.toISOString());
  // Timestamps are stored as UTC without a zone; the ISO strings are read as UTC to match.
  const rows = await prismaClient.$queryRaw<WindowRow[]>`
    WITH windows AS (
      SELECT name, since AT TIME ZONE 'UTC' AS since
      FROM unnest(${names}::text[], ${dates}::timestamptz[]) AS w(name, since)
    )
    SELECT w.name,
      (SELECT count(*)::int FROM "Message" m
         JOIN "Conversation" c ON c.id = m."conversationId"
         WHERE c."userId" = ${userId} AND m.role = 'USER' AND m."createdAt" >= w.since
      ) AS messages,
      coalesce(sum(u."tokensIn") FILTER (WHERE u.type = 'LLM'), 0)::int AS "tokensIn",
      coalesce(sum(u."tokensOut") FILTER (WHERE u.type = 'LLM'), 0)::int AS "tokensOut",
      trim_scale(coalesce(sum(u."costUsd"), 0))::text AS "costUsd"
    FROM windows w
    LEFT JOIN "UsageEvent" u ON u."userId" = ${userId} AND u."createdAt" >= w.since
    GROUP BY w.name, w.since
  `;
  return new Map(rows.map(({ name, ...window }) => [name, window]));
}

/** Sources in the user's own workspaces, and the bytes their uploaded PDFs take. */
export async function sourceTotals(userId: string) {
  const [row] = await prismaClient.$queryRaw<{ sources: number; pdfBytes: bigint }[]>`
    SELECT count(*)::int AS sources,
      coalesce(sum((s.origin->>'size')::bigint) FILTER (WHERE s.type = 'PDF'), 0)::bigint
        AS "pdfBytes"
    FROM "Source" s
    JOIN "Workspace" w ON w.id = s."workspaceId"
    WHERE w."userId" = ${userId}
  `;
  return { sources: row?.sources ?? 0, pdfBytes: Number(row?.pdfBytes ?? 0) };
}

/** A rate-limit counter for the window that starts at `windowStart`, 0 when unused. */
export async function rateLimitCount(key: string, windowStart: Date) {
  const row = await prismaClient.rateLimitHit.findUnique({
    where: { key_windowStart: { key, windowStart } },
    select: { count: true },
  });
  return row?.count ?? 0;
}
