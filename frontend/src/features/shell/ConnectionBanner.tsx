import { retryFailed, useUnreachable } from './connection';

/** One quiet line when the browser is offline or the server can't be reached. Not a modal. */
export function ConnectionBanner() {
  const { offline, down } = useUnreachable();
  if (!offline && !down) return null;
  return (
    <div
      role="status"
      className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 border-b border-rule bg-paper-3 px-4 py-1.5 text-xs text-ink-2 pl-[max(1rem,env(safe-area-inset-left))]"
    >
      <span>
        {offline
          ? "You're offline. Changes can't be saved until you're back."
          : "Can't reach the server. Pages may be out of date."}
      </span>
      <button
        type="button"
        onClick={retryFailed}
        className="shrink-0 py-1 text-accent underline underline-offset-2 max-[719px]:min-h-9"
      >
        Try again
      </button>
    </div>
  );
}
