import { memo, useMemo, useState, type ReactNode } from 'react';
import { BookOpenText } from '@phosphor-icons/react';
import type { Citation, Message } from '@/api/types';
import { Button, VisuallyHidden } from '@/ui';
import { Notes } from '@/features/citations/Notes';
import { numberCitations } from '@/features/citations/numbering';
import { Answer } from './Answer';
import { CopyAnswer, Feedback } from './Feedback';
import { Consulted, LiveSteps, TurnStatusLine } from './Steps';
import { chat } from './strings';
import './chat.css';
import { formatMs } from './toolLabels';
import type { StepView, TurnState } from './useTurn';

/** What the owner sees under an answer: which model, how long, what it cost. */
export type AnswerMeta = {
  model?: string | null;
  latencyMs?: number | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: string;
  cached?: boolean;
};

/** One question and its answer, whether it's streaming now or loaded from history. */
export type ExchangeView = {
  key: string;
  question: string;
  steps: StepView[];
  text: string;
  citations: Citation[];
  state: 'streaming' | 'complete' | 'error' | 'aborted';
  error?: string;
  dropped?: boolean;
  messageId?: string;
  feedback?: Message['feedback'];
  /** Saved messages this exchange takes up: the question and, if it got one, the reply. */
  messageCount: number;
  /** Earlier failed tries at the same question, folded into this one. */
  earlier: number;
  weakRetrieval?: boolean;
  meta?: AnswerMeta;
};

function metaOf(m: Message | undefined): AnswerMeta | undefined {
  if (!m || m.model === undefined) return undefined;
  return {
    model: m.model,
    latencyMs: m.latencyMs,
    tokensIn: m.tokensIn,
    tokensOut: m.tokensOut,
    costUsd: m.costUsd,
  };
}

// A saved exchange only changes when its messages do, and the refetch after every turn hands
// back the same objects for the ones that didn't, so a view built once can be reused.
const savedViews = new WeakMap<object, { user?: Message; view: ExchangeView }>();

export function fromSaved(user: Message | undefined, answer: Message | undefined): ExchangeView {
  const anchor = (answer ?? user)!;
  const cached = savedViews.get(anchor);
  if (cached && cached.user === user) return cached.view;
  const view: ExchangeView = {
    key: answer?.id ?? user?.id ?? 'pending',
    question: user?.content ?? '',
    steps: (answer?.toolCalls ?? []).map((t, i) => ({
      id: t.id ?? `${t.step}:${t.tool}:${i}`,
      index: t.step,
      tool: t.tool,
      args: t.args,
      ms: t.ms,
      summary: t.summary,
      running: false,
      ok: t.ok,
    })),
    text: answer?.content ?? '',
    citations: answer?.citations ?? [],
    state: !answer
      ? 'error'
      : answer.status === 'COMPLETE'
        ? 'complete'
        : answer.status === 'ABORTED'
          ? 'aborted'
          : 'error',
    error: answer?.error ?? undefined,
    messageId: answer?.id,
    feedback: answer?.feedback ?? null,
    messageCount: (user ? 1 : 0) + (answer ? 1 : 0),
    earlier: 0,
    weakRetrieval: answer?.weakRetrieval,
    meta: metaOf(answer),
  };
  savedViews.set(anchor, { user, view });
  return view;
}

export function fromLive(turn: TurnState, key: string, question = turn.question): ExchangeView {
  const done = turn.done;
  return {
    key,
    question,
    steps: turn.steps,
    text: turn.text,
    citations: turn.citations,
    state:
      turn.status === 'streaming' || turn.status === 'idle'
        ? 'streaming'
        : turn.status === 'done'
          ? 'complete'
          : turn.status,
    error: turn.error?.dropped ? chat.dropped : turn.error?.message,
    dropped: turn.error?.dropped,
    messageId: done?.messageId,
    messageCount: 2,
    earlier: 0,
    meta: done
      ? {
          latencyMs: done.latencyMs,
          tokensIn: done.usage.tokensIn,
          tokensOut: done.usage.tokensOut,
          costUsd: done.usage.costUsd,
          cached: done.cached,
        }
      : undefined,
  };
}

