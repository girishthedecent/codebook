import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { useRouter } from '@tanstack/react-router';
import { ChatCircleText, Copy, HighlighterCircle, LinkSimple } from '@phosphor-icons/react';
import { isApiError } from '@/api/client';
import { HIGHLIGHT_TEXT_MAX, useCreateHighlight } from '@/api/queries/highlights';
import type { SourceType } from '@/api/types';
import { askAbout } from '@/lib/askAbout';
import { cn } from '@/lib/cn';
import { viewerSearchFor, type ViewerTarget } from '@/lib/viewerParams';
import { Tooltip } from '@/ui';
import { describeSelection, type Picked } from './selection';
import { s } from './strings';

const t = s.selection;

type Spot = { x: number; y: number; below: boolean };

export type SelectionToolbarProps = {
  /** The viewer's frame: selections inside it count, and the bar is placed within it. */
  frame: HTMLElement | null;
  target: ViewerTarget;
  source: { title: string; type?: SourceType };
  workspaceId?: string;
  /** Why the reader can't keep highlights here, if they can't. */
  highlightBlocked?: string;
  /** After "Ask about this": the viewer decides whether to make room for the message box. */
  onAsked: () => void;
};

/**
 * A small bar over selected text in the viewer: ask about it, keep it as a highlight, copy it,
 * or copy a link to where it is. It follows the selection and goes when the selection does.
 */
