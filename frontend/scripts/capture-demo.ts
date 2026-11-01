// Captures what the landing page shows from the live demo, as JSON under
// src/features/landing/fixtures and page images under public/landing:
//
//   demo.json   workspace name, source counts, starter questions            (no sign-in)
//   book.json   a page of the book as an image, with the cited passage marked
//   code.json   the lines of nanoGPT the answer cites, coloured
//   graph.json  a slice of nanoGPT's call graph
//   study.json  one flashcard and one quiz question, when the demo has study sets
//   turn.json   one real question: its steps with timings, the streamed answer, its citations
//
// The page hides any section whose file is missing, so run it again whenever the demo changes.
// It signs in as a guest ONCE and asks AT MOST ONE question. A guest may ask ten questions a
// day per address (the allowance renews at 00:00 UTC), so `--skip-turn` leaves the question out.
//
//   node --import tsx scripts/capture-demo.ts [--skip-turn] [--question "…"] [--base URL]
//                         [--page N] [--pdf FILE] [--class NAME] [--seeds A,B,C] [--cache DIR] [--out DIR]
//
// --cache keeps every reply (and the guest session) in DIR, so a second run while you adjust
// this script asks the server for nothing it already gave; leave it out for a fresh capture.
// --page picks the book page to show when there is no question (default: where the contents
// say attention starts); --class and --seeds name the class shown as code and the symbols the
// graph slice starts from (comma-separated, as Class.method or function); --pdf reads the book from a file instead of the server. --out writes under DIR instead of the source tree. --question is a number picking one of the
// starter questions, or the question itself (default: the first starter question).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createParser } from 'eventsource-parser';
import { format, resolveConfig } from 'prettier';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem as PdfTextItem } from 'pdfjs-dist/types/src/display/api';
import type { Citation, Demo, GraphSymbol, Source, TocNode } from '../src/api/types';
import type {
  BookFixture,
  BookPage,
  CodeFixture,
  CodeSlice,
  CodeToken,
  DemoFixture,
  DemoSource,
  GraphFixture,
  GraphNode,
  Rect,
  StudyFixture,
  TurnFixture,
  TurnStep,
} from '../src/features/landing/fixtureTypes';

const LIVE = 'https://codebook.girishthedecent.space';
const frontend = fileURLToPath(new URL('../', import.meta.url));

// ---- command line ---------------------------------------------------------------------------

function option(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}
const skipTurn = process.argv.includes('--skip-turn');
const forcedPage = Number(option('--page')) || undefined;
const pdfFile = option('--pdf');
const codeClass = option('--class') ?? 'CausalSelfAttention';
const base = (option('--base') ?? LIVE).replace(/\/$/, '');
const cacheDir = option('--cache');
const outDir = option('--out');
const fixturesDir = outDir
  ? join(outDir, 'fixtures')
  : join(frontend, 'src/features/landing/fixtures');
const imagesDir = outDir ? join(outDir, 'public/landing') : join(frontend, 'public/landing');

// ---- talking to the server ------------------------------------------------------------------

const cookies = new Map<string, string>();
let signedIn = false;
const requests = { sent: 0, cached: 0 };

function cachePath(key: string) {
  return join(cacheDir!, createHash('sha1').update(key).digest('hex').slice(0, 16) + '.bin');
}

function storeCookies(res: Response) {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const at = pair!.indexOf('=');
    if (at > 0) cookies.set(pair!.slice(0, at).trim(), pair!.slice(at + 1).trim());
  }
}

const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

/** A request that waits out a sleeping server: the first reply after idle can take a minute. */
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(base + path, {
        ...init,
        headers: {
          Origin: base,
          ...(cookies.size ? { Cookie: cookieHeader() } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(150_000),
      });
      requests.sent++;
      if (![502, 503, 504].includes(res.status) || attempt === 4) return res;
    } catch (error) {
      if (attempt === 4) throw error;
    }
    console.log(`  waiting for the server (attempt ${attempt})…`);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

async function readCached(key: string) {
  if (!cacheDir) return undefined;
  try {
    const bytes = await readFile(cachePath(key));
    requests.cached++;
    return bytes;
  } catch {
    return undefined;
  }
}

async function writeCached(key: string, bytes: Uint8Array) {
  if (!cacheDir) return;
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath(key), bytes);
}

