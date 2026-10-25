import { cron } from 'inngest';
import { appConfig } from '../../config/app.config.js';
import prismaClient from '../../config/db.config.js';
import { inngest } from '../../config/inngest.config.js';
import { deleteExpiredAnswers } from './answerCache.js';

// Guests are throwaway accounts: once they are guestTtlDays old they are deleted, and the
// cascades take their sessions, conversations, messages, memories and study sets with them.

const BATCH = 500;
// A run stops after this many batches; the next day's run picks up the rest.
const MAX_BATCHES = 200;

const DAY_MS = 24 * 60 * 60 * 1000;
// The cascades reach every table a guest wrote to, which can outlast the default 5s.
const TX_OPTIONS = { timeout: 30_000 };

/**
 * Deletes up to `take` guests created before `cutoff` and returns how many went. Their
 * usage rows stay for the cost totals, without the user id.
 */
export async function deleteGuestBatch(cutoff: Date, take = BATCH) {
  return prismaClient.$transaction(async (tx) => {
    const guests = await tx.user.findMany({
      where: { isGuest: true, isSystem: false, createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take,
    });
    if (guests.length === 0) return 0;
    const ids = guests.map((guest) => guest.id);
    await tx.usageEvent.updateMany({ where: { userId: { in: ids } }, data: { userId: null } });
    const { count } = await tx.user.deleteMany({ where: { id: { in: ids }, isGuest: true } });
    return count;
  }, TX_OPTIONS);
}

export const cleanupGuests = inngest.createFunction(
  { id: 'cleanup-guests', triggers: [cron('TZ=UTC 0 4 * * *')] },
  async ({ step }) => {
    // Fixed once, so a retried run deletes against the same date.
    const cutoff = await step.run('cutoff', () =>
      new Date(Date.now() - appConfig.demo.guestTtlDays * DAY_MS).toISOString(),
    );
    let guests = 0;
    for (let batch = 1; batch <= MAX_BATCHES; batch++) {
      const deleted = await step.run(`delete-guests-${batch}`, () =>
        deleteGuestBatch(new Date(cutoff)),
      );
      guests += deleted;
      if (deleted < BATCH) break;
    }
    const answers = await step.run('delete-old-answers', () => deleteExpiredAnswers());
    return { guests, answers };
  },
);
