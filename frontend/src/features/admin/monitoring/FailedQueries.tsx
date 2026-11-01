import { Fragment, useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { useFailedQueries } from '@/api/queries';
import { flatItems } from '@/api/queries/keys';
import type { FailedQuery } from '@/api/types';
import { cn } from '@/lib/cn';
import {
  Button,
  Callout,
  DataTable,
  EmptyState,
  SectionHeading,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TextButton,
} from '@/ui';
import { ListLoading } from '@/features/account/ListLoading';
import { dateTime } from '../format';
import { strings } from '../strings';

const reasonLabel: Record<FailedQuery['reasons'][number], string> = {
  thumbs_down: 'not helpful',
  error: 'error',
  invalid_citations: 'bad citations',
  weak_retrieval: 'weak retrieval',
};

/** Answers that errored, were marked not helpful, cited badly or retrieved weakly. */
export function FailedQueries() {
  const q = useFailedQueries();
  const rows = flatItems(q.data) as FailedQuery[];
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section aria-labelledby="failed" className="min-w-0">
      <SectionHeading id="failed" hint={strings.monitoring.failedHint}>
        {strings.monitoring.failed}
      </SectionHeading>
      {q.error && rows.length === 0 ? (
        <Callout error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <ListLoading label="Loading failed answers" />
      ) : rows.length === 0 ? (
        <EmptyState>{strings.monitoring.noFailed}</EmptyState>
      ) : (
        <>
          <DataTable label={strings.monitoring.failed} className="min-w-[720px]">
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Question</TH>
                <TH>Why</TH>
                <TH>Error</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const expanded = open === r.messageId;
                return (
                  <Fragment key={r.messageId}>
                    <TR>
                      <TD className="whitespace-nowrap">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : r.messageId)}
                          className="-ml-1 flex items-center gap-1.5 rounded-xs py-1 pr-1 pl-1 text-xs text-ink-2 hover:text-ink"
                        >
                          <CaretRight
                            size={12}
                            aria-hidden
                            className={cn('shrink-0 transition-transform', expanded && 'rotate-90')}
                          />
                          {dateTime(r.createdAt)}
                          <span className="sr-only">: show the answer</span>
                        </button>
                      </TD>
                      <TD className="max-w-[26rem]">
                        <span className="line-clamp-2 text-ink">{r.question ?? '—'}</span>
                        {r.feedbackNote && (
                          <span className="mt-0.5 block text-xs text-ink-3">
                            “{r.feedbackNote}”
                          </span>
                        )}
                      </TD>
                      <TD className="text-xs whitespace-nowrap text-ink-2">
                        {r.reasons.map((x) => reasonLabel[x] ?? x).join(', ')}
                        {r.invalidCitations > 0 && (
                          <span className="ml-1 text-ink-3">({r.invalidCitations})</span>
                        )}
                      </TD>
                      <TD className="max-w-[16rem] text-xs break-words text-error">
                        {r.error ?? ''}
                      </TD>
                    </TR>
                    {expanded && (
                      <TR>
                        <TD colSpan={4} className="bg-paper-2">
                          <div className="py-2">
                            <Detail row={r} />
                          </div>
                        </TD>
                      </TR>
                    )}
                  </Fragment>
                );
              })}
            </TBody>
          </DataTable>
          {q.hasNextPage && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                loading={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {strings.monitoring.loadMore}
              </Button>
              {q.isFetchNextPageError && (
                <span role="alert" className="text-xs text-error">
                  {q.error?.message}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** What the answer said, and the ids to find the rest by. */
function Detail({ row }: { row: FailedQuery }) {
  const ids: [string, string][] = [
    ['Message', row.messageId],
    ['Conversation', row.conversationId],
    ['Workspace', row.workspaceId],
    ['User', row.userId],
  ];
  return (
    <div className="flex max-w-prose flex-col gap-4">
      {row.answerExcerpt ? (
        <blockquote className="m-0 border-l-2 border-edge pl-4 font-serif text-base whitespace-pre-wrap text-ink-2">
          {row.answerExcerpt}
        </blockquote>
      ) : (
        <p className="text-sm text-ink-3">{strings.monitoring.noExcerpt}</p>
      )}
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-xs">
        {ids.map(([label, id]) => (
          <Fragment key={label}>
            <dt className="text-ink-3">{label}</dt>
            <dd className="m-0 flex min-w-0 items-center gap-2">
              <code className="min-w-0 truncate font-mono text-ink-2 select-all">{id}</code>
              <CopyId id={id} label={label.toLowerCase()} />
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function CopyId({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the id is selectable text anyway.
    }
  };
  return (
    <TextButton
      onClick={() => void copy()}
      aria-label={`Copy ${label} id`}
      className="shrink-0 rounded-xs px-1 py-1.5 text-xs"
    >
      <span aria-live="polite">{copied ? strings.monitoring.copied : strings.monitoring.copy}</span>
    </TextButton>
  );
}