class NotAvailable extends Error {}

/** GET a path and return the `data` of the reply, or throw NotAvailable on a 4xx. */
async function getData<T>(path: string): Promise<T> {
  const cached = await readCached(path);
  if (cached) return JSON.parse(cached.toString('utf8')) as T;
  if (path.startsWith('/api/v1/') && path !== '/api/v1/demo') await ensureGuest();
  const res = await send(path, { headers: { Accept: 'application/json' } });
  if (res.status >= 400 && res.status < 500) {
    throw new NotAvailable(`${path} answered ${res.status}`);
  }
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  const body = (await res.json()) as { data: T };
  await writeCached(path, Buffer.from(JSON.stringify(body.data)));
  return body.data;
}

async function getBytes(path: string): Promise<Uint8Array> {
  const cached = await readCached(path);
  if (cached) return cached;
  await ensureGuest();
  const res = await send(path);
  if (!res.ok) throw new NotAvailable(`${path} answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeCached(path, bytes);
  return bytes;
}

/** The one guest sign-in of a run, or the session an earlier run kept in --cache. */
let guestReady: Promise<void> | undefined;
function ensureGuest() {
  guestReady ??= (async () => {
    const kept = await readCached('session');
    if (kept) {
      for (const [k, v] of Object.entries(
        JSON.parse(kept.toString('utf8')) as Record<string, string>,
      )) {
        cookies.set(k, v);
      }
      const check = await send('/api/v1/me', { headers: { Accept: 'application/json' } });
      if (check.ok) {
        signedIn = true;
        console.log('Using the guest session kept in --cache');
        return;
      }
      cookies.clear();
    }
    console.log('Signing in as a guest (once)…');
    const res = await send('/api/auth/sign-in/anonymous', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw new Error(`Guest sign-in answered ${res.status}`);
    storeCookies(res);
    if (cookies.size === 0) throw new Error('Guest sign-in set no cookie');
    signedIn = true;
    await writeCached('session', Buffer.from(JSON.stringify(Object.fromEntries(cookies))));
  })();
  return guestReady;
}

// ---- writing files --------------------------------------------------------------------------

async function writeFixture(name: string, value: unknown) {
  const file = join(fixturesDir, name);
  const config = (await resolveConfig(file)) ?? {};
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await format(JSON.stringify(value), { ...config, parser: 'json' }));
  console.log(`  wrote ${file.replace(frontend, '')}`);
}

async function writeImage(name: string, bytes: Uint8Array) {
  await mkdir(imagesDir, { recursive: true });
  await writeFile(join(imagesDir, name), bytes);
  console.log(
    `  wrote ${join(imagesDir, name).replace(frontend, '')} (${Math.round(bytes.length / 1024)} KB)`,
  );
}

// ---- code, coloured ---------------------------------------------------------------------------

// The colours the highlighter's light theme gives each kind of token; the page paints its own.
const kindOfColor: Record<string, string> = {
  '#d73a49': 'kw',
  '#6f42c1': 'fn',
  '#005cc5': 'num',
  '#032f62': 'str',
  '#6a737d': 'cm',
};

let highlighter: Promise<HighlighterCore> | undefined;
function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs')],
    langs: [import('shiki/langs/python.mjs')],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

async function colour(lines: string[], path: string): Promise<CodeToken[][]> {
  if (!path.endsWith('.py')) return lines.map((line) => [[line, '']]);
  const h = await getHighlighter();
  const { tokens } = h.codeToTokens(lines.join('\n'), { lang: 'python', theme: 'github-light' });
  return tokens.map((line) => {
    const out: CodeToken[] = [];
    for (const token of line) {
      const kind = kindOfColor[token.color?.toLowerCase() ?? ''] ?? '';
      const last = out[out.length - 1];
      if (last && last[1] === kind) last[0] += token.content;
      else out.push([token.content, kind]);
    }
    return out.length ? out : [['', '']];
  });
}

// ---- the demo ---------------------------------------------------------------------------------

const countOf = (value: unknown) => (typeof value === 'number' ? value : undefined);

function describeSource(source: Source): DemoSource {
  const stats = source.stats as Record<string, unknown>;
  const origin = source.origin as Record<string, unknown>;
  const graph = (stats.graph ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  const add = (key: string, value: number | undefined) => {
    if (value !== undefined) counts[key] = value;
  };
  if (source.type === 'PDF') add('pages', countOf(stats.pages));
  if (source.type === 'GITHUB_REPO') {
    add('files', countOf(stats.files));
    add('symbols', countOf(graph.symbols));
  }
  if (source.type === 'WEBSITE') add('pages', countOf(stats.pages));
  add('chunks', countOf(stats.chunks));

  let href: string | undefined;
  if (source.type === 'GITHUB_REPO' && typeof origin.owner === 'string') {
    href = `https://github.com/${origin.owner}/${origin.repo}`;
  } else if (source.type === 'WEBSITE' && typeof origin.url === 'string') {
    href = origin.url;
  }
  return { type: source.type, title: source.title, href, counts };
}

