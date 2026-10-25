import { useState } from 'react';
import { useFailedQueries } from '@/api/queries';
import { flatItems } from '@/api/queries/keys';
import type { FailedQuery } from '@/api/types';
import { Button, ProgressRule, Table, TBody, TD, TH, THead, TR } from '@/ui';
import { InlineError } from '@/features/account/InlineError';
import { dateTime } from '../format';
import { ScrollTable } from '../ScrollTable';
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

  return (
    <section aria-labelledby="failed" className="min-w-0">
      <h2 id="failed" className="mb-3 text-sm font-medium text-ink">
        {strings.monitoring.failed}
      </h2>
      {q.error && rows.length === 0 ? (
        <InlineError error={q.error} retry={() => void q.refetch()} />
      ) : q.isPending ? (
        <ProgressRule label="Loading failed queries" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-3">{strings.monitoring.noFailed}</p>
      ) : (
        <>
          <ScrollTable>
            <Table stickyHeader>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Question</TH>
                  <TH>Why</TH>
                  <TH>Error</TH>
                  <TH>Message</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.messageId}>
                    <TD className="whitespace-nowrap font-mono text-xs text-ink-3">
                      {dateTime(r.createdAt)}
                    </TD>
                    <TD className="max-w-[26rem]">
                      <span className="line-clamp-2 text-ink">{r.question ?? '—'}</span>
                      {r.feedbackNote && (
                        <span className="mt-0.5 block text-xs text-ink-3">“{r.feedbackNote}”</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-ink-2">
                      {r.reasons.map((x) => reasonLabel[x] ?? x).join(', ')}
                      {r.invalidCitations > 0 && (
                        <span className="ml-1 font-mono text-ink-3">({r.invalidCitations})</span>
                      )}
                    </TD>
                    <TD className="max-w-[16rem] font-mono text-xs text-error">{r.error ?? ''}</TD>
                    <TD>
                      <CopyId id={r.messageId} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </ScrollTable>
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

/** The message id is what the logs are searched by; one click copies it. */
function CopyId({ id }: { id: string }) {
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
    <span className="flex items-center gap-2 whitespace-nowrap">
      <code className="select-all font-mono text-xs text-ink-3">{id.slice(0, 10)}…</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy message id ${id}`}
        className="min-h-8 rounded-sm px-1.5 text-xs text-accent hover:bg-paper-2"
      >
        <span aria-live="polite">
          {copied ? strings.monitoring.copied : strings.monitoring.copy}
        </span>
      </button>
    </span>
  );
}
