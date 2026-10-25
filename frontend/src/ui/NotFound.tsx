import { Link, useRouter } from '@tanstack/react-router';
import { useMeQuery } from '@/api/queries/me';

const link = 'text-accent underline underline-offset-2';

export function NotFound() {
  const router = useRouter();
  // Signed-in people go back to a workspace; everyone else to the front page.
  const signedIn = Boolean(useMeQuery().data);
  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-16 min-[720px]:py-24">
      <p className="font-mono text-xs text-ink-3">404</p>
      <h1 className="mt-2 text-lg font-semibold">There's nothing at this address.</h1>
      <p className="mt-3 text-ink-2">
        The link may be old, or the page was removed.{' '}
        <Link to={signedIn ? '/w' : '/'} className={link}>
          {signedIn ? 'Go to your workspace' : 'Go to the start'}
        </Link>
        {router.history.canGoBack() && (
          <>
            {' or '}
            <button type="button" onClick={() => router.history.back()} className={link}>
              go back
            </button>
          </>
        )}
        .
      </p>
    </div>
  );
}
