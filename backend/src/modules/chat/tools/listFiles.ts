import { z } from 'zod';
import { listDocuments } from '../../sources/sourceContent.repository.js';
import type { AgentTool } from './tool.types.js';
import { ToolText } from './toolText.js';
import { NO_SOURCE, toolSource } from './toolSources.js';

const PAGE = 200;

const input = z.object({
  sourceId: z.string().describe('The source whose files to list'),
  prefix: z.string().optional().describe('Only paths starting with this, e.g. "src/services/"'),
});

const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${bytes} B`;

export const listFiles: AgentTool<typeof input> = {
  name: 'list_files',
  description:
    'List the files (or web pages) a source has, with language and size, to see how a repository is laid out before reading files. Nothing to cite.',
  input,
  async execute(args, ctx) {
    const source = await toolSource(ctx, args.sourceId);
    if (!source) return { text: NO_SOURCE, summary: 'no such source' };

    const { items, nextCursor } = await listDocuments(source.id, {
      limit: PAGE,
      prefix: args.prefix,
    });
    if (items.length === 0) {
      return {
        text: args.prefix
          ? `No file of "${source.title}" starts with "${args.prefix}".`
          : `"${source.title}" has no files yet.`,
        summary: 'no files',
      };
    }

    const out = new ToolText();
    out.add(`Files of "${source.title}"${args.prefix ? ` under "${args.prefix}"` : ''}:`);
    let shown = 0;
    for (const file of items) {
      const details = file.skippedReason
        ? `not indexed: ${file.skippedReason}`
        : [file.language, size(file.sizeBytes)].filter(Boolean).join(', ');
      if (out.add(`${file.path} (${details})`)) shown += 1;
    }
    const more = nextCursor !== null || out.left > 0;
    // Outside the budget, so a full list still says it is incomplete.
    const trailer = more ? '\nMore files exist; pass a narrower prefix.' : '';
    return {
      text: out.join('\n') + trailer,
      summary: `${shown}${more ? '+' : ''} files`,
    };
  },
};
