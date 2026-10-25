import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/api/client';
import { demoQueryOptions } from '@/api/queries/demo';
import { meQueryOptions } from '@/api/queries/me';
import { startGuest } from '@/auth';
import { Button, ProgressRule } from '@/ui';
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
  const started = useRef(-1);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;
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
  }, [attempt, navigate, queryClient]);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {!failure && <ProgressRule label={t.opening} />}
      <main id="main" className="mx-auto max-w-[720px] px-4 pt-10 pb-16 sm:pt-16">
        <Link to="/" className="font-mono text-xs tracking-wide text-ink-3 hover:text-ink">
          CodeBook
        </Link>
        {failure ? (
          <div className="mt-8 max-w-[52ch]" role="alert">
            <p className="text-sm text-ink">{t[failure]}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {failure !== 'limit' && (
                <Button
                  variant="secondary"
                  className="max-sm:h-10"
                  onClick={() => {
                    setFailure(undefined);
                    setAttempt((n) => n + 1);
                  }}
                >
                  {t.retry}
                </Button>
              )}
              <Link to="/sign-in" className="py-2 text-accent underline underline-offset-2">
                {t.signIn}
              </Link>
              <Link to="/" className="py-2 text-ink-2 underline underline-offset-2">
                {authStrings.back}
              </Link>
            </div>
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