async function starterQuestions(demo: Demo): Promise<string[]> {
  if (Array.isArray(demo.starterQuestions) && demo.starterQuestions.length) {
    return demo.starterQuestions;
  }
  // A server from before the field existed: the same list the seed reads.
  const file = new URL('../../backend/prisma/demo.json', import.meta.url);
  const seed = JSON.parse(await readFile(file, 'utf8')) as { starterQuestions: string[] };
  console.log(
    '  the server sends no starterQuestions yet; read them from backend/prisma/demo.json',
  );
  return seed.starterQuestions;
}

// ---- the book -----------------------------------------------------------------------------------

type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>['promise']>['getPage']>>;
type Viewport = ReturnType<PdfPage['getViewport']>;
type TextItem = PdfTextItem;
type Word = { norm: string; item: number; from: number; to: number };

const normal = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function wordsOf(items: TextItem[]): Word[] {
  const words: Word[] = [];
  items.forEach((item, index) => {
    for (const match of item.str.matchAll(/\S+/g)) {
      const norm = normal(match[0]);
      if (norm)
        words.push({ norm, item: index, from: match.index, to: match.index + match[0].length });
    }
  });
  return words;
}

/** The longest stretch of the page that shares four-word runs with the snippet. */
function matchingWords(page: Word[], snippet: string): [number, number] | undefined {
  const GRAM = 4;
  const said = snippet.split(/\s+/).map(normal).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i + GRAM <= said.length; i++) grams.add(said.slice(i, i + GRAM).join(' '));
  const hit = new Array<boolean>(page.length).fill(false);
  for (let j = 0; j + GRAM <= page.length; j++) {
    const gram = page
      .slice(j, j + GRAM)
      .map((w) => w.norm)
      .join(' ');
    if (grams.has(gram)) for (let k = 0; k < GRAM; k++) hit[j + k] = true;
  }
  let best: [number, number] | undefined;
  let start = -1;
  let last = -1;
  for (let j = 0; j < page.length; j++) {
    if (!hit[j]) continue;
    if (start < 0 || j - last > 3) start = j;
    last = j;
    if (!best || last - start > best[1] - best[0]) best = [start, last];
  }
  return best && best[1] - best[0] + 1 >= GRAM ? best : undefined;
}

function boxesOf(items: TextItem[], words: Word[], range: [number, number], viewport: Viewport) {
  const spans = new Map<number, [number, number]>();
  for (const word of words.slice(range[0], range[1] + 1)) {
    const span = spans.get(word.item);
    spans.set(word.item, [
      Math.min(span?.[0] ?? word.from, word.from),
      Math.max(span?.[1] ?? 0, word.to),
    ]);
  }
  const rects: Rect[] = [];
  for (const [index, [from, to]] of spans) {
    const item = items[index]!;
    const length = Math.max(item.str.length, 1);
    const height = item.height || Math.abs(item.transform[3]!);
    const left = item.transform[4]! + item.width * (from / length);
    const right = item.transform[4]! + item.width * (to / length);
    const baseline = item.transform[5]!;
    const [x1, y1] = viewport.convertToViewportPoint(left, baseline - height * 0.22) as number[];
    const [x2, y2] = viewport.convertToViewportPoint(right, baseline + height * 0.88) as number[];
    rects.push({
      x: Math.min(x1!, x2!) / viewport.width,
      y: Math.min(y1!, y2!) / viewport.height,
      w: Math.abs(x2! - x1!) / viewport.width,
      h: Math.abs(y2! - y1!) / viewport.height,
    });
  }
  // One box per line: join the neighbours that sit on the same baseline.
  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Rect[] = [];
  for (const rect of rects) {
    const prev = lines[lines.length - 1];
    if (prev && Math.abs(prev.y - rect.y) < rect.h * 0.5 && rect.x - (prev.x + prev.w) < 0.03) {
      prev.w = Math.max(prev.x + prev.w, rect.x + rect.w) - prev.x;
      prev.h = Math.max(prev.h, rect.h);
    } else {
      lines.push({ ...rect });
    }
  }
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return lines.map((r) => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }));
}

