import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { X } from '@phosphor-icons/react';
import { Button, Kbd, Switch } from '@/ui';
import { clearAskAbout, quoteFor, useAskAbout, type AskAbout } from '@/lib/askAbout';
import { useBreakpoint } from '@/lib/breakpoints';
import { useShortcut } from '@/lib/keyboard';
import { cn } from '@/lib/cn';
import { clearDraft, useDraft } from './drafts';
import { chat } from './strings';
import { useKeyboardInset } from './useKeyboardInset';

/** The most the server accepts in one question. */
export const MAX_QUESTION_CHARS = 4000;
// The counter appears once a question is this long, so it never nags a short one.
const COUNTER_FROM = 3500;

export type ComposerProps = {
  /** Draft key: a conversation id, or `new:<workspaceId>` on the workspace home. */
  draftScope: string;
  streaming: boolean;
  isGuest: boolean;
  /** Whether the workspace has anything to read; with nothing, the memory switch has no use. */
  hasSources: boolean;
  placeholder?: string;
  /** Put the cursor in the box when the page opens (not on phones: it would raise the keyboard). */
  focusOnMount?: boolean;
  onSend: (text: string, useMemory: boolean) => void;
  onStop: () => void;
};

const MEMORY_KEY = 'codebook.useMemory';

