import { useEffect, useMemo, useRef } from 'react';
import { findSnippet } from './findSnippet';

/**
 * Plain page text as paragraphs, with the cited passage marked and scrolled into view.
 * Paragraphs are split on blank lines; single newlines inside one are kept as spaces.
 */
export function Highlighted({
  text,
  snippet,
  className,
}: {
  text: string;
  snippet?: string;
  className?: string;
}) {
  const markRef = useRef<HTMLElement>(null);
  const range = useMemo(() => findSnippet(text, snippet), [text, snippet]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center' });
  }, [range]);

  const paragraphs = useMemo(() => {
    const out: Array<{ start: number; text: string }> = [];
    const re = /\n\s*\n/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push({ start: last, text: text.slice(last, m.index) });
      last = m.index + m[0].length;
    }
    out.push({ start: last, text: text.slice(last) });
    return out.filter((p) => p.text.trim());
  }, [text]);

  let marked = false;
  return (
    <div className={className}>
      {paragraphs.map((p) => {
        const end = p.start + p.text.length;
        if (!range || range.end <= p.start || range.start >= end) {
          return <p key={p.start}>{p.text}</p>;
        }
        const a = Math.max(0, range.start - p.start);
        const b = Math.min(p.text.length, range.end - p.start);
        const first = !marked;
        marked = true;
        return (
          <p key={p.start}>
            {p.text.slice(0, a)}
            <mark
              ref={first ? markRef : undefined}
              className="rounded-xs bg-highlight text-inherit"
            >
              {p.text.slice(a, b)}
            </mark>
            {p.text.slice(b)}
          </p>
        );
      })}
    </div>
  );
}