const WIDTH = 900;

export async function renderPages(
  pdfBytes: Uint8Array,
  wanted: Array<{ page: number; citations: Citation[] }>,
) {
  const standardFontDataUrl = join(frontend, 'node_modules/pdfjs-dist/standard_fonts') + '/';
  const doc = await getDocument({ data: pdfBytes, standardFontDataUrl, verbosity: 0 }).promise;
  const pages: BookPage[] = [];
  for (const { page: number, citations } of wanted) {
    if (number < 1 || number > doc.numPages) continue;
    const page = await doc.getPage(number);
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / unit.width });
    const factory = (doc as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const { canvas, context } = factory.create(viewport.width, viewport.height);
    await page.render({ canvasContext: context, viewport, canvas } as never).promise;
    const name = `book-p${number}.webp`;
    await writeImage(name, canvas.toBuffer('image/webp', 82));

    const items = (await page.getTextContent()).items.filter(
      (item): item is TextItem => 'str' in item,
    );
    const words = wordsOf(items);
    const marks: BookPage['marks'] = [];
    for (const citation of citations) {
      const range = matchingWords(words, citation.snippet);
      if (!range) {
        console.log(
          `  [${citation.n}] on page ${number}: no match for the snippet; page left unmarked`,
        );
        continue;
      }
      marks.push({
        n: citation.n,
        rects: boxesOf(items, words, range, page.getViewport({ scale: 1 })),
      });
    }
    pages.push({
      page: number,
      image: `/landing/${name}`,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      marks,
    });
  }
  return pages;
}

type CanvasFactory = {
  create(
    width: number,
    height: number,
  ): { canvas: { toBuffer(type: string, quality?: number): Uint8Array }; context: unknown };
};

function flatten(nodes: TocNode[]): TocNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

/** The page the book opens on for the shelf: where it starts on attention. */
async function attentionPage(book: Source): Promise<number | undefined> {
  const toc = flatten(await getData<TocNode[]>(`/api/v1/sources/${book.id}/toc`));
  const patterns = [/attention (layer|model|operator)/i, /attention/i, /transformer/i];
  for (const pattern of patterns) {
    const node = toc.find((n) => pattern.test(n.title) && n.pageStart !== null);
    if (node) {
      console.log(`  contents entry "${node.title}" starts on page ${node.pageStart}`);
      return node.pageStart!;
    }
  }
  return undefined;
}

// ---- the code ---------------------------------------------------------------------------------

type FileLines = {
  path: string;
  lineStart: number;
  lineEnd: number;
  lines: Array<{ n: number; text: string }>;
};

async function readLines(repo: Source, path: string, lineStart: number, lineEnd: number) {
  const query = new URLSearchParams({
    path,
    lineStart: String(lineStart),
    lineEnd: String(lineEnd),
  });
  const content = await getData<FileLines>(`/api/v1/sources/${repo.id}/content?${query}`);
  const slice: CodeSlice = {
    path: content.path,
    lineStart: content.lineStart,
    lineEnd: content.lineEnd,
    lines: await colour(
      content.lines.map((l) => l.text),
      content.path,
    ),
  };
  return slice;
}

const MAX_SLICE = 70;

async function searchSymbols(repo: Source, name: string) {
  return getData<GraphSymbol[]>(
    `/api/v1/sources/${repo.id}/graph/symbols?q=${encodeURIComponent(name)}&limit=20`,
  );
}

// ---- the call graph ---------------------------------------------------------------------------