function readMemoryPref() {
  try {
    return localStorage.getItem(MEMORY_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * The question box. Enter asks, Shift+Enter is a new line (on phones Enter is a new line and the
 * button asks), Esc stops an answer in progress. On desktop it sticks to the bottom of the
 * column; on phones it sits above the tabs and rides up with the on-screen keyboard.
 *
 * A passage sent from elsewhere (the viewer, a flashcard, the graph) is quoted at the top of
 * the draft with a line saying where it is from, until the question is sent or the line is
 * dismissed.
 */
export function Composer({
  draftScope,
  streaming,
  isGuest,
  hasSources,
  placeholder = chat.placeholder,
  focusOnMount,
  onSend,
  onStop,
}: ComposerProps) {
  const bp = useBreakpoint();
  const phone = bp === 'phone';
  const [text, setText] = useDraft(draftScope);
  const [useMemory, setUseMemory] = useState(readMemoryPref);
  const box = useRef<HTMLTextAreaElement>(null);
  const length = text.trim().length;
  const over = Math.max(0, length - MAX_QUESTION_CHARS);
  const about = useAskAbout();
  const [placed, setPlaced] = useState<AskAbout | null>(null);

  // A new passage replaces the quote of the one before, if the reader left it untouched.
  if (about && about !== placed) {
    const quote = quoteFor(about);
    const before = placed ? quoteFor(placed) : undefined;
    setPlaced(about);
    setText((t) => {
      if (t.startsWith(quote)) return t;
      return quote + (before && t.startsWith(before) ? t.slice(before.length) : t);
    });
  }

  useEffect(() => {
    if (!placed) return;
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.scrollTop = el.scrollHeight;
  }, [placed]);

  useShortcut('/', () => box.current?.focus());

  useEffect(() => {
    if (focusOnMount && !phone) box.current?.focus();
    // Only on the first render: later breakpoint changes shouldn't steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grow with the text up to a third of the screen, then scroll inside.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.33))}px`;
  }, [text]);

  // The Stop button turns into Ask, so keyboard focus would be lost; put it in the box.
  const stop = () => {
    onStop();
    if (!phone) box.current?.focus();
  };

  const toggleMemory = (on: boolean) => {
    setUseMemory(on);
    try {
      localStorage.setItem(MEMORY_KEY, on ? '1' : '0');
    } catch {
      // Storage can be blocked; the choice just won't be remembered.
    }
  };

  const dismissAbout = () => {
    if (placed) {
      const quote = quoteFor(placed);
      setText((t) => (t.startsWith(quote) ? t.slice(quote.length) : t));
    }
    setPlaced(null);
    clearAskAbout();
    box.current?.focus();
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const question = text.trim();
    if (!question || streaming || over > 0) return;
    // Guests never use memory, which is also what lets the demo serve cached answers.
    onSend(question, isGuest ? false : useMemory);
    setText('');
    clearDraft(draftScope);
    setPlaced(null);
    clearAskAbout();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && streaming) {
      e.preventDefault();
      stop();
      return;
    }
    // keyCode 229 is Safari's Enter that confirms an IME candidate, sent after composition ended.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229 || phone)
      return;
    e.preventDefault();
    submit();
  };

  return (
    <ComposerDock>
      <form onSubmit={submit} className="mx-auto w-full max-w-[720px]">
        <div className="rounded-md border border-edge bg-paper transition-colors duration-150 focus-within:border-accent">
          {about && (
            <div className="flex items-center gap-2 border-b border-rule py-0.5 pr-1 pl-3.5 text-xs text-ink-3">
              <p className="min-w-0 flex-1 truncate">
                {chat.about}{' '}
                <span className="font-serif text-sm text-ink-2 italic">{about.label}</span>
              </p>
              <button
                type="button"
                onClick={dismissAbout}
                aria-label={chat.dismissAbout}
                title={chat.dismissAbout}
                className="flex size-7 shrink-0 items-center justify-center rounded-xs hover:bg-paper-2 hover:text-ink max-sm:size-11"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          )}
          <label htmlFor={`composer-${draftScope}`} className="sr-only">
            {placeholder}
          </label>
          <textarea
            id={`composer-${draftScope}`}
            ref={box}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            enterKeyHint={phone ? 'enter' : 'send'}
            aria-invalid={over > 0 || undefined}
            aria-describedby={length >= COUNTER_FROM ? `composer-count-${draftScope}` : undefined}
            className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 font-serif text-base leading-normal text-ink placeholder:text-ink-3 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3 px-2 pb-2 pl-3.5">
            {isGuest ? (
              <span className="text-xs text-ink-3">{chat.guestNote}</span>
            ) : hasSources ? (
              <Switch
                checked={useMemory}
                onCheckedChange={toggleMemory}
                label={<span className="text-xs text-ink-2">{chat.useMemory}</span>}
                description={phone ? undefined : chat.useMemoryHint}
                className="gap-2.5 [&>label]:order-2"
              />
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {length >= COUNTER_FROM && (
                <span
                  id={`composer-count-${draftScope}`}
                  className={cn('text-xs tabular-nums', over > 0 ? 'text-error' : 'text-ink-3')}
                >
                  {over > 0 ? chat.tooLong(over) : chat.counter(length, MAX_QUESTION_CHARS)}
                </span>
              )}
              {streaming ? (
                <Button size="sm" variant="secondary" onClick={stop}>
                  {chat.stop}
                  {!phone && <Kbd>Esc</Kbd>}
                </Button>
              ) : (
                <Button type="submit" size="sm" variant="primary" disabled={!length || over > 0}>
                  {chat.send}
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </ComposerDock>
  );
}

/**
 * Where the question box lives: stuck to the bottom of the column on a wide screen, and fixed
 * above the bottom tabs on a phone (or right above the keyboard when it is up) with a spacer in
 * the page so the last answer can scroll clear of it. The limit notice takes the same place.
 */
export function ComposerDock({ children }: { children: ReactNode }) {
  const phone = useBreakpoint() === 'phone';
  return phone ? (
    <PhoneDock>{children}</PhoneDock>
  ) : (
    <div className="sticky bottom-0 z-10 bg-paper px-4 pt-2 pb-4 [box-shadow:0_-1px_0_var(--rule)] sm:px-6">
      {children}
    </div>
  );
}

function PhoneDock({ children }: { children: ReactNode }) {
  const inset = useKeyboardInset();
  const dock = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = dock.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div style={{ height }} aria-hidden />
      <div
        ref={dock}
        className="fixed inset-x-0 z-30 border-t border-rule bg-paper px-3 pt-2 pb-2"
        style={{
          bottom: inset > 0 ? inset : 'calc(3.5rem + env(safe-area-inset-bottom))',
        }}
      >
        {children}
      </div>
    </>
  );
}
