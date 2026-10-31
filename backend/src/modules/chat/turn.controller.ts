import type { Request, Response } from 'express';
import logger from '../../config/logger.config.js';
import { getAuthUser } from '../../middlewares/auth.middleware.js';
import { perGuestIp } from '../../middlewares/rateLimit.middleware.js';
import { refund } from '../../utils/rateLimit.js';
import { openSse } from '../../utils/sse.js';
import type { ConversationParams } from './conversation.dto.js';
import { prepareTurnService, runTurnService } from './turn.service.js';
import type { SendMessageInput } from './turn.validator.js';

/**
 * Saves the question, then answers it over Server-Sent Events: `title` (when the question
 * named the conversation), `step`, `token`, `citations`, then `done` (or `error`). Errors
 * before the stream opens are ordinary JSON errors.
 */
export async function sendMessageHandler(req: Request, res: Response) {
  const requestedAt = Date.now();
  const user = getAuthUser(res);
  const { conversationId } = res.locals.params as ConversationParams;
  const { content, useMemory, retry } = req.body as SendMessageInput;
  const turn = await prepareTurnService(user, conversationId, content, { useMemory, retry });

  const stream = openSse(req, res);
  // A client that goes away (even during the checks above) or a shutdown stops the model and
  // the tools it started. After a finished turn the abort does nothing.
  const aborted = new AbortController();
  stream.onClose(() => aborted.abort());
  try {
    const outcome = await runTurnService(
      turn,
      ({ type, ...data }) => stream.send(type, data),
      aborted.signal,
      { useMemory },
    );
    // The models being out of quota is nobody's doing: the guest keeps their question.
    if (outcome.errorCode === 'UPSTREAM_ERROR') await refundGuestQuestion(req, res, requestedAt);
  } catch (error) {
    logger.error('Could not finish the chat turn', { error, conversationId });
    stream.send('error', { code: 'INTERNAL', message: 'Something went wrong' });
  } finally {
    stream.close();
  }
}

async function refundGuestQuestion(req: Request, res: Response, countedAt: number) {
  const key = perGuestIp(req, res);
  if (key === null) return;
  try {
    await refund('guestMessages', key, countedAt);
  } catch (error) {
    // Only the guest's point is lost; the error event has gone out already.
    logger.warn('Could not refund a guest question', { error });
  }
}