// Where the graph slice starts: the parts of a forward pass and of the training loop.
const GRAPH_SEEDS = (
  option('--seeds')?.split(',') ?? [
    'GPT.forward',
    'GPT.generate',
    'GPT.configure_optimizers',
    'GPT.get_num_params',
    'Block.forward',
    'CausalSelfAttention.forward',
    'MLP.forward',
    'LayerNorm.forward',
    'estimate_loss',
    'get_batch',
    'get_lr',
  ]
).map((seed) => seed.trim());

type Walk = { symbol: GraphSymbol; symbols: Array<GraphSymbol & { depth: number }> };

async function graphSlice(repo: Source, repoName: string): Promise<GraphFixture | undefined> {
  const nodes = new Map<string, GraphNode>();
  const edges = new Set<string>();
  const nodeOf = (s: GraphSymbol): GraphNode => ({
    id: s.id,
    name: s.qualifiedName.includes('#') ? s.qualifiedName.split('#').pop()! : s.qualifiedName,
    kind: s.kind,
    path: s.filePath,
    line: s.lineStart,
  });
  for (const seed of GRAPH_SEEDS) {
    const [owner, member] = seed.includes('.') ? seed.split('.') : [undefined, seed];
    // Several symbols share a method name (forward): take the one inside the named class.
    const root = (await searchSymbols(repo, member!)).find(
      (s) => s.name === member && (!owner || s.qualifiedName.endsWith(`${owner}.${member}`)),
    );
    if (!root) {
      console.log(`  no symbol ${seed}`);
      continue;
    }
    const walk = await getData<Walk>(
      `/api/v1/sources/${repo.id}/graph/dependencies?symbol=${encodeURIComponent(root.id)}&depth=1`,
    );
    const calls = walk.symbols.filter((s) => s.depth === 1 && s.kind !== 'FILE');
    if (calls.length === 0) continue;
    nodes.set(root.id, nodeOf(root));
    for (const s of calls) {
      nodes.set(s.id, nodeOf(s));
      edges.add(`${root.id}>${s.id}`);
    }
  }
  console.log(`  graph slice: ${nodes.size} symbols, ${edges.size} calls`);
  if (edges.size === 0) return undefined;

  const list = [...edges].map((e) => e.split('>') as [string, string]);
  // The longest chain the captured edges make is the nicest first example.
  const featured = longestChain(list);
  return { repo: repoName, nodes: [...nodes.values()], edges: list, featured };
}

