import { z } from 'zod';
import { appConfig } from '../../../config/app.config.js';
import { listTocNodes } from '../../sources/sourceContent.repository.js';
import type { AgentTool } from './tool.types.js';
import { ToolText } from './toolText.js';
import { NO_SOURCE, toolSource } from './toolSources.js';

const input = z.object({
  sourceId: z.string().describe('The book or document'),
  nodeId: z.string().optional().describe('Open this section; leave out for the top level'),
});

type Node = Awaited<ReturnType<typeof listTocNodes>>[number];

const pages = (node: Node) =>
  node.pageStart === null
    ? ''
    : node.pageEnd === null || node.pageEnd === node.pageStart
      ? ` (p. ${node.pageStart})`
      : ` (pp. ${node.pageStart}-${node.pageEnd})`;

export const browseToc: AgentTool<typeof input> = {
  name: 'browse_toc',
  description: `Show a book's table of contents, ${appConfig.tools.tocDepth} levels at a time, with page ranges and section ids. Use it for questions about a chapter or section, then read_source with the section id or pages. Nothing to cite here.`,
  input,
  async execute(args, ctx) {
    const source = await toolSource(ctx, args.sourceId);
    if (!source) return { text: NO_SOURCE, summary: 'no such source' };

    const nodes = await listTocNodes(source.id);
    if (nodes.length === 0) {
      return {
        text: `"${source.title}" has no table of contents; use search_sources or list_files.`,
        summary: 'no TOC',
      };
    }

    const children = new Map<string | null, Node[]>();
    for (const node of nodes) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }

    let start: string | null = null;
    let heading = `Contents of "${source.title}":`;
    if (args.nodeId) {
      const node = nodes.find((n) => n.id === args.nodeId);
      if (!node)
        return {
          text: `"${source.title}" has no section with that id.`,
          summary: 'no such section',
        };
      start = node.id;
      heading = `${node.number ? `${node.number} ` : ''}${node.title}${pages(node)}, sections:`;
    }

    const out = new ToolText();
    out.add(heading);
    const walk = (parentId: string | null, depth: number) => {
      for (const node of children.get(parentId) ?? []) {
        const label = `${node.number ? `${node.number} ` : ''}${node.title}`;
        const more =
          depth === appConfig.tools.tocDepth && children.has(node.id) ? ' [has subsections]' : '';
        out.add(`${'  '.repeat(depth - 1)}- ${label}${pages(node)} [id ${node.id}]${more}`);
        if (depth < appConfig.tools.tocDepth) walk(node.id, depth + 1);
      }
    };
    walk(start, 1);
    if (!children.has(start)) out.add('(no subsections; read it with read_source)');
    // Outside the budget, so a full list still says it is incomplete.
    const trailer = out.left > 0 ? `\n${out.left} more entries; open a section by its id.` : '';
    return {
      text: out.join('\n') + trailer,
      summary: `TOC of "${source.title}"${args.nodeId ? ' section' : ''}`,
    };
  },
};
