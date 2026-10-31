import { appConfig } from '../../config/app.config.js';
import type { EdgeType } from '../../generated/prisma/client.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors/app.error.js';
import { getSourceService } from '../sources/source.service.js';
import type { DependenciesQuery, PathQuery, SymbolsQuery, WalkQuery } from './graph.dto.js';
import {
  busiestSymbols,
  constructorClasses,
  externalImports,
  fileHeads,
  fileSymbolCounts,
  findSymbolById,
  findSymbols,
  findSymbolsNamed,
  methodsOf,
  searchSymbols,
  unresolvedCallHeads,
  unresolvedEdges,
  walk,
  type GraphSymbol,
  type WalkRow,
} from './graph.repository.js';
import { countPackageCalls } from './overview.js';

// What the code graph says about a repository source: symbol search, callers, dependencies,
// call paths and an overview. Every answer carries file paths, lines and chunk ids for
// citations.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function repoSource(userId: string, sourceId: string) {
  const source = await getSourceService(userId, sourceId);
  if (source.type !== 'GITHUB_REPO') {
    throw new BadRequestError('Code graphs are only available for repository sources');
  }
  return source;
}

/**
 * A symbol by id, qualified name (`src/a.ts#A.run`) or plain name. A plain name that several
 * symbols share is a 409 listing them, so the caller can pick one.
 */
async function symbolFor(sourceId: string, ref: string) {
  if (UUID.test(ref)) {
    const symbol = await findSymbolById(sourceId, ref);
    if (symbol) return symbol;
  }
  const { maxCandidates } = appConfig.graph;
  const matches = await findSymbolsNamed(sourceId, ref, maxCandidates + 1);
  if (matches.length === 0) throw new NotFoundError(`No symbol named "${ref}"`);
  if (matches.length > 1) {
    throw new ConflictError(`"${ref}" matches more than one symbol; use a qualified name`, {
      candidates: matches.slice(0, maxCandidates),
    });
  }
  return matches[0]!;
}

export async function searchSymbolsService(userId: string, sourceId: string, query: SymbolsQuery) {
  await repoSource(userId, sourceId);
  return searchSymbols(sourceId, query.q, query.limit);
}

/**
 * Who calls the symbol, directly (depth 1) and through others. A class and its constructor
 * are one thing to a caller (see `walk`): asking for either lists the callers of both.
 */
export async function callersService(userId: string, sourceId: string, query: WalkQuery) {
  await repoSource(userId, sourceId);
  const symbol = await symbolFor(sourceId, query.symbol);
  const rows = await walk(sourceId, [symbol.id], ['CALLS'], 'backward', query.depth);
  return { symbol, ...(await reached([symbol.id], rows)) };
}

/**
 * What the symbol uses: calls, and imports for a file. Targets outside the repository
 * (packages, builtins) are listed by name under `external`.
 */
export async function dependenciesService(
  userId: string,
  sourceId: string,
  query: DependenciesQuery,
) {
  await repoSource(userId, sourceId);
  const symbol = await symbolFor(sourceId, query.symbol);
  const types: EdgeType[] = ['CALLS', 'IMPORTS'];
  // Calls are made by a class's methods, not by the class: what it uses is what they use.
  const starts = symbol.kind === 'CLASS' ? await methodsOf(symbol.id) : [symbol.id];
  const rows = await walk(sourceId, starts, types, 'forward', query.depth);
  const result = await reached([symbol.id, ...starts], rows);
  const inner = new Set([
    ...starts,
    symbol.id,
    ...result.symbols.filter((s) => s.depth < query.depth).map((s) => s.id),
  ]);
  // The calls a class makes are its constructor's.
  for (const [constructor, owner] of await constructorClasses(sourceId)) {
    if (inner.has(owner)) inner.add(constructor);
  }
  const external = await unresolvedEdges([...inner], types, appConfig.graph.maxResults);
  return { symbol, ...result, external };
}

/** The shortest chain of calls from one symbol to another, or null when there is none. */
export async function pathService(userId: string, sourceId: string, query: PathQuery) {
  await repoSource(userId, sourceId);
  const from = await symbolFor(sourceId, query.from);
  const to = await symbolFor(sourceId, query.to);
  // Imports go from file to file; DEFINES leads from a file into its symbols.
  const types: EdgeType[] = query.imports ? ['CALLS', 'IMPORTS', 'DEFINES'] : ['CALLS'];
  const rows = await walk(sourceId, [from.id], types, 'forward', appConfig.graph.maxPathDepth);

  const target = rows.filter((row) => row.id === to.id).sort((a, b) => a.depth - b.depth)[0];
  if (!target)
    return { from, to, path: null, truncated: rows.length >= appConfig.graph.maxWalkRows };

  // Walk back: every row's `via` was reached one hop earlier.
  const chain = [target];
  while (chain[0]!.depth > 0) {
    const { via, depth } = chain[0]!;
    chain.unshift(rows.find((row) => row.id === via && row.depth === depth - 1)!);
  }
  const symbols = new Map((await findSymbols(chain.map((row) => row.id))).map((s) => [s.id, s]));
  return { from, to, path: chain.map((row) => symbols.get(row.id)!), truncated: false };
}

// Each symbol once, at the smallest depth it was reached, with the symbol it was reached
// through (`via`), nearest first. The walk's starting points aren't part of its result.
async function reached(startIds: string[], rows: WalkRow[]) {
  const starts = new Set(startIds);
  const best = new Map<string, WalkRow>();
  for (const row of rows) {
    if (starts.has(row.id)) continue;
    const seen = best.get(row.id);
    if (!seen || row.depth < seen.depth) best.set(row.id, row);
  }
  const { maxResults, maxWalkRows } = appConfig.graph;
  const nearest = [...best.values()].sort((a, b) => a.depth - b.depth).slice(0, maxResults);
  const details = new Map((await findSymbols(nearest.map((row) => row.id))).map((s) => [s.id, s]));
  const symbols = nearest.map((row): GraphSymbol & { depth: number; via: string | null } => ({
    ...details.get(row.id)!,
    depth: row.depth,
    via: row.via !== null && starts.has(row.via) ? null : row.via,
  }));
  return { symbols, truncated: best.size > maxResults || rows.length >= maxWalkRows };
}

/**
 * Where to start reading a repository: the symbols most connected by calls (a constructor
 * counts with its class), the files with the most symbols, and the packages its calls go to.
 */
export async function overviewService(userId: string, sourceId: string) {
  await repoSource(userId, sourceId);
  const { overviewSymbols, overviewPackages, maxResults } = appConfig.graph;
  const [topSymbols, files, callHeads, imports] = await Promise.all([
    busiestSymbols(sourceId, overviewSymbols),
    fileSymbolCounts(sourceId, maxResults),
    unresolvedCallHeads(sourceId),
    externalImports(sourceId),
  ]);

  // Only the files that call something outside the repository need their imports read.
  const callingFiles = [...new Set(callHeads.map((row) => row.filePath))];
  const heads = new Map((await fileHeads(sourceId, callingFiles)).map((f) => [f.path, f.head]));
  return {
    topSymbols,
    files,
    packages: countPackageCalls(callHeads, imports, heads, overviewPackages),
  };
}
