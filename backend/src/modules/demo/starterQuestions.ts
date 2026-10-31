import { readFileSync } from 'node:fs';
import { z } from 'zod';
import logger from '../../config/logger.config.js';

// prisma/demo.json lists the demo's sources for the seed and the questions its home page
// suggests. The same relative path leads there from src and from dist.
const DEMO_FILE = new URL('../../../prisma/demo.json', import.meta.url);

export const starterQuestionsSchema = z.array(z.string().trim().min(8).max(200)).min(3).max(4);

let questions: string[] | undefined;

/**
 * The questions the demo suggests, in order. Suggestions are a convenience: when the file
 * can't be read the demo goes on without them.
 */
export function starterQuestions() {
  if (!questions) {
    try {
      const file = JSON.parse(readFileSync(DEMO_FILE, 'utf8')) as { starterQuestions?: unknown };
      questions = starterQuestionsSchema.parse(file.starterQuestions);
    } catch (error) {
      logger.warn('Could not read the demo starter questions', { error });
      questions = [];
    }
  }
  return questions;
}
