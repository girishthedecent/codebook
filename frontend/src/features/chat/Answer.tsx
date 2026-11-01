import {
  createContext,
  Fragment,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation } from '@/api/types';
import { Button } from '@/ui';
import { cn } from '@/lib/cn';
import { Cite } from '@/features/citations/Cite';
import { MarginNotes } from '@/features/citations/MarginNotes';
import { numberCitations, type Note } from '@/features/citations/numbering';
import { languageFor, useHighlight, type Token } from '@/features/viewer/highlight';
import '@/features/viewer/code.css';
import { citeNumber, linkCitations } from './markers';
import { useCopy } from './useCopy';

type Cites = {
  byNumber: Map<number, Citation>;
  shown: ReadonlyMap<number, number>;
  messageId?: string;
  /** The answer is finished: code can be coloured and margin notes shown. */
  final: boolean;
  margin: boolean;
};

// The markdown components are fixed functions that read this, so a new marker or citation
// never swaps a component's type and remounts every chip already on screen.
const CiteContext = createContext<Cites>({
  byNumber: new Map(),
  shown: new Map(),
  final: false,
  margin: false,
});

/**
 * Answer text as serif prose. While it streams, the markdown is re-parsed at most every 50 ms
 * (parsing on every frame costs more than it shows); once the turn ends it renders the final
 * text straight away.
 */
export function Answer({
  text,
  citations,
  messageId,
  streaming,
  margin = false,
}: {
  text: string;
  citations: Citation[];
  messageId?: string;
  streaming: boolean;
  /** Set the notes beside the paragraphs that cite them, when the page is wide enough. */
  margin?: boolean;
}) {
  const shown = useThrottled(text, streaming ? 50 : 0);
  const cites = useMemo<Cites>(
    () => ({
      byNumber: new Map(citations.map((c) => [c.n, c])),
      shown: numberCitations(shown, citations).numbers,
      messageId,
      final: !streaming,
      margin: margin && !streaming,
    }),
    [shown, citations, messageId, streaming, margin],
  );
  return (
    <CiteContext.Provider value={cites}>
      <AnswerMarkdown text={shown} />
    </CiteContext.Provider>
  );
}

const AnswerMarkdown = memo(function AnswerMarkdown({ text }: { text: string }) {
  const source = useMemo(() => linkCitations(text), [text]);
  return (
    <div className="prose break-words text-ink">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </Markdown>
    </div>
  );
});

