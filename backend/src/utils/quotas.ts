import { appConfig } from '../config/app.config.js';
import prismaClient from '../config/db.config.js';
import { ConflictError, TooManyRequestsError } from './errors/app.error.js';

const MB = 1024 * 1024;

/** Bytes of PDFs the user has uploaded, across all their workspaces. */
export async function pdfBytesUsed(userId: string) {
  const [row] = await prismaClient.$queryRaw<{ bytes: bigint }[]>`
    SELECT COALESCE(SUM((s.origin->>'size')::bigint), 0)::bigint AS bytes
    FROM "Source" s
    JOIN "Workspace" w ON w.id = s."workspaceId"
    WHERE w."userId" = ${userId} AND s.type = 'PDF'
  `;
  return Number(row?.bytes ?? 0);
}

/**
 * Refuses an upload that would take the user past their PDF storage. Not locked: parallel
 * uploads can overshoot, but only by what the sourceCreate limit lets through.
 */
export async function assertPdfStorage(userId: string, uploadBytes: number) {
  const limit = appConfig.limits.pdfStorageBytesPerUser;
  const used = await pdfBytesUsed(userId);
  if (used + uploadBytes > limit) {
    throw new ConflictError(
      `This upload would go past your ${Math.round(limit / MB)} MB of PDF storage ` +
        `(${Math.round(used / MB)} MB used). Delete a PDF source to make room.`,
    );
  }
}

/** Model tokens (in + out) the user's calls used today, UTC. */
export async function tokensUsedToday(userId: string, now = new Date()) {
  const dayStart = startOfUtcDay(now);
  const [row] = await prismaClient.$queryRaw<{ tokens: bigint }[]>`
    SELECT COALESCE(SUM("tokensIn" + "tokensOut"), 0)::bigint AS tokens
    FROM "UsageEvent"
    WHERE "userId" = ${userId} AND type = 'LLM' AND "createdAt" >= ${dayStart}
  `;
  return Number(row?.tokens ?? 0);
}

/** Chat and study call this before spending model tokens: a 429 once today's budget is used. */
export async function assertTokenBudget(userId: string, now = new Date()) {
  if ((await tokensUsedToday(userId, now)) < appConfig.limits.dailyTokensPerUser) return;
  const nextDay = startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000;
  throw new TooManyRequestsError(Math.ceil((nextDay - now.getTime()) / 1000));
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
