import { useEffect, useRef, useState } from 'react';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, isApiError, unwrap } from '@/api/client';
import { demoQueryOptions } from '@/api/queries/demo';
import { meQueryOptions } from '@/api/queries/me';
import { startGuest } from '@/auth';
import { handOff } from '@/features/chat/handoff';
import { seedMessages } from '@/features/chat/useMessages';
import { landing } from '@/features/landing/strings';
import { AuthShell, Button, ProgressRule, TextLink } from '@/ui';
import { safeNext } from './safeNext';
import { authStrings } from './strings';

const t = authStrings.demo;
const route = getRouteApi('/demo');
type Failure = 'limit' | 'missing' | 'failed';

/**
 * Opens the public demo: makes a guest session unless there already is one, then goes to the
 * demo workspace, to `next` when it is a safe path, or into a new conversation that asks `q`.
 */
export function DemoEntry() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { q, next } = route.useSearch();
  const [failure, setFailure] = useState<Failure>();
  const [slow, setSlow] = useState(false);
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
        const workspaceId = demo.workspace.id;
        const target = next ? safeNext(next) : undefined;
        if (target && target !== '/w') {
          await navigate({ href: target, replace: true });
          return;
        }
        if (q) {
          const conversation = await unwrap(
            api.POST('/api/v1/workspaces/{workspaceId}/conversations', {
              params: { path: { workspaceId } },
              body: {},
            }),
          );
          seedMessages(queryClient, { ...conversation, messages: { items: [], nextCursor: null } });
          handOff(conversation.id, { content: q, useMemory: false });
          await navigate({
            to: '/w/$workspaceId/c/$conversationId',
            params: { workspaceId, conversationId: conversation.id },
            replace: true,
          });
          return;
        }
        await navigate({ to: '/w/$workspaceId', params: { workspaceId }, replace: true });
      } catch (error) {
        setFailure(
          isApiError(error, 429) ? 'limit' : isApiError(error, 404) ? 'missing' : 'failed',
        );
      }
    })();
  }, [attempt, navigate, queryClient, q, next]);

  // A sleeping server can take a minute to answer; say so after a few seconds.
  useEffect(() => {
    if (failure) return;
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [failure, attempt]);

  return (
    <AuthShell>
      {!failure && <ProgressRule label={t.opening} className="fixed inset-x-0 top-0" />}
      {failure ? (
        <div role="alert">
          <h1 className="heading-section">{t[failure]}</h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {failure !== 'limit' && (
              <Button
                variant="secondary"
                onClick={() => {
                  setFailure(undefined);
                  setSlow(false);
                  setAttempt((n) => n + 1);
                }}
              >
                {t.retry}
              </Button>
            )}
            <TextLink to="/sign-in" className="py-2">
              {t.signIn}
            </TextLink>
            <Link to="/" className="py-2 text-ink-2 underline underline-offset-2">
              {authStrings.back}
            </Link>
          </div>
        </div>
      ) : (
        <div aria-live="polite">
          <h1 className="heading-section">{q ? landing.demo.openingQuestion : t.opening}</h1>
          {q && <p className="prose mt-3 text-ink-2 italic">{q}</p>}
          {slow && <p className="mt-4 text-sm text-ink-3">{landing.demo.waking}</p>}
        </div>
      )}
    </AuthShell>
  );
}
