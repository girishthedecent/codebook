import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import { text } from '../sources/source.validator.js';

export const sendMessageSchema = z.object({
  content: text(appConfig.chat.maxMessageChars).trim().min(1),
  // Off: the answer neither uses nor adds to what CodeBook remembers about the user.
  useMemory: z.boolean().default(true),
  retry: z
    .boolean()
    .default(false)
    .describe(
      'Asking again after a failed or cut-off answer: that attempt (the question and its failed ' +
        'reply) is replaced instead of staying in the conversation. With no failed attempt of ' +
        'this same question to replace, it is an ordinary question.',
    ),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