function formatCost(costUsd: string) {
  const n = Number(costUsd);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '$0';
  if (n < 0.0001) return '<$0.0001';
  return `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;
}

function metaLine(meta: AnswerMeta) {
  const parts = [
    meta.model,
    meta.latencyMs ? formatMs(meta.latencyMs) : undefined,
    meta.tokensIn || meta.tokensOut
      ? `${(meta.tokensIn ?? 0).toLocaleString()} in, ${(meta.tokensOut ?? 0).toLocaleString()} out`
      : undefined,
    meta.costUsd ? formatCost(meta.costUsd) : undefined,
    meta.cached ? 'from a saved copy' : undefined,
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * One turn of the conversation. The question sits on the right in a tinted card, in the sans,
 * as the reader's own words; the answer follows at full width in the serif under a small
 * CodeBook heading, then what it rests on: the notes, and a colophon of what was consulted.
 */
export const Exchange = memo(function Exchange({
  view,
  conversationId,
  showMeta,
  onRetry,
}: {
  view: ExchangeView;
  conversationId: string;
  showMeta: boolean;
  /** Given only to the newest exchange: "Try again" belongs to the last thing asked. */
  onRetry?: (view: ExchangeView) => void;
}) {
  const streaming = view.state === 'streaming';
  const complete = view.state === 'complete';
  const ended = view.state === 'error' || view.state === 'aborted';
  const notes = useMemo(
    () => (complete ? numberCitations(view.text, view.citations).notes : []),
    [complete, view.text, view.citations],
  );
  const meta = showMeta && view.meta ? metaLine(view.meta) : '';

  return (
    <article className="pt-10 pb-2 first:pt-4" aria-busy={streaming || undefined}>
      <div className="flex justify-end">
        <p className="max-w-[min(85%,36rem)] rounded-xl rounded-br-xs border border-rule bg-paper-3 px-4 py-2.5 font-sans text-base/relaxed break-words whitespace-pre-wrap text-ink">
          <VisuallyHidden>{chat.youAsked} </VisuallyHidden>
          {view.question}
        </p>
      </div>

      <section className="mt-6" aria-label={chat.answerLabel}>
        <AnswerHeading />

        {streaming && <LiveSteps steps={view.steps} />}

        {view.text && (
          <Arriving live={streaming}>
            <div className="mt-3">
              <Answer
                text={view.text}
                citations={view.citations}
                messageId={view.messageId}
                streaming={streaming}
                margin={complete}
              />
            </div>
          </Arriving>
        )}

        {streaming && <TurnStatusLine steps={view.steps} writing={view.text.length > 0} />}

        {ended && <ReplyNote view={view} onRetry={onRetry} />}

        {(complete || ended) && (
          <>
            <Notes notes={notes} messageId={view.messageId} />
            <Consulted
              steps={view.steps}
              totalMs={view.meta?.latencyMs ?? undefined}
              weak={complete && view.weakRetrieval}
            />
          </>
        )}

        {complete && (
          <div className="mt-3 -ml-2.5 flex flex-wrap max-sm:-ml-3 items-center gap-x-2 gap-y-1">
            <CopyAnswer text={view.text} citations={view.citations} />
            {view.messageId && (
              <Feedback
                conversationId={conversationId}
                messageId={view.messageId}
                value={view.feedback ?? null}
              />
            )}
          </div>
        )}
        {complete && meta && <p className="mt-1 text-xs text-ink-3 tabular-nums">{meta}</p>}
      </section>
    </article>
  );
});

/** Who is speaking: the book mark and the name, small, above every answer. */
function AnswerHeading() {
  return (
    <p className="flex items-center gap-2 text-sm text-ink-2" aria-hidden>
      <span className="grid size-6 place-items-center rounded-md bg-accent-wash text-accent">
        <BookOpenText size={15} weight="bold" />
      </span>
      <span className="font-serif font-semibold text-ink">
        Code<span className="font-normal text-accent italic">Book</span>
      </span>
    </p>
  );
}

/**
 * Plays the arrival once, when the first words of a live answer appear. The choice is made on
 * mount, so a quick answer that finishes mid-animation isn't cut short.
 */
function Arriving({ live, children }: { live: boolean; children: ReactNode }) {
  const [animate] = useState(live);
  return <div className={animate ? 'answer-arrive' : undefined}>{children}</div>;
}

/** Why an answer ended early, in a calm sentence, with the way to ask again where there is one. */
function ReplyNote({
  view,
  onRetry,
}: {
  view: ExchangeView;
  onRetry?: (view: ExchangeView) => void;
}) {
  const message =
    view.state === 'aborted'
      ? chat.stopped
      : view.dropped
        ? chat.dropped
        : (view.error ?? chat.failed);
  return (
    <div className="mt-4 max-w-prose border-l-2 border-warn pl-3 font-serif text-base text-ink-2">
      {view.earlier > 0 && (
        <p className="mb-1 text-sm text-ink-3 italic">{chat.earlierAttempts(view.earlier)}</p>
      )}
      <p>{message}</p>
      {view.text && <p className="text-sm text-ink-3">{chat.keptPartial}</p>}
      {onRetry && view.question && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => onRetry(view)}>
          {chat.retry}
        </Button>
      )}
    </div>
  );
}
