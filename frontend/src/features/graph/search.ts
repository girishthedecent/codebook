import { getRouteApi } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * The graph's own URL state. `path` is not here: it belongs to the viewer (parent route), and
 * arriving from the code viewer with `?src=<repo>&path=<file>` lists that file's symbols.
 * Bad values are dropped rather than failing the page.
 */
export const graphSearchSchema = z.object({
  repo: z.string().min(1).optional().catch(undefined),
  symbol: z.string().min(1).optional().catch(undefined),
  dir: z.enum(['callers', 'dependencies', 'both']).optional().catch(undefined),
  depth: z.coerce.number().int().min(1).max(3).optional().catch(undefined),
  mode: z.enum(['explore', 'trace']).optional().catch(undefined),
  view: z.enum(['canvas', 'list']).optional().catch(undefined),
  from: z.string().min(1).optional().catch(undefined),
  to: z.string().min(1).optional().catch(undefined),
});

export type GraphSearch = z.infer<typeof graphSearchSchema>;
export type Direction = NonNullable<GraphSearch['dir']>;

export const graphRoute = getRouteApi('/w/$workspaceId/graph');
