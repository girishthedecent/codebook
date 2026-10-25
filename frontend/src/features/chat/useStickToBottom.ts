import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const SLACK = 96;

function nearBottom() {
  const doc = document.documentElement;
  return window.innerHeight + window.scrollY >= doc.scrollHeight - SLACK;
}

function toBottom(smooth = false) {
  window.scrollTo({
    top: document.documentElement.scrollHeight,
    behavior: smooth && !reducedMotion() ? 'smooth' : 'auto',
  });
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Keeps the page at the newest text while an answer streams, until the reader scrolls up;
 * then it leaves them where they are and offers a way back. The page scrolls, not an inner
 * box, so phones keep their native scrolling and address-bar behavior.
 */
export function useStickToBottom({
  streaming,
  content,
  ready,
}: {
  streaming: boolean;
  /** Changes whenever new content renders. */
  content: string;
  /** True once the history has loaded, to open at the latest message. */
  ready: boolean;
}) {
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const opened = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      const near = nearBottom();
      pinned.current = near;
      setAtBottom(near);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    if (ready && !opened.current) {
      opened.current = true;
      toBottom();
      return;
    }
    if (streaming && pinned.current) toBottom();
  }, [content, streaming, ready]);

  // A new question pins again: the reader just asked, they want to see the answer.
  useEffect(() => {
    if (streaming) {
      pinned.current = true;
      toBottom();
    }
  }, [streaming]);

  const jump = useCallback(() => {
    pinned.current = true;
    toBottom(true);
  }, []);

  return { atBottom, jump };
}
