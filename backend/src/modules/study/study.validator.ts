import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import { StudyType } from '../../generated/prisma/enums.js';
import { paginationQuerySchema } from '../../utils/helpers/pagination.helpers.js';
import { text } from '../sources/source.validator.js';

const { quiz, flashcards } = appConfig.study;

export const createStudySchema = z
  .object({
    type: z.enum(StudyType),
    sourceIds: z
      .array(z.cuid())
      .min(1)
      .max(10)
      .transform((ids) => [...new Set(ids)]),
    // At most one of these narrows the material; with none, a sample of each source is used.
    tocNodeId: z.uuid().optional(),
    pathPrefix: text(1_000).optional(),
    topic: text(500).optional(),
    count: z.int().optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  })
  .superRefine((input, ctx) => {
    const selectors = [input.tocNodeId, input.pathPrefix, input.topic].filter(Boolean);
    if (selectors.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['tocNodeId'],
        message: 'Choose at most one of tocNodeId, pathPrefix and topic',
      });
    }
    const range = input.type === 'QUIZ' ? quiz : input.type === 'FLASHCARDS' ? flashcards : null;
    if (
      input.count !== undefined &&
      (!range || input.count < range.min || input.count > range.max)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['count'],
        message: range
          ? `Must be between ${range.min} and ${range.max}`
          : 'Only quizzes and flashcards take a count',
      });
    }
  });

export const listStudyQuerySchema = paginationQuerySchema.extend({
  type: z.enum(StudyType).optional(),
});

export const studyParamsSchema = z.object({ studyId: z.cuid() });
