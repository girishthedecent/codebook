import { z } from 'zod';
import { appConfig } from '../../config/app.config.js';
import { paginationQuerySchema } from '../../utils/helpers/pagination.helpers.js';

const { website } = appConfig.sources;

const httpUrl = z.url({ protocol: /^https?$/, message: 'Must be an http(s) URL' }).max(2_000);

const repoSourceSchema = z.object({
  type: z.literal('GITHUB_REPO'),
  url: httpUrl,
  // A branch, tag or commit. Taken from /tree/{ref} in the URL when not given.
  ref: z.string().trim().min(1).max(255).optional(),
});

const websiteSourceSchema = z.object({
  type: z.literal('WEBSITE'),
  url: httpUrl,
  maxDepth: z.int().min(0).max(website.maxDepth).default(website.defaultDepth),
  maxPages: z.int().min(1).max(website.maxPages).default(website.defaultPages),
});

// PDFs come as multipart uploads on the same route; this schema is for the JSON body.
export const createSourceSchema = z.discriminatedUnion('type', [
  repoSourceSchema,
  websiteSourceSchema,
]);

// Text fields that may come with a PDF upload.
export const uploadFieldsSchema = z.object({
  type: z.literal('PDF').optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

export const sourceParamsSchema = z.object({
  sourceId: z.cuid(),
});

export const listSourcesQuerySchema = paginationQuerySchema;
