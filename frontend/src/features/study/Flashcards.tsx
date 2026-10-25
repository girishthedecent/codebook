import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Citation } from '@/api/types';
import { Button, Kbd } from '@/ui';
import { cn } from '@/lib/cn';
import { useBreakpoint } from '@/lib/breakpoints';
import { useShortcut } from '@/lib/keyboard';
import { Cites } from './Cites';
import { citationsOf, type FlashcardsData } from './data';
import { idCsv, idSet, type StudySearch } from './search';
import { s } from './strings';

const SWIPE_PX = 60;

type Props = {
  deck: FlashcardsData;
  index: Map<number, Citation>;
  search: StudySearch;
  setSearch: (patch: Partial<StudySearch>) => void;
};

/**
 * A card at a time: tap or Space flips it, arrows or a swipe move between cards, and "Know it" /
 * "Again" sort it into a pile and move on. Piles and position are URL state (see search.ts).
 */
export function Flashcards({ deck, index, search, setSearch }: Props) {
  const keyboard = useBreakpoint() !== 'phone';
  const [flipped, setFlipped] = useState(false);
  const know = idSet(search.know);
  const again = idSet(search.again);

  const cards = search.pile === 'again' ? deck.cards.filter((c) => again.has(c.id)) : deck.cards;
  const total = cards.length;
  // card = total + 1 is the end screen.
  const at = Math.min(Math.max((search.card ?? 1) - 1, 0), total);
  const card = cards[at];

  const go = (to: number) => {
    setFlipped(false);
    setSearch({ card: Math.min(Math.max(to, 0), total) + 1 });
  };
  const sort = (pile: 'know' | 'again') => {
    if (!card) return;
    const k = new Set(know);
    const a = new Set(again);
    (pile === 'know' ? a : k).delete(card.id);
    (pile === 'know' ? k : a).add(card.id);
    setFlipped(false);
    setSearch({ know: idCsv(k), again: idCsv(a), card: at + 2 });
  };

  // Space flips only when nothing else has focus (or the card does), so a focused button
  // still answers to Space the normal way.
  const cardRef = useRef<HTMLDivElement>(null);
  const hasCard = Boolean(card);
  useEffect(() => {
    if (!hasCard) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key !== ' ' || (el && el !== document.body && el !== cardRef.current)) return;
      e.preventDefault();
      setFlipped((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasCard]);
  useShortcut('arrowright', () => go(at + 1), { enabled: Boolean(card) });
  useShortcut('arrowleft', () => go(at - 1), { enabled: at > 0 });

  // Tap flips; a horizontal drag past the threshold moves instead.
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dragX, setDragX] = useState(0);
  const onPointerDown = (e: PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!start.current || e.pointerType === 'mouse') return;
    const dx = e.clientX - start.current.x;
    if (Math.abs(dx) > Math.abs(e.clientY - start.current.y)) setDragX(dx);
  };
  const onPointerUp = (e: PointerEvent) => {
    const from = start.current;
    start.current = null;
    setDragX(0);
    if (!from) return;
    const dx = e.clientX - from.x;
    if (Math.abs(dx) > SWIPE_PX && e.pointerType !== 'mouse') go(dx < 0 ? at + 1 : at - 1);
    else if (Math.abs(dx) < 8 && Math.abs(e.clientY - from.y) < 8) setFlipped((f) => !f);
  };

  if (deck.cards.length === 0) return null;

  if (!card) {
    const againCount = deck.cards.filter((c) => again.has(c.id)).length;
    return (
      <div className="max-w-[560px]">
        {search.pile === 'again' && (
          <p className="mb-2 text-xs text-ink-3">{s.cards.showingAgain}</p>
        )}
        <p className="font-serif text-lg">
          {s.cards.done(deck.cards.filter((c) => know.has(c.id)).length, deck.cards.length)}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {againCount > 0 && (
            <Button variant="primary" onClick={() => setSearch({ pile: 'again', card: 1 })}>
              {s.cards.reviewAgain(againCount)}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() =>
              setSearch({ pile: undefined, card: 1, know: undefined, again: undefined })
            }
          >
            {s.cards.restart}
          </Button>
        </div>
      </div>
    );
  }

  const cites = citationsOf(card, index);
  return (
    <div className="max-w-[560px]">
      <div className="flex items-baseline justify-between font-mono text-xs text-ink-3">
        <span>
          {at + 1} / {total}
        </span>
        <span>
          {s.cards.know.toLowerCase()} {know.size} · {s.cards.again.toLowerCase()} {again.size}
        </span>
      </div>
      {search.pile === 'again' && (
        <p className="mt-1 text-xs text-ink-3">
          {s.cards.showingAgain}{' '}
          <button
            type="button"
            className="text-accent underline underline-offset-2"
            onClick={() => setSearch({ pile: undefined, card: 1 })}
          >
            {s.cards.showAll}
          </button>
        </p>
      )}

      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        aria-label={s.cards.flip}
        aria-pressed={flipped}
        onKeyDown={(e) => {
          // Space is handled by the window listener above.
          if (e.key === 'Enter') setFlipped((f) => !f);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDragX(0);
        }}
        style={dragX ? { transform: `translateX(${dragX * 0.6}px)` } : undefined}
        className="relative mt-3 grid min-h-56 cursor-pointer touch-pan-y select-none rounded-md border border-rule-2 bg-paper-2/50 transition-[border-color] duration-150 hover:border-ink-3"
      >
        <Face label={s.cards.front} visible={!flipped} text={card.front} />
        <Face label={s.cards.back} visible={flipped} text={card.back} />
      </div>
      <p className="mt-2 min-h-5 text-xs text-ink-3">
        {flipped && cites.length > 0 && <Cites citations={cites} />}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={at === 0} onClick={() => go(at - 1)}>
            ← {s.cards.prev}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => go(at + 1)}>
            {s.cards.next} →
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => sort('again')}
            aria-pressed={again.has(card.id)}
          >
            {s.cards.again}
          </Button>
          <Button variant="primary" onClick={() => sort('know')} aria-pressed={know.has(card.id)}>
            {s.cards.know}
          </Button>
        </div>
      </div>
      {keyboard && (
        <p className="mt-4 text-xs text-ink-3">
          <Kbd>Space</Kbd> flip · <Kbd>←</Kbd> <Kbd>→</Kbd> move
        </p>
      )}
    </div>
  );
}

/** Both faces share one grid cell and crossfade, so the card keeps the taller side's height. */
function Face({ label, visible, text }: { label: string; visible: boolean; text: string }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'col-start-1 row-start-1 flex flex-col p-5 transition-opacity duration-150 ease-out',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <span className="font-mono text-xs text-ink-3">{label}</span>
      <p className="mt-3 font-serif text-lg leading-snug whitespace-pre-line">{text}</p>
    </div>
  );
}