export function SelectionToolbar({
  frame,
  target,
  source,
  workspaceId,
  highlightBlocked,
  onAsked,
}: SelectionToolbarProps) {
  const router = useRouter();
  const bar = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<{ value: Picked; range: Range; spot: Spot }>();
  const [status, setStatus] = useState<{ text: string; tone: 'ok' | 'error' }>();
  const [saved, setSaved] = useState(false);
  const create = useCreateHighlight(workspaceId ?? '');

  // The latest props for the listeners below, which are bound once per frame.
  const latest = useRef({ target, source });
  useEffect(() => {
    latest.current = { target, source };
  });

  useEffect(() => {
    if (!frame) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pressing = false;

    const read = () => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setPicked(undefined);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!frame.contains(range.commonAncestorContainer)) {
        setPicked(undefined);
        return;
      }
      const value = describeSelection(range, latest.current.target, latest.current.source);
      const spot = value && spotFor(range, frame);
      if (!value || !spot) {
        setPicked(undefined);
        return;
      }
      setPicked({ value, range, spot });
      setStatus(undefined);
      setSaved(false);
    };

    // A drag reports every step; the bar waits for the button to come up. Touch handles and
    // keyboard selection have no button, so they wait for a short pause instead.
    const onSelection = () => {
      clearTimeout(timer);
      if (!pressing) timer = setTimeout(read, 200);
    };
    const onDown = (event: PointerEvent) => {
      if (bar.current?.contains(event.target as Node)) return;
      pressing = true;
    };
    const onUp = () => {
      if (!pressing) return;
      pressing = false;
      clearTimeout(timer);
      timer = setTimeout(read, 0);
    };
    const onScroll = () => {
      setPicked((prev) => {
        if (!prev) return prev;
        const spot = spotFor(prev.range, frame);
        return spot ? { ...prev, spot } : undefined;
      });
    };

    document.addEventListener('selectionchange', onSelection);
    frame.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    frame.addEventListener('scroll', onScroll, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelection);
      frame.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
      frame.removeEventListener('scroll', onScroll, true);
    };
  }, [frame]);

  // Kept inside the frame: centred on the selection where there is room, against an edge
  // where there isn't.
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || !frame || !picked) return;
    const half = el.offsetWidth / 2;
    const room = frame.clientWidth;
    const x = Math.min(Math.max(picked.spot.x, half + 8), Math.max(half + 8, room - half - 8));
    el.style.left = `${x}px`;
  }, [picked, frame]);

  if (!picked) return null;
  const { value, spot } = picked;
  const tooLong = value.highlight.text.length > HIGHLIGHT_TEXT_MAX;

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus({ text: done, tone: 'ok' });
    } catch {
      setStatus({ text: t.copyFailed, tone: 'error' });
    }
  };

  const link = () => {
    const { href } = router.buildLocation({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, ...viewerSearchFor(value.target) }),
    });
    return new URL(href, window.location.origin).href;
  };

  const highlight = () => {
    if (highlightBlocked || !workspaceId) {
      setStatus({ text: highlightBlocked ?? t.guest, tone: 'error' });
      return;
    }
    if (tooLong) {
      setStatus({ text: t.tooLong(HIGHLIGHT_TEXT_MAX), tone: 'error' });
      return;
    }
    create.mutate(value.highlight, {
      onSuccess: () => {
        setSaved(true);
        setStatus({ text: t.highlighted, tone: 'ok' });
      },
      onError: (error) =>
        setStatus({
          text: isApiError(error, 409) || isApiError(error, 403) ? error.message : t.failed,
          tone: 'error',
        }),
    });
  };

  const ask = () => {
    askAbout({ quote: value.text, label: value.caption, target: value.target });
    document.getSelection()?.removeAllRanges();
    setPicked(undefined);
    onAsked();
  };

  const blocked = Boolean(highlightBlocked || tooLong);

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={t.label}
      data-vaul-no-drag
      // `left` is set before paint by the effect above, which keeps the bar inside the frame.
      style={{ top: spot.y }}
      className={cn(
        'absolute z-20 -translate-x-1/2 rounded-md border border-rule bg-paper p-1 shadow-float',
        'motion-safe:animate-[fade-in_120ms_ease-out]',
        spot.below ? 'translate-y-2' : '-translate-y-[calc(100%+0.5rem)]',
      )}
      // Pressing a button must not clear the selection it acts on.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-0.5">
        <BarButton onClick={ask} icon={<ChatCircleText size={16} aria-hidden />}>
          {t.ask}
        </BarButton>
        <Tooltip
          content={highlightBlocked ?? (tooLong ? t.tooLong(HIGHLIGHT_TEXT_MAX) : t.highlight)}
        >
          <BarButton
            onClick={highlight}
            dimmed={blocked}
            pressed={saved}
            busy={create.isPending}
            icon={<HighlighterCircle size={16} aria-hidden />}
          >
            {saved ? t.highlighted : t.highlight}
          </BarButton>
        </Tooltip>
        <Tooltip content={t.copy}>
          <BarButton
            label={t.copy}
            onClick={() => void copy(value.text, t.copied)}
            icon={<Copy size={16} aria-hidden />}
          />
        </Tooltip>
        <Tooltip content={t.link}>
          <BarButton
            label={t.link}
            onClick={() => void copy(link(), t.linkCopied)}
            icon={<LinkSimple size={16} aria-hidden />}
          />
        </Tooltip>
      </div>
      <p
        role="status"
        className={cn(
          'max-w-72 px-2 text-xs',
          status ? 'pt-1 pb-1' : 'sr-only',
          status?.tone === 'error' ? 'text-error' : 'text-ink-3',
        )}
      >
        {status?.text}
      </p>
    </div>
  );
}

// Tooltips put their handlers and ref on the button, so it passes them through.
function BarButton({
  onClick,
  icon,
  label,
  dimmed,
  pressed,
  busy,
  children,
  ref,
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  onClick: () => void;
  icon: ReactNode;
  /** For a button that shows only its icon. */
  label?: string;
  dimmed?: boolean;
  pressed?: boolean;
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-label={label}
      aria-disabled={dimmed || undefined}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap text-ink-2',
        'transition-colors duration-150 hover:bg-paper-2 hover:text-ink max-sm:h-11 max-sm:min-w-11',
        dimmed && 'opacity-50',
        pressed && 'text-ink',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Where the bar goes, in the frame's coordinates: above the start of the selection, or below
 * its end on touch screens (the system's own menu sits above) and when there's no room above.
 * Nothing when the selection has scrolled out of sight.
 */
function spotFor(range: Range, frame: HTMLElement): Spot | undefined {
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return undefined;
  const box = frame.getBoundingClientRect();
  const first = rects[0]!;
  const last = rects[rects.length - 1]!;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const below = coarse || first.top - box.top < 64;
  const anchor = below ? last : first;
  const y = (below ? anchor.bottom : anchor.top) - box.top;
  if (y < 0 || y > box.height) return undefined;
  return { x: anchor.left + anchor.width / 2 - box.left, y, below };
}
