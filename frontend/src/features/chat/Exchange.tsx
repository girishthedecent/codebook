import type { Citation, Message, TurnDone } from '@/api/types';
import { Answer } from './Answer';
import { CitedSources } from './CitedSources';
import { CopyAnswer, Feedback } from './Feedback';
import { Steps, TurnStatusLine } from './Steps';
import { chat } from './strings';
import { formatMs } from './toolLabels';
import type { StepView, TurnState } from './useTurn';

/** One question and its answer, whether it's streaming now or loaded from history. */
export type ExchangeView = {
  key: string;
  question: string;
  steps: StepView[];
  text: string;
  citations: Citation[];
  state: 'streaming' | 'complete' | 'error' | 'aborted';
  error?: string;
  messageId?: string;
  feedback?: Message['feedback'];
  done?: TurnDone;
};

export function fromSaved(user: Message | undefined, answer: Message | undefined): ExchangeView {
  return {
    key: answer?.id ?? user?.id ?? 'pending',
    question: user?.content ?? '',
    steps: (answer?.toolCalls ?? []).map((t) => ({
      index: t.step,
      tool: t.tool,
      args: t.args,
      ms: t.ms,
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
  };
}

export function fromLive(turn: TurnState): ExchangeView {
  return {
    key: 'live',
    question: turn.question,
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
    messageId: turn.done?.messageId,
    done: turn.done,
  };
}

/**
 * Question as a bold serif paragraph, the agent's steps as mono notes, the answer as prose
 * with a thin rule on its left. Not chat bubbles: it reads like a transcript.
 */
export function Exchange({
  view,
  conversationId,
  showMeta,
  onRetry,
}: {
  view: ExchangeView;
  conversationId: string;
  showMeta: boolean;
  onRetry?: (question: string) => void;
}) {
  const streaming = view.state === 'streaming';
  const ended = view.state === 'error' || view.state === 'aborted';

  return (
    <article className="py-6 first:pt-2" aria-busy={streaming || undefined}>
      <p className="font-serif text-base leading-[1.45] font-semibold break-words whitespace-pre-wrap text-ink">
        {view.question}
      </p>

      <Steps steps={view.steps} live={streaming} totalMs={view.done?.latencyMs} />

      <div className="mt-4 border-l border-rule-2 pl-4 max-[719px]:pl-3">
        {view.text && (
          <Answer
            text={view.text}
            citations={view.citations}
            messageId={view.messageId}
            streaming={streaming}
          />
        )}
        {streaming && <TurnStatusLine steps={view.steps} writing={view.text.length > 0} />}

        {ended && (
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-xs text-ink-3">
            <span className={view.state === 'error' ? 'text-error' : undefined}>
              {view.state === 'aborted' ? chat.stopped : (view.error ?? chat.failed)}
            </span>
            {onRetry && view.question && (
              <button
                type="button"
                onClick={() => onRetry(view.question)}
                className="text-accent underline underline-offset-2 max-[719px]:min-h-11"
              >
                {chat.retry}
              </button>
            )}
          </p>
        )}

        {view.state === 'complete' && (
          <>
            <CitedSources citations={view.citations} messageId={view.messageId} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <CopyAnswer text={view.text} />
              {view.messageId && (
                <Feedback
                  conversationId={conversationId}
                  messageId={view.messageId}
                  value={view.feedback ?? null}
                />
              )}
              {showMeta && view.done && (
                <span className="font-mono text-xs text-ink-3 tabular-nums">
                  {formatMs(view.done.latencyMs)}
                  {view.done.usage.tokensIn > 0 &&
                    ` · ${view.done.usage.tokensIn.toLocaleString()} in / ${view.done.usage.tokensOut.toLocaleString()} out`}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
