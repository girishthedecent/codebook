import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation } from '@/api/types';
import { Cite } from '@/features/citations/Cite';
import { citeNumber, linkCitations } from './markers';

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
  return <AnswerMarkdown text={shown} citations={citations} messageId={messageId} />;
}

const AnswerMarkdown = memo(function AnswerMarkdown({
  text,
  citations,
  messageId,
}: {
  text: string;
  citations: Citation[];
  messageId?: string;
}) {
  const source = useMemo(() => linkCitations(text), [text]);
  const components = useMemo(
    () => markdownComponents(citations, messageId),
    [citations, messageId],
  );
  return (
    <div className="prose max-w-[66ch] break-words text-ink">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </Markdown>
    </div>
  );
});

function markdownComponents(citations: Citation[], messageId?: string): Components {
  const byNumber = new Map(citations.map((c) => [c.n, c]));
  return {
    a({ href, children }) {
      const n = citeNumber(href);
      if (n !== undefined) {
        const citation = byNumber.get(n);
        // Citations arrive after the text; until then the number is a quiet placeholder.
        return citation ? (
          <Cite citation={citation} messageId={messageId} />
        ) : (
          <sup className="mx-px font-sans text-[0.68em] font-medium text-ink-3">{n}</sup>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
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
}

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
