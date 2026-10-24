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

// Files are listed in path order, so the cursor is the last path of the previous page
// (base64url, opaque to clients). Paths can be long, hence its own schema.
const pathCursorSchema = z
  .string()
  .max(6_000)
  .transform((value, ctx) => {
    const path = Buffer.from(value, 'base64url').toString('utf8');
    if (!path) {
      ctx.addIssue({ code: 'custom', message: 'Invalid cursor' });
      return z.NEVER;
    }
    return path;
  });

export const listFilesQuerySchema = z.object({
  cursor: pathCursorSchema.optional(),
  limit: paginationQuerySchema.shape.limit,
  // Only files under this path, e.g. "src/"; matched literally.
  prefix: z.string().min(1).max(1_000).optional(),
});

const line = z.coerce.number().int().min(1);

// One way to pick the text: a physical page of a PDF, a TOC section, or lines of a
// repository file.
export const sourceContentQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    tocNodeId: z.uuid().optional(),
    path: z.string().min(1).max(1_000).optional(),
    lineStart: line.optional(),
    lineEnd: line.optional(),
  })
  .refine(
    (query) =>
      [query.page, query.tocNodeId, query.path].filter((v) => v !== undefined).length === 1,
    {
      message: 'Give one of page, tocNodeId or path',
    },
  )
  .refine(
    (query) =>
      query.path !== undefined || (query.lineStart === undefined && query.lineEnd === undefined),
    {
      message: 'lineStart and lineEnd go with path',
    },
  )
  .refine(
    (query) =>
      query.lineStart === undefined ||
      query.lineEnd === undefined ||
      query.lineEnd >= query.lineStart,
    {
      message: 'lineEnd must not be before lineStart',
    },
  );
