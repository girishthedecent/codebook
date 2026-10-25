import { useEffect, useState, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';

/**
 * A small toaster. `toast()` works from anywhere (no hook needed); `<Toaster />` mounts once.
 * Bottom-left, at most three at a time, gone after 5 s unless hovered. Only for results of
 * background work — anything the user just did gets an inline confirmation instead.
 */

export type ToastKind = 'info' | 'ok' | 'error';

export type ToastInput = {
  title: ReactNode;
  description?: ReactNode;
  kind?: ToastKind;
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
};

type ToastItem = ToastInput & { id: number };

const MAX = 3;
const DEFAULT_MS = 5000;

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function publish() {
  for (const l of listeners) l(items);
}

export function toast(input: ToastInput): number {
  const id = nextId++;
  items = [...items, { ...input, id }].slice(-MAX);
  publish();
  return id;
}

toast.dismiss = (id: number) => {
  items = items.filter((t) => t.id !== id);
  publish();
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 left-4 z-[60] max-[719px]:bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {list.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}

const mark: Record<ToastKind, string> = {
  info: 'bg-ink-3',
  ok: 'bg-ok',
  error: 'bg-error',
};

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const duration = item.duration ?? DEFAULT_MS;

  useEffect(() => {
    if (!duration || paused) return;
    const t = setTimeout(() => toast.dismiss(item.id), duration);
    return () => clearTimeout(t);
  }, [duration, paused, item.id]);

  return (
    <div
      role={item.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto flex gap-3 rounded-md border border-rule bg-paper px-3 py-2.5 text-sm shadow-float animate-[fade-in_150ms_ease-out]"
    >
      <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', mark[item.kind ?? 'info'])} />
      <div className="min-w-0 flex-1">
        <div className="text-ink">{item.title}</div>
        {item.description && <div className="mt-0.5 text-xs text-ink-2">{item.description}</div>}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              toast.dismiss(item.id);
            }}
            className="mt-1.5 text-xs font-medium text-accent underline underline-offset-2"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => toast.dismiss(item.id)}
        className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-xs text-ink-3 hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  );
}
