import prismaClient from '../config/db.config.js';
import logger from '../config/logger.config.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Saves one UsageEvent. Never throws: losing a usage row is better than failing a model
 * call the user already waited for, so a failed write is only logged.
 */
export async function recordUsage(data: Prisma.UsageEventUncheckedCreateInput) {
  try {
    await prismaClient.usageEvent.create({ data });
  } catch (error) {
    logger.error('Failed to record usage', { error, task: data.task, model: data.model });
  }
}
