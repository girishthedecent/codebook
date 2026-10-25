import { z } from 'zod';

/**
 * The viewer is driven by URL search params so any cited view is a link. Chat citations,
 * TOC entries, file trees and graph nodes all open it by setting these; the viewer only reads.
 *
 *   ?src=<sourceId>&page=157                          book page
 *   ?src=<sourceId>&path=lib/router.js&lines=42-61    code file, cited lines optional
 *   ?src=<sourceId>&path=<page url>&section=Routing   website page, scrolled to a heading
 *   &cite=<n>&from=<messageId>                        which chip is lit: numbers restart every
 *                                                     answer, so the message names the answer
 *
 * Whether a `path` is code or a web page is the source's type; the viewer knows it.
 */
export const viewerSearchSchema = z.object({
  src: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().optional(),
  path: z.string().min(1).optional(),
  lines: z
    .string()
    .regex(/^\d+(-\d+)?$/)
    .optional(),
  section: z.string().min(1).optional(),
  cite: z.coerce.number().int().positive().optional(),
  from: z.string().min(1).optional(),
});

export type ViewerSearch = z.infer<typeof viewerSearchSchema>;

export type ViewerTarget =
  | { kind: 'page'; sourceId: string; page: number }
  | {
      kind: 'file';
      sourceId: string;
      path: string;
      lineStart?: number;
      lineEnd?: number;
      heading?: string;
    };

export function viewerTarget(search: ViewerSearch): ViewerTarget | undefined {
  if (!search.src) return undefined;
  if (search.page) return { kind: 'page', sourceId: search.src, page: search.page };
  if (search.path) {
    const [a, b] = search.lines?.split('-') ?? [];
    return {
      kind: 'file',
      sourceId: search.src,
      path: search.path,
      lineStart: a ? Number(a) : undefined,
      lineEnd: b ? Number(b) : a ? Number(a) : undefined,
      heading: search.section,
    };
  }
  return undefined;
}

/** Search params that open the viewer at a target; spread over the current search. */
export function viewerSearchFor(target: ViewerTarget, cite?: number, from?: string): ViewerSearch {
  if (target.kind === 'page') {
    return { ...closedViewerSearch, cite, from, src: target.sourceId, page: target.page };
  }
  const { lineStart, lineEnd } = target;
  return {
    ...closedViewerSearch,
    cite,
    from,
    src: target.sourceId,
    path: target.path,
    section: target.heading,
    lines:
      lineStart === undefined
        ? undefined
        : lineEnd && lineEnd !== lineStart
          ? `${lineStart}-${lineEnd}`
          : String(lineStart),
  };
}

export const closedViewerSearch: ViewerSearch = {
  src: undefined,
  page: undefined,
  path: undefined,
  lines: undefined,
  section: undefined,
  cite: undefined,
  from: undefined,
};
