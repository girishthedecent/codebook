import { z } from 'zod';
import { appConfig } from '../../../config/app.config.js';
import logger from '../../../config/logger.config.js';
import { fileContents, searchCodeLines, type CodeMatch } from './codeSearch.repository.js';
import type { AgentTool } from './tool.types.js';
import { ToolText } from './toolText.js';
import { NO_SOURCE, toolSource } from './toolSources.js';

const { maxMatches, contextLines, maxPatternChars } = appConfig.tools.searchCode;

const input = z.object({
  pattern: z
    .string()
    .min(1)
    .describe(
      `Text to find, e.g. an identifier like findByEmail; at most ${maxPatternChars} characters`,
    ),
  regex: z
    .boolean()
    .optional()
    .describe('Treat the pattern as a case-insensitive POSIX regular expression'),
  pathPrefix: z.string().optional().describe('Only files under this path, e.g. "src/routes/"'),
  sourceId: z.string().optional().describe('Only this repository'),
});

type Window = {
  sourceId: string;
  sourceTitle: string;
  path: string;
  from: number;
  to: number;
  hits: number[];
};

/** Groups matches that are close together into one excerpt per stretch of a file. */
function windows(matches: CodeMatch[]) {
  const out: Window[] = [];
  for (const match of matches) {
    const from = Math.max(1, match.line - contextLines);
    const to = match.line + contextLines;
    const last = out.at(-1);
    if (
      last &&
      last.sourceId === match.sourceId &&
      last.path === match.path &&
      from <= last.to + 1
    ) {
      last.to = to;
      last.hits.push(match.line);
    } else {
      out.push({
        sourceId: match.sourceId,
        sourceTitle: match.sourceTitle,
        path: match.path,
        from,
        to,
        hits: [match.line],
      });
    }
  }
  return out;
}

// Postgres reports a bad pattern as SQLSTATE 2201B and a cancelled statement as 57014.
function failure(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/statement timeout|57014/.test(text)) return 'timeout';
  if (/invalid regular expression|2201B/.test(text)) return 'invalid';
  return null;
}

export const searchCode: AgentTool<typeof input> = {
  name: 'search_code',
  description:
    "Find exact text or a regex in the repositories' files: identifiers, error messages, config keys. Returns matching lines with a few lines around them, numbered for citation as file:line.",
  input,
  async execute(args, ctx) {
    if (args.pattern.length > maxPatternChars) {
      return {
        text: `The pattern is too long (at most ${maxPatternChars} characters).`,
        summary: 'pattern too long',
      };
    }
    if (args.sourceId) {
      const source = await toolSource(ctx, args.sourceId);
      if (!source) return { text: NO_SOURCE, summary: 'no such source' };
      if (source.type !== 'GITHUB_REPO') {
        return {
          text: `"${source.title}" is not a code repository; use search_sources for it.`,
          summary: 'not a repository',
        };
      }
    }

    let matches: CodeMatch[];
    try {
      matches = await searchCodeLines({
        workspaceId: ctx.workspaceId,
        pattern: args.pattern,
        regex: args.regex ?? false,
        sourceId: args.sourceId,
        pathPrefix: args.pathPrefix,
        limit: maxMatches + 1,
        timeoutMs: appConfig.tools.searchCode.timeoutMs,
      });
    } catch (error) {
      const reason = failure(error);
      if (reason === 'timeout') {
        return {
          text: 'That pattern took too long to search; use a simpler or more specific one.',
          summary: 'pattern timed out',
        };
      }
      if (reason === 'invalid') {
        return {
          text: 'That is not a valid regular expression (POSIX syntax).',
          summary: 'invalid regex',
        };
      }
      logger.warn('search_code failed', { error: error instanceof Error ? error.message : error });
      throw error;
    }

    if (matches.length === 0) {
      return { text: `No line matches "${args.pattern}".`, summary: 'no matches' };
    }
    const more = matches.length > maxMatches;
    const excerpts = windows(matches.slice(0, maxMatches));

    const out = new ToolText();
    if (more)
      out.add(
        `More than ${maxMatches} lines match; showing the first. Narrow it with pathPrefix or a longer pattern.`,
      );
    const files = new Map<string, Map<string, string[]>>();
    for (const sourceId of new Set(excerpts.map((w) => w.sourceId))) {
      const paths = [
        ...new Set(excerpts.filter((w) => w.sourceId === sourceId).map((w) => w.path)),
      ];
      files.set(sourceId, await fileContents(sourceId, paths));
    }
    for (const excerpt of excerpts) {
      const lines = files.get(excerpt.sourceId)?.get(excerpt.path) ?? [];
      const to = Math.min(excerpt.to, lines.length);
      const text = lines
        .slice(excerpt.from - 1, to)
        .map((line, i) => `${excerpt.from + i}: ${line}`)
        .join('\n');
      out.addSource(ctx.registry, {
        kind: 'LINES',
        sourceId: excerpt.sourceId,
        sourceTitle: excerpt.sourceTitle,
        sourceType: 'GITHUB_REPO',
        path: excerpt.path,
        lineStart: excerpt.from,
        lineEnd: to,
        text,
      });
    }
    const shown = Math.min(matches.length, maxMatches);
    return {
      text: out.join(),
      summary: `${shown}${more ? '+' : ''} matching line${shown === 1 ? '' : 's'} in ${new Set(excerpts.map((w) => w.path)).size} file(s)`,
    };
  },
};
