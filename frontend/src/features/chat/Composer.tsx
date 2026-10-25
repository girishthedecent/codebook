import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button, Switch } from '@/ui';
import { useBreakpoint } from '@/lib/breakpoints';
import { useShortcut } from '@/lib/keyboard';
import { cn } from '@/lib/cn';
import { clearDraft, useDraft } from './drafts';
import { chat } from './strings';
import { useKeyboardInset } from './useKeyboardInset';

export type ComposerProps = {
  /** Draft key: a conversation id, or `new:<workspaceId>` on the workspace home. */
  draftScope: string;
  streaming: boolean;
  isGuest: boolean;
  /** Epoch ms until which asking is blocked (429), if any. */
  blockedUntil?: number;
  placeholder?: string;
  /** Put the cursor in the box when the page opens (not on phones: it would raise the keyboard). */
  focusOnMount?: boolean;
  /** Text to put back into the box, e.g. a question that was rate limited. */
  restore?: { text: string; at: number };
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
 * button asks). On desktop it sticks to the bottom of the column; on phones it sits above the
 * tabs and rides up with the on-screen keyboard.
 */
export function Composer({
  draftScope,
  streaming,
  isGuest,
  blockedUntil,
  placeholder = chat.placeholder,
  focusOnMount,
  restore,
  onSend,
  onStop,
}: ComposerProps) {
  const bp = useBreakpoint();
  const phone = bp === 'phone';
  const [text, setText] = useDraft(draftScope);
  const [useMemory, setUseMemory] = useState(readMemoryPref);
  const box = useRef<HTMLTextAreaElement>(null);
  const waitSec = useCountdown(blockedUntil);
  const blocked = waitSec > 0;

  useShortcut('/', () => box.current?.focus());

  useEffect(() => {
    if (focusOnMount && !phone) box.current?.focus();
    // Only on the first render: later breakpoint changes shouldn't steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A rate-limited question comes back into the box. Keyed by time so the same text can return twice.
  const [restored, setRestored] = useState<number>();
  if (restore && restore.at !== restored) {
    setRestored(restore.at);
    setText(restore.text);
  }

  // Grow with the text up to a third of the screen, then scroll inside.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.33))}px`;
  }, [text]);

  const toggleMemory = (on: boolean) => {
    setUseMemory(on);
    try {
      localStorage.setItem(MEMORY_KEY, on ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const question = text.trim();
    if (!question || streaming || blocked) return;
    // Guests never use memory, which is also what lets the demo serve cached answers.
    onSend(question, isGuest ? false : useMemory);
    setText('');
    clearDraft(draftScope);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || phone) return;
    e.preventDefault();
    submit();
  };

  const form = (
    <form onSubmit={submit} className="mx-auto w-full max-w-[720px]">
      <div className="rounded-md border border-rule-2 bg-paper transition-colors duration-150 focus-within:border-accent">
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
          className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 font-serif text-base leading-normal text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-2 pl-3.5">
          {isGuest ? (
            <span className="text-xs text-ink-3">{chat.guestNote}</span>
          ) : (
            <Switch
              checked={useMemory}
              onCheckedChange={toggleMemory}
              label={<span className="text-xs text-ink-2">{chat.useMemory}</span>}
              className="min-h-8 gap-2.5 [&>label]:order-2"
            />
          )}
          {streaming ? (
            <Button size="sm" variant="secondary" onClick={onStop}>
              {chat.stop}
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!text.trim() || blocked}
              className={cn(phone && 'h-9 px-4')}
            >
              {chat.send}
            </Button>
          )}
        </div>
      </div>
      {blocked && (
        <p className="mt-2 text-xs text-warn" role="status">
          {isGuest && waitSec > 600 ? chat.guestLimit : chat.waitFor(waitSec)}
        </p>
      )}
    </form>
  );

  if (phone) return <PhoneDock>{form}</PhoneDock>;

  return (
    <div className="sticky bottom-0 z-10 bg-paper px-4 pt-2 pb-4 [box-shadow:0_-1px_0_var(--rule)] md:px-6">
      {form}
    </div>
  );
}

/**
 * Phones: the box is fixed above the bottom tabs, or right above the keyboard when it is up,
 * with a spacer in the page so the last answer can scroll clear of it.
 */
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

/** Whole seconds left until `until`, ticking once a second; 0 when not blocked. */
function useCountdown(until: number | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(() => {
      tick();
      if (Date.now() >= until) clearInterval(t);
    }, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [until]);

  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
