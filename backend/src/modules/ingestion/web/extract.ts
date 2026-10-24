import { Readability } from '@mozilla/readability';
import { Parser } from 'htmlparser2';
import { parseHTML } from 'linkedom';
import { appConfig } from '../../../config/app.config.js';
import { htmlToText } from './htmlText.js';

export type ExtractedPage = {
  title: string | null;
  // Markdown-like: `#` headings, lists, fenced code blocks.
  text: string;
  // Absolute URLs of the page's links, as written (not normalized or filtered).
  links: string[];
};

// Deeper pages only get their text. Real pages stay well under a few hundred levels.
const MAX_PARSE_DEPTH = 1_000;

// Page furniture the fallback drops before taking the body's text.
const CHROME = 'head, nav, header, footer, aside, script, style, noscript, template, svg, form';

/**
 * The readable content of an HTML page. Readability finds the article when the page is
 * small and shallow enough for it (it slows down sharply on deep DOMs); otherwise, or when
 * it finds nothing, the body without navigation and other page chrome is used.
 */
export function extractHtml(html: string, url: string): ExtractedPage {
  // Building the DOM is quadratic in nesting depth (40,000 nested tags take most of a
  // second, a million would take minutes), so the depth is checked first.
  if (tooDeep(html)) {
    return { title: null, text: tagsStripped(html), links: [] };
  }

  const { document } = parseHTML(html);
  // linkedom builds no implied elements: the first tag is the root, and an empty or broken
  // page has none at all.
  if (!document.documentElement) return { title: null, text: tagsStripped(html), links: [] };
  const base = URL.parse(document.querySelector('base[href]')?.getAttribute('href') ?? '', url);
  // Collected first: Readability rewrites the document it reads.
  const links: string[] = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = URL.parse(anchor.getAttribute('href') ?? '', base?.href ?? url);
    if (href) links.push(href.href);
  }
  const pageTitle = cleanTitle(document.querySelector('title')?.textContent);

  // Readability needs a whole document (<html> with a <body>).
  const readable =
    document.documentElement.localName === 'html' && readabilityCanRun(document.documentElement);
  if (readable) {
    try {
      const article = new Readability(document as never, {
        keepClasses: true,
        maxElemsToParse: appConfig.ingestion.website.readabilityMaxElements,
      }).parse();
      if (article?.content) {
        const articleDoc = parseHTML(`<html><body>${article.content}</body></html>`).document;
        const text = htmlToText(articleDoc.body);
        if (text.trim()) return { title: pageTitle ?? cleanTitle(article.title), text, links };
      }
    } catch {
      // Readability gave up (too many elements, odd markup): the fallback below still works.
    }
  }

  // The whole document is converted: a page without <body> keeps its content elsewhere.
  // Parsed again when Readability ran, since it removes parts of the document it reads.
  const fresh = readable ? parseHTML(html).document : document;
  for (const node of fresh.querySelectorAll(CHROME)) node.remove();
  return { title: pageTitle, text: htmlToText(fresh), links };
}

/** A text/plain or text/markdown page: the text itself. */
export function extractText(text: string): ExtractedPage {
  return { title: null, text, links: [] };
}

// Counts elements and depth with an explicit stack, stopping as soon as either is too big.
type ElementTree = { children: Iterable<ElementTree> };

function readabilityCanRun(root: ElementTree | null) {
  const { readabilityMaxDepth, readabilityMaxElements } = appConfig.ingestion.website;
  if (!root) return false;
  const stack: [ElementTree, number][] = [[root, 1]];
  let elements = 0;
  while (stack.length > 0) {
    const [element, depth] = stack.pop()!;
    if (++elements > readabilityMaxElements || depth > readabilityMaxDepth) return false;
    for (const child of element.children) stack.push([child, depth + 1]);
  }
  return true;
}

function cleanTitle(title: string | null | undefined) {
  const text = (title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return text || null;
}

class TooDeep extends Error {}

// htmlparser2's tokenizer alone, with the options linkedom uses, so the depth counted is
// exactly the DOM's (implied closes, comments, raw text and foreign content included). It
// stops at the limit: below it, the cost of stray close tags is bounded by the depth.
function tooDeep(html: string) {
  let depth = 0;
  const parser = new Parser(
    {
      onopentag() {
        if (++depth > MAX_PARSE_DEPTH) throw new TooDeep();
      },
      onclosetag() {
        depth--;
      },
    },
    { lowerCaseAttributeNames: false, decodeEntities: true, xmlMode: false },
  );
  try {
    parser.write(html);
    parser.end();
    return false;
  } catch (error) {
    if (error instanceof TooDeep) return true;
    throw error;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

function tagsStripped(html: string) {
  let text = '';
  for (let i = 0; i < html.length;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt) + ' ';
    const gt = html.indexOf('>', lt + 1);
    if (gt < 0) break;
    i = gt + 1;
  }
  return text
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name]!)
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n\s*/g, '\n\n')
    .trim();
}
