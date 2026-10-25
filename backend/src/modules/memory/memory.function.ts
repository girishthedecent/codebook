import { appConfig } from '../../config/app.config.js';
import { inngest } from '../../config/inngest.config.js';
import { conversationTurnCompleted } from '../../inngest/events.js';
import { applyExtraction, planExtraction } from './memory.extract.js';

/**
 * Learns about the user after a turn. Debounced per conversation, so a quick back-and-forth
 * is read once, after its last turn; the extractor reads everything since its watermark,
 * so the turns in between aren't lost. The model call and the writes are separate steps: a
 * retried write reuses the model's answer instead of asking again.
 */
export const extractMemoriesFunction = inngest.createFunction(
  {
    id: 'memory-extract',
    triggers: [conversationTurnCompleted],
    debounce: {
      key: 'event.data.conversationId',
      period: `${appConfig.memory.debounceSec}s`,
    },
    retries: 2,
  },
  async ({ event, step }) => {
    const { conversationId, messageId } = event.data;
    const plan = await step.run('plan', () => planExtraction({ conversationId, messageId }));
    const result = await step.run('apply', () => applyExtraction(plan));
    return { conversationId, ...result };
  },
);