function Marker({ href, children }: { href?: string; children?: ReactNode }) {
  const { byNumber, shown, messageId } = useContext(CiteContext);
  const n = citeNumber(href);
  if (n === undefined) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  const citation = byNumber.get(n);
  const number = shown.get(n) ?? n;
  // Citations arrive after the text; until then the number is a quiet placeholder.
  return citation ? (
    <Cite citation={citation} shown={number} messageId={messageId} />
  ) : (
    <sup className="mx-px font-sans text-[0.68em] font-medium text-ink-3">{number}</sup>
  );
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** A code block with its language named above it and a button that copies it. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const { final } = useContext(CiteContext);
  const code = textOf(children).replace(/\n$/, '');
  const className = isValidElement<{ className?: string }>(children)
    ? children.props.className
    : '';
  const language = /language-([\w+#-]+)/.exec(className ?? '')?.[1];
  const { copy, label, announced } = useCopy(code);
  // Colours arrive once the answer is done; while it streams the block stays plain.
  const tokens = useHighlight(
    final ? code : undefined,
    languageFor(`.${language ?? ''}`, language),
  );
  return (
    <figure className="m-0 mb-[0.9em]">
      <figcaption className="flex items-center justify-between rounded-t-md border border-b-0 border-rule bg-paper-3 pl-3 font-sans text-xs text-ink-3">
        <span>{language ?? ''}</span>
        <Button variant="ghost" size="sm" onClick={copy}>
          {label}
        </Button>
        <span role="status" className="sr-only">
          {announced}
        </span>
      </figcaption>
      <pre className={cn('mb-0 rounded-t-none', tokens && 'cb-code')}>
        {tokens ? <Coloured code={code} tokens={tokens} /> : children}
      </pre>
    </figure>
  );
}

function Coloured({ code, tokens }: { code: string; tokens: Array<Token[] | undefined> }) {
  const lines = code.split('\n');
  return (
    <code>
      {lines.map((raw, i) => (
        <Fragment key={i}>
          {tokens[i]?.map(([text, light, dark, fontStyle], j) => (
            <span
              key={j}
              className="t"
              data-i={fontStyle & 1 ? '' : undefined}
              style={{ '--l': light || undefined, '--d': dark || undefined } as CSSProperties}
            >
              {text}
            </span>
          )) ?? raw}
          {i < lines.length - 1 && '\n'}
        </Fragment>
      ))}
    </code>
  );
}

// Inside a list or a quote the outer block already carries the notes for everything in it.
const NestedContext = createContext(false);

type HastNode = { properties?: { href?: unknown }; children?: HastNode[] };

/** Registry numbers of the markers inside a block, once each, in reading order. */
function citedIn(node: HastNode | undefined, found: number[] = []): number[] {
  if (!node) return found;
  const n = citeNumber(
    typeof node.properties?.href === 'string' ? node.properties.href : undefined,
  );
  if (n !== undefined && !found.includes(n)) found.push(n);
  for (const child of node.children ?? []) citedIn(child, found);
  return found;
}

// A block that cites something sits in a two-column row once the page is wide enough: the
// text, and its notes beside it. The row grows to the taller of the two, so notes of
// neighbouring paragraphs can't overlap. The notes column hangs into the page margin.
const ROW =
  'lg:@min-[69rem]:grid lg:@min-[69rem]:w-[calc(100%+13.25rem)] lg:@min-[69rem]:grid-cols-[minmax(0,1fr)_12rem] lg:@min-[69rem]:gap-x-5 [&>:first-child]:mb-[0.9em] last:[&>:first-child]:mb-0';
const MARGIN = 'hidden lg:@min-[69rem]:block';

function Block({
  tag: Tag,
  node,
  start,
  children,
}: {
  tag: 'p' | 'ul' | 'ol' | 'blockquote';
  node?: unknown;
  /** Where a numbered list begins, when a code block cut it in two. */
  start?: number;
  children?: ReactNode;
}) {
  const nested = useContext(NestedContext);
  const { byNumber, shown, margin, messageId } = useContext(CiteContext);
  const element = Tag === 'ol' ? <ol start={start}>{children}</ol> : <Tag>{children}</Tag>;
  const body =
    Tag === 'p' ? element : <NestedContext.Provider value>{element}</NestedContext.Provider>;
  const cited = nested ? [] : citedIn(node as HastNode);
  if (cited.length === 0) return body;

  const notes: Note[] = [];
  for (const n of cited) {
    const citation = byNumber.get(n);
    const number = shown.get(n);
    if (citation?.valid && number !== undefined) notes.push({ citation, shown: number });
  }
  return (
    <div className={ROW}>
      {body}
      {margin && notes.length > 0 && (
        <MarginNotes notes={notes} messageId={messageId} className={MARGIN} />
      )}
    </div>
  );
}

const components: Components = {
  a: Marker,
  pre: CodeBlock,
  p: ({ node, children }) => (
    <Block tag="p" node={node}>
      {children}
    </Block>
  ),
  ul: ({ node, children }) => (
    <Block tag="ul" node={node}>
      {children}
    </Block>
  ),
  ol: ({ node, start, children }) => (
    <Block tag="ol" node={node} start={start}>
      {children}
    </Block>
  ),
  blockquote: ({ node, children }) => (
    <Block tag="blockquote" node={node}>
      {children}
    </Block>
  ),
  // A wide table scrolls on its own instead of widening the page.
  table({ children }) {
    return (
      <div className="mb-[0.9em] overflow-x-auto">
        <table className="m-0">{children}</table>
      </div>
    );
  },
  // Images in answers would be fetched from anywhere the model names; show the alt text.
  img({ alt }) {
    return alt ? <span className="text-ink-3">[{alt}]</span> : null;
  },
};

/** The value, updated at most once per `ms` (0 = immediately). Always ends on the latest value. */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);

  useEffect(() => {
    if (ms === 0) return;
    const wait = Math.max(0, last.current + ms - Date.now());
    const t = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(t);
  }, [value, ms]);

  return ms === 0 ? value : shown;
}
