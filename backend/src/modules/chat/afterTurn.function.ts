import { appConfig } from '../../config/app.config.js';
import { inngest } from '../../config/inngest.config.js';
import { conversationTurnCompleted } from '../../inngest/events.js';
import { nameConversation, updateSummary } from './conversation.service.js';

/**
 * Housekeeping after a turn: names a new conversation and folds older messages into the
 * rolling summary. Debounced per conversation, so a quick back-and-forth runs it once, after
 * the last turn. Both steps read the conversation as it is now, so a run that is late or
 * repeated does no harm.
 */
export const afterTurn = inngest.createFunction(
  {
    id: 'conversation-after-turn',
    triggers: [conversationTurnCompleted],
    debounce: { key: 'event.data.conversationId', period: appConfig.chat.summaryDebounce },
    retries: 2,
  },
  async ({ event, step }) => {
    const { conversationId } = event.data;
    const named = await step.run('title', () => nameConversation(conversationId));
    const summarized = await step.run('summary', () => updateSummary(conversationId));
    return { conversationId, named, summarized };
  },
);
