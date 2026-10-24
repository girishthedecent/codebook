import type { Request, Response } from 'express';
import logger from '../../config/logger.config.js';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { openSse } from '../../utils/sse.js';
import type { ConversationParams } from './conversation.dto.js';
import { prepareTurnService, runTurnService } from './turn.service.js';
import type { SendMessageInput } from './turn.validator.js';

/**
 * Saves the question, then answers it over Server-Sent Events: `step`, `token`, `citations`,
 * then `done` (or `error`). Errors before the stream opens are ordinary JSON errors.
 */
export async function sendMessageHandler(req: Request, res: Response) {
  const user = getAuthUser(res);
  const { conversationId } = res.locals.params as ConversationParams;
  const { content } = req.body as SendMessageInput;
  const turn = await prepareTurnService(user, conversationId, content);

  const stream = openSse(req, res);
  // A client that goes away (even during the checks above) or a shutdown stops the model and
  // the tools it started. After a finished turn the abort does nothing.
  const aborted = new AbortController();
  stream.onClose(() => aborted.abort());
  try {
    await runTurnService(turn, ({ type, ...data }) => stream.send(type, data), aborted.signal);
  } catch (error) {
    logger.error('Could not finish the chat turn', { error, conversationId });
    stream.send('error', { code: 'INTERNAL', message: 'Something went wrong' });
  } finally {
    stream.close();
  }
}
