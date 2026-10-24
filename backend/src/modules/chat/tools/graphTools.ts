import { z } from 'zod';
import { appConfig } from '../../../config/app.config.js';
import { AppError } from '../../../utils/errors/app.error.js';
import type { GraphSymbol } from '../../graph/graph.repository.js';
import { callersService, dependenciesService, pathService } from '../../graph/graph.service.js';
import { fileContents } from './codeSearch.repository.js';
import type { AgentTool, ToolContext, ToolResult } from './tool.types.js';
import type { ToolSourceRow } from './toolSources.js';
import { graphRepo } from './toolSources.js';
import { ToolText } from './toolText.js';

// The first lines of each symbol are enough to show what it is; read_source has the rest.
const EXCERPT_LINES = 6;

const symbolRef = (what: string) =>
  z
    .string()
    .min(1)
    .max(1_000)
    .describe(`${what}: a name like "login", or qualified like "src/auth.ts#AuthService.login"`);
const sourceId = z
  .string()
  .optional()
  .describe('The repository; can be left out when the workspace has only one');
const depth = z
  .number()
  .int()
  .min(1)
  .max(appConfig.graph.maxDepth)
  .optional()
  .describe(`How many hops to follow, 1-${appConfig.graph.maxDepth}; default 2`);

type Shown = GraphSymbol & { depth?: number; via?: string | null };

/** The service's 404/409/400 as text the model can act on; anything else is a real failure. */
function graphError(error: unknown): ToolResult {
  if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
  const candidates = (error.details as { candidates?: GraphSymbol[] } | undefined)?.candidates;
  if (candidates) {
    const list = candidates.map(
      (s) => `- ${s.qualifiedName} (${s.kind.toLowerCase()}, ${s.filePath}:${s.lineStart})`,
    );
    return {
      text: `${error.message}. Candidates:\n${list.join('\n')}`,
      summary: 'ambiguous symbol',
    };
  }
  return { text: `${error.message}.`, summary: error.message };
}

