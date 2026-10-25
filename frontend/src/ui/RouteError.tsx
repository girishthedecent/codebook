import { useEffect } from 'react';
import { Link, useLocation, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { signInHref } from '@/auth/guards';

const button =
  'inline-flex h-10 items-center rounded-sm border border-rule-2 px-3.5 text-sm hover:bg-paper-2';

/** What went wrong in words a person can act on; the server's own message when it has one. */
function describe(error: unknown) {
  if (!isApiError(error)) return { title: 'Something went wrong.', hint: '' };
  const { status, message, retryAfterSec } = error;
  if (status === 0) {
    return { title: "Can't reach the server.", hint: 'Check your connection and try again.' };
  }
  if (status === 401) return { title: 'Your session ended.', hint: 'Sign in to continue.' };
  if (status === 403) {
    return { title: message, hint: "Your account doesn't have access to this." };
  }
  if (status === 404) return { title: message, hint: 'It may have been removed.' };
  if (status === 429) {
    const wait = retryAfterSec ? ` Try again in ${retryAfterSec} seconds.` : ' Try again shortly.';
    return { title: 'Too many requests.', hint: `Slow down a little.${wait}` };
  }
  return { title: message, hint: '' };
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const api = isApiError(error) ? error : undefined;
  const router = useRouter();
  const href = useLocation({ select: (l) => l.href });
  const { title, hint } = describe(error);
  // Move focus to the message so the failure is announced and keyboard users land on "Try again".
  useEffect(() => {
    document.getElementById('route-error')?.focus();
  }, []);
  // An error that isn't the server's answer is a bug in the page; leave its trace in the console.
  useEffect(() => {
    if (!isApiError(error)) console.error(error);
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-16 min-[720px]:py-24">
      <p className="font-mono text-xs text-ink-3">{api ? api.code : 'Error'}</p>
      <h1
        id="route-error"
        tabIndex={-1}
        className="mt-2 text-lg font-semibold outline-none [overflow-wrap:anywhere]"
      >
        {title}
      </h1>
      {hint && <p className="mt-2 text-ink-2">{hint}</p>}
      {api?.correlationId && (
        <p className="mt-3 font-mono text-xs text-ink-3 [overflow-wrap:anywhere]">
          reference {api.correlationId}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {api?.status === 401 ? (
          <a href={signInHref(href)} className={button}>
            Sign in
          </a>
        ) : (
          <button
            type="button"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
            className={button}
          >
            Try again
          </button>
        )}
        <Link to="/w" className="text-sm text-accent underline underline-offset-2">
          Go to your workspace
        </Link>
      </div>
    </div>
  );
}
