import prismaClient from '../src/config/db.config.js';
import { generate } from '../src/llm/client.js';
import type { ModelRef } from '../src/llm/models.js';
import { longContextAnswerPrompt } from '../src/llm/prompts/longContextAnswer.js';
import { countTokens } from '../src/utils/tokens.js';
import type { StoredAnswerContext } from './answer.types.js';
import type { Corpus } from './corpusWorkspace.js';
import type { ExpectedRef } from './dataset.js';
import { comparableUrl } from './matching.js';

// The long-context baseline: instead of retrieving, put the corpus text itself in the prompt,
// each source cut to its share of the token budget. What was cut is recorded, so the report
// can tell "the method failed" from "the answer wasn't in the prompt".

// One piece of a source that is kept or dropped whole: a book page, a file, a web page.
type Unit = { key: string; text: string; tokens: number };

type SourceText = { sourceKey: string; title: string; units: Unit[]; total: number };

export type LongContext = {
  documents: string;
  tokens: number;
  kept: NonNullable<StoredAnswerContext['longContext']>['kept'];
  // Unit keys that made it into the prompt: `book:<page>`, `repo:<path>`, `docs:<url>`.
  keptUnits: Set<string>;
};

// Source text must not be able to close its block or open a new one.
const neutralize = (text: string) => text.replace(/<(\/?)(document|file|page)\b/gi, '‹$1$2');

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function unit(key: string, text: string): Unit {
  return { key, text, tokens: countTokens(text) };
}

/** The corpus as units, in reading order: pages in order, files and web pages by path. */
async function corpusText(corpus: Corpus): Promise<SourceText[]> {
  const sources: SourceText[] = [];
  for (const ref of corpus.sources) {
    const source = await prismaClient.source.findUniqueOrThrow({
      where: { id: ref.sourceId },
      select: { title: true },
    });
    const documents = await prismaClient.sourceDocument.findMany({
      where: { sourceId: ref.sourceId, skippedReason: null },
      select: { path: true, content: true, pageStart: true },
      orderBy: { path: 'asc' },
    });
    const units: Unit[] = [];
    for (const document of documents) {
      if (ref.type === 'PDF') {
        // Pages are joined with \f, so page N is a split away.
        const first = document.pageStart ?? 1;
        document.content.split('\f').forEach((page, i) => {
          if (!page.trim()) return;
          units.push(unit(`book:${first + i}`, `[page ${first + i}]\n${neutralize(page.trim())}`));
        });
      } else if (ref.type === 'GITHUB_REPO') {
        const path = attr(document.path);
        const body = neutralize(document.content);
        const key = `repo:${document.path.replace(/^\.?\/+/, '')}`;
        units.push(unit(key, `<file path="${path}">\n${body}\n</file>`));
      } else {
        const url = comparableUrl(document.path) ?? document.path;
        const body = neutralize(document.content);
        units.push(unit(`docs:${url}`, `<page url="${attr(document.path)}">\n${body}\n</page>`));
      }
    }
    const total = units.reduce((sum, item) => sum + item.tokens, 0);
    sources.push({ sourceKey: ref.sourceKey, title: source.title, units, total });
  }
  return sources;
}

/**
 * Shares the budget out: a source smaller than its share keeps everything and leaves the
 * rest to the others, so a short web page doesn't waste half the window.
 */
export function shareBudget(totals: Record<string, number>, budget: number) {
  const shares: Record<string, number> = {};
  const bySize = Object.entries(totals).sort(([, a], [, b]) => a - b);
  let left = budget;
  bySize.forEach(([key, total], i) => {
    const share = Math.min(total, Math.floor(left / (bySize.length - i)));
    shares[key] = share;
    left -= share;
  });
  return shares;
}

/** Builds the documents block once per run; every case of the run reuses it. */
export async function buildLongContext(corpus: Corpus, maxTokens: number): Promise<LongContext> {
  const sources = await corpusText(corpus);
  const shares = shareBudget(
    Object.fromEntries(sources.map((source) => [source.sourceKey, source.total])),
    maxTokens,
  );

  const blocks: string[] = [];
  const kept: LongContext['kept'] = {};
  const keptUnits = new Set<string>();
  let tokens = 0;
  for (const source of sources) {
    const allowance = shares[source.sourceKey] ?? 0;
    let used = 0;
    const parts: string[] = [];
    // A unit that doesn't fit is skipped whole; smaller ones after it may still fit.
    for (const item of source.units) {
      if (used + item.tokens > allowance) continue;
      used += item.tokens;
      parts.push(item.text);
      keptUnits.add(item.key);
    }
    kept[source.sourceKey] = { tokens: used, total: source.total };
    tokens += used;
    const cut = used < source.total ? ' cut="true"' : '';
    blocks.push(
      `<document key="${attr(source.sourceKey)}" title="${attr(source.title)}"${cut}>\n${parts.join('\n\n')}\n</document>`,
    );
  }
  return { documents: blocks.join('\n\n'), tokens, kept, keptUnits };
}

/** For each expected ref: was all of it in the prompt. */
export function refsCovered(context: Pick<LongContext, 'keptUnits'>, refs: ExpectedRef[]) {
  return refs.map((ref) => {
    switch (ref.sourceKey) {
      case 'book': {
        for (let page = ref.pageStart; page <= ref.pageEnd; page++) {
          if (!context.keptUnits.has(`book:${page}`)) return false;
        }
        return true;
      }
      case 'repo':
        return context.keptUnits.has(`repo:${ref.path.replace(/^\.?\/+/, '')}`);
      case 'docs': {
        const url = comparableUrl(ref.url);
        return url !== null && context.keptUnits.has(`docs:${url}`);
      }
    }
  });
}

export async function answerLongContext(input: {
  context: LongContext;
  question: string;
  model: ModelRef;
  signal: AbortSignal;
  userId: string;
  workspaceId: string;
}) {
  const { text, call } = await generate({
    task: 'longContext',
    prompt: longContextAnswerPrompt.render({
      documents: input.context.documents,
      question: input.question,
    }),
    modelOverride: input.model,
    abortSignal: input.signal,
    ctx: { userId: input.userId, workspaceId: input.workspaceId },
  });
  return { answer: text, call };
}
