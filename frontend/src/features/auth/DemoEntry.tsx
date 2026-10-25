import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { demoQueryOptions } from '@/api/queries/demo';
import { meQueryOptions } from '@/api/queries/me';
import { startGuest } from '@/auth';
import { ProgressRule } from '@/ui';
import { authStrings } from './strings';

const t = authStrings.demo;
type Failure = 'limit' | 'missing' | 'failed';

/**
 * Opens the public demo: makes a guest session unless there already is one, then goes to the
 * demo workspace. Anyone already signed in just goes straight there.
 */
export function DemoEntry() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<Failure>();
  // StrictMode runs effects twice in dev; a second guest sign-in would burn the daily limit.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const [me, demo] = await Promise.all([
          queryClient.fetchQuery(meQueryOptions),
          queryClient.fetchQuery(demoQueryOptions),
        ]);
        if (!me) await startGuest();
        await navigate({
          to: '/w/$workspaceId',
          params: { workspaceId: demo.workspace.id },
          replace: true,
        });
      } catch (error) {
        setFailure(
          isApiError(error, 429) ? 'limit' : isApiError(error, 404) ? 'missing' : 'failed',
        );
      }
    })();
  }, [navigate, queryClient]);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {!failure && <ProgressRule label={t.opening} />}
      <main className="mx-auto max-w-[720px] px-4 pt-10 pb-16 sm:pt-16">
        <Link to="/" className="font-mono text-xs tracking-wide text-ink-3 hover:text-ink">
          CodeBook
        </Link>
        {failure ? (
          <div className="mt-8 max-w-[52ch]" role="alert">
            <p className="text-sm text-ink">{t[failure]}</p>
            <p className="mt-4 flex gap-4 text-sm">
              <Link to="/sign-in" className="text-accent underline underline-offset-2">
                {t.signIn}
              </Link>
              <Link to="/" className="text-ink-2 underline underline-offset-2">
                {authStrings.back}
              </Link>
            </p>
          </div>
        ) : (
          <p className="mt-8 text-sm text-ink-2" aria-live="polite">
            {t.opening}
          </p>
        )}
      </main>
    </div>
  );
}
