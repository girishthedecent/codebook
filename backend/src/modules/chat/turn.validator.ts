import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import { text } from '../sources/source.validator.js';

export const sendMessageSchema = z.object({
  content: text(appConfig.chat.maxMessageChars).trim().min(1),
  // Off: the answer neither uses nor adds to what CodeBook remembers about the user.
  useMemory: z.boolean().default(true),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
