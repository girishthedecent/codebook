import { useEffect } from 'react';
import { useLocation, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { isApiError } from '@/api/client';
import { signInHref } from '@/auth/guards';
import { Button } from './Button';
import { ErrorPage } from './ErrorPage';
import { TextLink } from './TextLink';

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
  // An error that isn't the server's answer is a bug in the page; leave its trace in the console.
  useEffect(() => {
    if (!isApiError(error)) console.error(error);
  }, [error]);
  return (
    <ErrorPage
      focusTitle
      kicker={api ? api.code : 'Error'}
      title={title}
      hint={hint}
      detail={api?.correlationId && `reference ${api.correlationId}`}
      actions={
        <>
          {api?.status === 401 ? (
            <Button asChild>
              <a href={signInHref(href)}>Sign in</a>
            </Button>
          ) : (
            <Button
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              Try again
            </Button>
          )}
          <TextLink to="/w">Go to your workspace</TextLink>
        </>
      }
    />
  );
}
