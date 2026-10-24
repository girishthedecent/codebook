import { z } from 'zod';
import { appConfig } from '../../../config/app.config.js';
import { countLines } from '../../ingestion/code/lines.js';
import { findFile, findPageText, findTocSection } from '../../sources/sourceContent.repository.js';
import type { AgentTool, ToolResult } from './tool.types.js';
import type { ToolSourceRow } from './toolSources.js';
import { NO_SOURCE, toolSource } from './toolSources.js';
import { cutToTokens, ToolText } from './toolText.js';

const { maxLines, maxPages, maxTokens } = appConfig.tools.readSource;

const page = z.number().int().min(1).max(2_000_000_000);
const line = z.number().int().min(1).max(2_000_000_000);

const input = z.object({
  sourceId: z.string().describe('The source to read'),
  path: z.string().optional().describe('A repository file path or web page URL, read by lines'),
  lineStart: line.optional().describe('First line (with path); default 1'),
  lineEnd: line.optional().describe(`Last line (with path); at most ${maxLines} lines per read`),
  page: page.optional().describe('A book page to read (physical page number)'),
  pageEnd: page.optional().describe(`Last page (with page); at most ${maxPages} pages per read`),
  tocNodeId: z.string().optional().describe('A section id from browse_toc'),
});

type Args = z.infer<typeof input>;

// Pages of a book are joined by \f.
const pageBreaks = (text: string) => text.split('\f').length - 1;

async function readLines(
  source: ToolSourceRow,
  args: Args & { path: string },
  out: ToolText,
  ctx: Parameters<AgentTool['execute']>[1],
): Promise<ToolResult> {
  if (source.type === 'PDF') {
    return {
      text: 'A book is read by page or section: pass page or tocNodeId instead of path.',
      summary: 'wrong mode',
    };
  }
  const file = await findFile(source.id, args.path);
  if (!file)
    return {
      text: `"${source.title}" has no file "${args.path}"; use list_files to see the paths.`,
      summary: 'no such file',
    };
  if (file.skippedReason)
    return {
      text: `"${args.path}" wasn't indexed (${file.skippedReason}).`,
      summary: 'file not indexed',
    };

  const lineCount = file.lineCount ?? countLines(file.content);
  const from = args.lineStart ?? 1;
  if (from > Math.max(lineCount, 1))
    return { text: `"${args.path}" has ${lineCount} lines.`, summary: 'past the end' };
  let to = Math.min(args.lineEnd ?? lineCount, lineCount, from + maxLines - 1);
  if (to < from) to = from;

  let lines = file.content.split('\n').slice(from - 1, to);
  let text = lines.map((l, i) => `${from + i}: ${l}`).join('\n');
  const cut = cutToTokens(text, maxTokens, true);
  if (cut.cut) {
    // Keep whole lines, and cite only what was shown.
    lines = cut.text.split('\n');
    to = from + lines.length - 1;
    text = lines.join('\n');
  }
  const n = out.addSource(ctx.registry, {
    kind: 'LINES',
    sourceId: source.id,
    sourceTitle: source.title,
    sourceType: source.type,
    path: file.path,
    lineStart: from,
    lineEnd: to,
    text,
  });
  const rest =
    to < Math.min(args.lineEnd ?? lineCount, lineCount)
      ? `\nShowing lines ${from}-${to} of ${lineCount}; read on from line ${to + 1}.`
      : '';
  return { text: out.join() + rest, summary: `${file.path}:${from}-${to} [${n}]` };
}

async function readPages(
  source: ToolSourceRow,
  args: Args & { page: number },
  out: ToolText,
  ctx: Parameters<AgentTool['execute']>[1],
): Promise<ToolResult> {
  const last = Math.min(args.pageEnd ?? args.page, args.page + maxPages - 1);
  const pages: string[] = [];
  for (let p = args.page; p <= last; p++) {
    const text = await findPageText(source.id, p);
    if (text === null) break;
    pages.push(text);
  }
  if (pages.length === 0)
    return { text: `"${source.title}" has no page ${args.page}.`, summary: 'no such page' };

  // Cut while the pages are still \f-separated, so the separators left say where it ends.
  const { text, cut } = cutToTokens(pages.join('\f'), maxTokens);
  const to = args.page + pageBreaks(text);
  const n = out.addSource(ctx.registry, {
    kind: 'PAGES',
    sourceId: source.id,
    sourceTitle: source.title,
    sourceType: source.type,
    pageStart: args.page,
    pageEnd: to,
    text: text.replaceAll('\f', '\n\n'),
  });
  const note = cut ? `\nThe text was cut to fit; read on from p. ${to}.` : '';
  return {
    text: out.join() + note,
    summary: `${source.title} p. ${args.page}${to > args.page ? `-${to}` : ''} [${n}]`,
  };
}

async function readSection(
  source: ToolSourceRow,
  tocNodeId: string,
  out: ToolText,
  ctx: Parameters<AgentTool['execute']>[1],
): Promise<ToolResult> {
  const section = await findTocSection(source.id, tocNodeId);
  if (!section)
    return {
      text: `"${source.title}" has no section with that id; use browse_toc.`,
      summary: 'no such section',
    };

  const { text, cut } = cutToTokens(section.text, maxTokens);
  const title = `${section.number ? `${section.number} ` : ''}${section.title}`;
  const pageEnd =
    cut && section.pageStart !== null ? section.pageStart + pageBreaks(text) : section.pageEnd;
  const n = out.addSource(ctx.registry, {
    kind: 'PAGES',
    sourceId: source.id,
    sourceTitle: source.title,
    sourceType: source.type,
    heading: title,
    pageStart: section.pageStart ?? undefined,
    pageEnd: pageEnd ?? undefined,
    text: text.replaceAll('\f', '\n'),
  });
  const note = cut
    ? `\nOnly the start of the section fits; read its later pages with page/pageEnd${section.pageEnd ? ` (it ends on p. ${section.pageEnd})` : ''}, or open a subsection.`
    : '';
  return { text: out.join() + note, summary: `${title} [${n}]` };
}

export const readSource: AgentTool<typeof input> = {
  name: 'read_source',
  description: `Read exact text: a repository file or web page by lines (path), a book by pages (page, pageEnd) or a whole section (tocNodeId). At most ${maxLines} lines or ${maxPages} pages per call. Numbered for citation.`,
  input,
  async execute(args, ctx) {
    const source = await toolSource(ctx, args.sourceId);
    if (!source) return { text: NO_SOURCE, summary: 'no such source' };

    const out = new ToolText(maxTokens + 100);
    if (args.path !== undefined) return readLines(source, { ...args, path: args.path }, out, ctx);
    if (args.page !== undefined) return readPages(source, { ...args, page: args.page }, out, ctx);
    if (args.tocNodeId !== undefined) return readSection(source, args.tocNodeId, out, ctx);
    return {
      text: 'Say what to read: path (with lineStart/lineEnd), page (with pageEnd) or tocNodeId.',
      summary: 'nothing to read',
    };
  },
};