function longestChain(edges: Array<[string, string]>): [string, string] | undefined {
  const next = new Map<string, string[]>();
  for (const [from, to] of edges) next.set(from, [...(next.get(from) ?? []), to]);
  let best: [string, string] | undefined;
  let bestLength = 1;
  for (const start of next.keys()) {
    const seen = new Map<string, number>([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const at = queue.shift()!;
      for (const to of next.get(at) ?? []) {
        if (seen.has(to)) continue;
        seen.set(to, seen.get(at)! + 1);
        queue.push(to);
        if (seen.get(to)! > bestLength) {
          bestLength = seen.get(to)!;
          best = [start, to];
        }
      }
    }
  }
  return best;
}

// ---- study sets -------------------------------------------------------------------------------

type StudyListItem = { id: string; type: string; status: string };
type StudyDetail = { data?: unknown; sources: Citation[] };

async function studyItems(workspaceId: string): Promise<StudyFixture | undefined> {
  const list = await getData<{ items: StudyListItem[] }>(
    `/api/v1/workspaces/${workspaceId}/study?limit=50`,
  ).catch(() => undefined);
  const done = list?.items.filter((s) => s.status === 'DONE') ?? [];
  if (done.length === 0) {
    console.log('  the demo has no study sets yet');
    return undefined;
  }
  const out: StudyFixture = {};
  const cite = (detail: StudyDetail, numbers: number[]) =>
    detail.sources.find((s) => s.n === numbers[0]);

  const cards = done.find((s) => s.type === 'FLASHCARDS');
  if (cards) {
    const detail = await getData<StudyDetail>(`/api/v1/study/${cards.id}`);
    const all = ((detail.data as { cards?: unknown[] })?.cards ?? []) as Array<{
      front: string;
      back: string;
      citations: number[];
    }>;
    const card = all.find((c) => c.citations?.length) ?? all[0];
    if (card) {
      out.flashcard = {
        front: card.front,
        back: card.back,
        citation: cite(detail, card.citations ?? []),
      };
    }
  }
  const quiz = done.find((s) => s.type === 'QUIZ');
  if (quiz) {
    const detail = await getData<StudyDetail>(`/api/v1/study/${quiz.id}`);
    const all = ((detail.data as { questions?: unknown[] })?.questions ?? []) as Array<{
      question: string;
      options: string[];
      answerIndex: number;
      explanation: string;
      citations: number[];
    }>;
    const q = all.find((x) => x.citations?.length) ?? all[0];
    if (q) {
      out.quiz = {
        question: q.question,
        options: q.options,
        answerIndex: q.answerIndex,
        explanation: q.explanation,
        citation: cite(detail, q.citations ?? []),
      };
    }
  }
  return out.flashcard || out.quiz ? out : undefined;
}

// ---- one question -----------------------------------------------------------------------------

type StreamedEvent = { event: string; data: Record<string, unknown> };

async function askOnce(workspaceId: string, question: string): Promise<TurnFixture> {
  await ensureGuest();
  const created = await send(`/api/v1/workspaces/${workspaceId}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  });
  if (!created.ok) throw new Error(`Creating a conversation answered ${created.status}`);
  const conversationId = ((await created.json()) as { data: { id: string } }).data.id;

  console.log(`Asking: ${question}`);
  const startedAt = performance.now();
  const res = await send(`/api/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ content: question, useMemory: false }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`The question answered ${res.status}: ${body.slice(0, 300)}`);
  }

  const events: Array<StreamedEvent & { at: number }> = [];
  const parser = createParser({
    onEvent(message) {
      events.push({
        event: message.event ?? 'message',
        data: JSON.parse(message.data) as Record<string, unknown>,
        at: Math.round(performance.now() - startedAt),
      });
    },
  });
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    parser.feed(decoder.decode(chunk, { stream: true }));
  }

  const failed = events.find((e) => e.event === 'error');
  if (failed || !events.some((e) => e.event === 'done')) {
    throw new Error(`The turn did not finish: ${JSON.stringify(failed?.data ?? 'no done event')}`);
  }

  // Steps: pair each start with its end, by id when the server sends one.
  const steps: TurnStep[] = [];
  const open: Array<{ key: string; step: TurnStep }> = [];
  for (const { event, data, at } of events) {
    if (event !== 'step') continue;
    const key = String(data.id ?? `${data.index}:${data.tool}`);
    if (data.status === 'start') {
      const step: TurnStep = { tool: String(data.tool), args: data.args, startAt: at };
      steps.push(step);
      open.push({ key, step });
    } else {
      const at2 = open.findIndex((o) => o.key === key);
      const pending = at2 === -1 ? undefined : open.splice(at2, 1)[0]!.step;
      const step = pending ?? { tool: String(data.tool), startAt: at };
      if (!pending) steps.push(step);
      step.ms = countOf(data.ms);
      if (typeof data.summary === 'string') step.summary = data.summary;
      if (typeof data.ok === 'boolean') step.ok = data.ok;
    }
  }

  // The streamed text, with tokens that arrived within 40 ms of each other joined.
  const chunks: TurnFixture['chunks'] = [];
  for (const { event, data, at } of events) {
    if (event !== 'token') continue;
    const last = chunks[chunks.length - 1];
    if (last && at - last.at < 40) last.text += String(data.text);
    else chunks.push({ at, text: String(data.text) });
  }
  const done = events.find((e) => e.event === 'done')!.data;
  const citations = (events.find((e) => e.event === 'citations')?.data.items ?? []) as Citation[];
  console.log(`  ${steps.length} steps, ${chunks.length} chunks, ${citations.length} citations`);

  return {
    capturedAt: new Date().toISOString(),
    question,
    steps,
    chunks,
    answer: chunks.map((c) => c.text).join(''),
    citations,
    latencyMs: countOf(done.latencyMs) ?? Math.round(performance.now() - startedAt),
  };
}

// ---- main -----------------------------------------------------------------------------------------

