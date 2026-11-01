import { getRouteApi } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * The graph's own URL state. `path` is not here: it belongs to the viewer (parent route), and
 * arriving from the code viewer with `?src=<repo>&path=<file>` lists that file's symbols. The
 * viewer also owns `from` (the answer a citation came from), so a trace's two ends are
 * `fromSym` and `toSym`. Symbols are named by qualified name (`model.py#GPT.forward`), which
 * stays the same when a repository is indexed again; an id still works in an old link.
 * Bad values are dropped rather than failing the page.
 */
export const graphSearchSchema = z.object({
  repo: z.string().min(1).optional().catch(undefined),
  symbol: z.string().min(1).optional().catch(undefined),
  dir: z.enum(['callers', 'dependencies', 'both']).optional().catch(undefined),
  depth: z.coerce.number().int().min(1).max(3).optional().catch(undefined),
  mode: z.enum(['explore', 'trace']).optional().catch(undefined),
  view: z.enum(['list', 'map']).optional().catch(undefined),
  fromSym: z.string().min(1).optional().catch(undefined),
  toSym: z.string().min(1).optional().catch(undefined),
});

export type GraphSearch = z.infer<typeof graphSearchSchema>;
export type Direction = NonNullable<GraphSearch['dir']>;

export const graphRoute = getRouteApi('/w/$workspaceId/graph');