/** A <source> block per symbol, its first lines with their numbers, nearest first. */
async function citeSymbols(ctx: ToolContext, repo: ToolSourceRow, symbols: Shown[], out: ToolText) {
  const files = await fileContents(repo.id, [...new Set(symbols.map((s) => s.filePath))]);
  const names = new Map(symbols.map((s) => [s.id, s.qualifiedName]));
  let shown = 0;
  for (const symbol of symbols) {
    const lines = files.get(symbol.filePath) ?? [];
    const lineEnd = Math.min(symbol.lineEnd, symbol.lineStart + EXCERPT_LINES - 1, lines.length);
    const text = lines
      .slice(symbol.lineStart - 1, lineEnd)
      .map((line, i) => `${symbol.lineStart + i}: ${line}`)
      .join('\n');
    const where =
      symbol.depth === undefined
        ? ''
        : symbol.via
          ? `, depth ${symbol.depth} via ${names.get(symbol.via) ?? 'another symbol'}`
          : `, depth ${symbol.depth}`;
    const n = out.addSource(ctx.registry, {
      kind: 'LINES',
      sourceId: repo.id,
      sourceTitle: repo.title,
      sourceType: repo.type,
      path: symbol.filePath,
      heading: `${symbol.kind.toLowerCase()} ${symbol.qualifiedName}${where}`,
      lineStart: symbol.lineStart,
      lineEnd: Math.max(lineEnd, symbol.lineStart),
      text,
    });
    if (n !== null) shown += 1;
  }
  return shown;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const callersInput = z.object({
  symbol: symbolRef('The function, method or class'),
  sourceId,
  depth,
});

export const findCallers: AgentTool<typeof callersInput> = {
  name: 'find_callers',
  description:
    'Who calls a function or method in a repository, directly (depth 1) and through other calls. Use it for "where is X used" and impact questions. Each caller is numbered for citation.',
  input: callersInput,
  async execute(args, ctx) {
    const found = await graphRepo(ctx, args.sourceId);
    if ('error' in found) return { text: found.error, summary: 'no repository' };
    const { repo } = found;

    let result;
    try {
      result = await callersService(ctx.userId, repo.id, {
        symbol: args.symbol,
        depth: args.depth ?? 2,
      });
    } catch (error) {
      return graphError(error);
    }
    const { symbol, symbols, truncated } = result;
    if (symbols.length === 0) {
      return {
        text: `Nothing in the repository calls ${symbol.qualifiedName} (${symbol.filePath}:${symbol.lineStart}).`,
        summary: 'no callers',
      };
    }

    const out = new ToolText();
    out.add(
      `Callers of ${symbol.qualifiedName} (${symbol.filePath}:${symbol.lineStart}), nearest first${truncated ? '; there are more than shown' : ''}:`,
    );
    const shown = await citeSymbols(ctx, repo, symbols, out);
    return { text: out.join(), summary: `${plural(shown, 'caller')} of ${symbol.name}` };
  },
};

const dependenciesInput = z.object({
  symbol: symbolRef('The function, method, class or file'),
  sourceId,
  depth,
});

export const findDependencies: AgentTool<typeof dependenciesInput> = {
  name: 'find_dependencies',
  description:
    'What a function, class or file uses: the functions it calls and the files it imports, followed a few hops, plus packages it calls outside the repository. Each one is numbered for citation.',
  input: dependenciesInput,
  async execute(args, ctx) {
    const found = await graphRepo(ctx, args.sourceId);
    if ('error' in found) return { text: found.error, summary: 'no repository' };
    const { repo } = found;

    let result;
    try {
      result = await dependenciesService(ctx.userId, repo.id, {
        symbol: args.symbol,
        depth: args.depth ?? 2,
      });
    } catch (error) {
      return graphError(error);
    }
    const { symbol, symbols, truncated, external } = result;
    if (symbols.length === 0 && external.length === 0) {
      return {
        text: `${symbol.qualifiedName} uses nothing else the graph knows of.`,
        summary: 'no dependencies',
      };
    }

    const out = new ToolText();
    if (external.length > 0) {
      const names = [...new Set(external.map((edge) => edge.toName))];
      out.add(`Outside the repository (packages, builtins): ${names.join(', ')}`);
    }
    out.add(
      `What ${symbol.qualifiedName} (${symbol.filePath}:${symbol.lineStart}) uses, nearest first${truncated ? '; there is more than shown' : ''}:`,
    );
    const shown = await citeSymbols(ctx, repo, symbols, out);
    return {
      text: out.join(),
      summary: `${plural(shown, 'dependency', 'dependencies')}${external.length > 0 ? ` and ${external.length} external` : ''} of ${symbol.name}`,
    };
  },
};

const traceInput = z.object({
  from: symbolRef('Where the flow starts, e.g. a route handler'),
  to: symbolRef('Where it should arrive, e.g. a database call'),
  sourceId,
  imports: z.boolean().optional().describe('Also follow file imports, not only calls'),
});

export const traceFlow: AgentTool<typeof traceInput> = {
  name: 'trace_flow',
  description:
    'The shortest chain of calls from one function to another in a repository, e.g. from a route handler to the database. Each step is numbered for citation.',
  input: traceInput,
  async execute(args, ctx) {
    const found = await graphRepo(ctx, args.sourceId);
    if ('error' in found) return { text: found.error, summary: 'no repository' };
    const { repo } = found;

    let result;
    try {
      result = await pathService(ctx.userId, repo.id, {
        from: args.from,
        to: args.to,
        imports: args.imports ?? false,
      });
    } catch (error) {
      return graphError(error);
    }
    const { from, to, path, truncated } = result;
    if (!path) {
      const hint = args.imports ? '' : ' Try imports: true, or find_callers on the target.';
      return {
        text: `No chain of calls leads from ${from.qualifiedName} to ${to.qualifiedName}${truncated ? ' within the search limit' : ''}.${hint}`,
        summary: 'no path',
      };
    }

    const out = new ToolText();
    out.add(`${path.map((s) => s.qualifiedName).join(' → ')}`);
    await citeSymbols(ctx, repo, path, out);
    return {
      text: out.join(),
      summary: `${plural(path.length - 1, 'hop')} from ${from.name} to ${to.name}`,
    };
  },
};