async function main() {
  console.log(`Capturing from ${base}${skipTurn ? ' (without the question)' : ''}`);
  console.log('Reading the demo…');
  const demo = await getData<Demo>('/api/v1/demo');
  const questions = await starterQuestions(demo);
  const book = demo.sources.find((s) => s.type === 'PDF');
  const repo = demo.sources.find((s) => s.type === 'GITHUB_REPO');

  const demoFixture: DemoFixture = {
    capturedAt: new Date().toISOString(),
    workspaceName: demo.workspace.name,
    starterQuestions: questions,
    sources: demo.sources.map(describeSource),
  };
  await writeFixture('demo.json', demoFixture);

  let turn: TurnFixture | undefined;
  if (!skipTurn) {
    const choice = option('--question');
    const question = !choice
      ? questions[0]
      : /^\d+$/.test(choice)
        ? questions[Number(choice) - 1]
        : choice;
    if (!question) throw new Error('No question to ask');
    turn = await askOnce(demo.workspace.id, question);
    await writeFixture('turn.json', turn);
  }

  const repoName = repo
    ? (describeSource(repo).href ?? repo.title).replace('https://github.com/', '')
    : '';
  const cited = (type: 'PDF' | 'GITHUB_REPO') =>
    turn?.citations.filter((c) => c.sourceType === type && c.valid) ?? [];

  /** Runs one part of the capture; a part the server won't give is skipped, not fatal. */
  async function attempt(label: string, run: () => Promise<void>) {
    console.log(`${label}…`);
    try {
      await run();
    } catch (error) {
      if (!(error instanceof NotAvailable)) throw error;
      console.log(`  skipped: ${error.message}`);
    }
  }

  if (book) {
    await attempt('The book', async () => {
      const bytes = pdfFile
        ? new Uint8Array(await readFile(pdfFile))
        : await getBytes(`/api/v1/sources/${book.id}/file`);
      const byPage = new Map<number, Citation[]>();
      for (const c of cited('PDF')) {
        if (c.pageStart) byPage.set(c.pageStart, [...(byPage.get(c.pageStart) ?? []), c]);
      }
      const wanted = [...byPage].slice(0, 3).map(([page, citations]) => ({ page, citations }));
      if (wanted.length === 0) {
        const page = forcedPage ?? (await attentionPage(book));
        if (page) wanted.push({ page, citations: [] });
      }
      const pages = await renderPages(bytes, wanted);
      if (pages.length === 0) return;
      const credit = 'François Fleuret, The Little Book of Deep Learning (CC BY-NC-SA 4.0)';
      await writeFixture('book.json', { title: book.title, credit, pages } satisfies BookFixture);
    });
  }

  if (repo) {
    await attempt('The code', async () => {
      const slices: CodeSlice[] = [];
      const attention = (await searchSymbols(repo, codeClass)).find(
        (sym) => sym.name === codeClass && sym.kind === 'CLASS',
      );
      if (attention) {
        const end = Math.min(attention.lineEnd, attention.lineStart + MAX_SLICE - 1);
        slices.push(await readLines(repo, attention.filePath, attention.lineStart, end));
      } else {
        console.log(`  no ${codeClass} class in the graph`);
      }
      for (const c of cited('GITHUB_REPO')) {
        if (!c.path || !c.lineStart) continue;
        const end = Math.min(c.lineEnd ?? c.lineStart, c.lineStart + MAX_SLICE - 1);
        const covered = slices.some(
          (s) => s.path === c.path && s.lineStart <= c.lineStart! && s.lineEnd >= end,
        );
        if (!covered) {
          slices.push(await readLines(repo, c.path, Math.max(1, c.lineStart - 2), end + 2));
        }
      }
      if (slices.length === 0) return;
      const code: CodeFixture = {
        repo: repoName,
        ref: String((repo.origin as { ref?: string }).ref ?? ''),
        href: describeSource(repo).href ?? '',
        credit: 'Andrej Karpathy, nanoGPT (MIT)',
        slices,
      };
      await writeFixture('code.json', code);
    });

    await attempt('The call graph', async () => {
      const graph = await graphSlice(repo, repoName);
      if (graph) await writeFixture('graph.json', graph);
    });
  }

  await attempt('Study sets', async () => {
    const study = await studyItems(demo.workspace.id);
    if (study) await writeFixture('study.json', study);
  });

  console.log(
    `Done: ${requests.sent} requests sent, ${requests.cached} answered from --cache, ` +
      `${signedIn ? '1 guest session' : 'no sign-in'}, ${turn ? '1 question' : 'no question'}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
