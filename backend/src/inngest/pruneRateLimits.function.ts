import { cron } from 'inngest';
import { appConfig } from '../config/app.config.js';
import { inngest } from '../config/inngest.config.js';
import { pruneRateLimitHits } from '../utils/rateLimit.js';

// Every window of every limit leaves a row; none is read after its window ends.
export const pruneRateLimits = inngest.createFunction(
  { id: 'prune-rate-limits', triggers: [cron('TZ=UTC 30 3 * * *')] },
  async ({ step }) => {
    const deleted = await step.run('delete-old-windows', async () => {
      const cutoff = new Date(Date.now() - appConfig.limits.keepHitsHours * 60 * 60 * 1000);
      const { count } = await pruneRateLimitHits(cutoff);
      return count;
    });
    return { deleted };
  },
);
