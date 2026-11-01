import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation } from '@/api/types';
import { Button } from '@/ui';
import { Cite } from '@/features/citations/Cite';
import { numberCitations } from '@/features/citations/numbering';
import { citeNumber, linkCitations } from './markers';
import { useCopy } from './useCopy';

type Cites = {
  byNumber: Map<number, Citation>;
  shown: ReadonlyMap<number, number>;
  messageId?: string;
};

// The markdown components are fixed functions that read this, so a new marker or citation
// never swaps a component's type and remounts every chip already on screen.
const CiteContext = createContext<Cites>({ byNumber: new Map(), shown: new Map() });

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
}: {
  text: string;
  citations: Citation[];
  messageId?: string;
  streaming: boolean;
}) {
  const shown = useThrottled(text, streaming ? 50 : 0);
  const cites = useMemo<Cites>(
    () => ({
      byNumber: new Map(citations.map((c) => [c.n, c])),
      shown: numberCitations(shown, citations).numbers,
      messageId,
    }),
    [shown, citations, messageId],
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
  const code = textOf(children).replace(/\n$/, '');
  const className = isValidElement<{ className?: string }>(children)
    ? children.props.className
    : '';
  const language = /language-([\w+#-]+)/.exec(className ?? '')?.[1];
  const { copy, label, announced } = useCopy(code);
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
      <pre className="mb-0 rounded-t-none">{children}</pre>
    </figure>
  );
}

const components: Components = {
  a: Marker,
  pre: CodeBlock,
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
