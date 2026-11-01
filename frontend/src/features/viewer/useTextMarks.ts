import { useEffect, useEffectEvent, useRef } from 'react';
import { findAll, findPassage } from './findSnippet';
import { indexText, paint, unpaint } from './textIndex';
import { useViewerContext } from './viewerContext';

const SEP = '\u0000';

/**
 * Tints the reader's highlights and the find bar's hits in the text under `root`, and keeps
 * the current hit in view. `version` changes whenever that text is redrawn (a new page, a
 * page that finished loading), which is when the marks are worked out again.
 */
export function useTextMarks(root: Element | null, version: unknown, passages: string[]) {
  const { find, setFindCount } = useViewerContext();
  const query = find?.query ?? '';
  const index = find?.index ?? 0;
  const hits = useRef<Range[]>([]);
  // A stable key, so a new array with the same passages doesn't redo the work.
  const passageKey = passages.join(SEP);

  useEffect(() => {
    if (!root) return;
    const text = indexText(root);
    const ranges = passageKey
      .split(SEP)
      .filter(Boolean)
      .map((passage) => findPassage(text.text, passage))
      .map((found) => found && text.toRange(found))
      .filter((range): range is Range => Boolean(range));
    paint('cb-mark', ranges);
  }, [root, version, passageKey]);

  const showCurrent = useEffectEvent(() => {
    const list = hits.current;
    const current = list.length ? list[index % list.length] : undefined;
    paint('cb-find-now', current ? [current] : []);
    current?.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
  });

  useEffect(() => {
    if (!root) return;
    const text = query ? indexText(root) : undefined;
    const found = text
      ? findAll(text.text, query)
          .map((hit) => text.toRange(hit))
          .filter((range): range is Range => Boolean(range))
      : [];
    hits.current = found;
    paint('cb-find', found);
    setFindCount(found.length);
    showCurrent();
  }, [root, version, query, setFindCount]);

  useEffect(() => {
    showCurrent();
  }, [index]);

  useEffect(() => () => unpaint('cb-mark', 'cb-find', 'cb-find-now'), []);
}
