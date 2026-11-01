import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { DownloadSimple } from '@phosphor-icons/react';
import { useHighlights } from '@/api/queries/highlights';
import { flatItems } from '@/api/queries/keys';
import { useWorkspace } from '@/api/queries/workspaces';
import type { Highlight } from '@/api/types';
import { displayTitle } from '@/lib/displayTitle';
import { downloadText, fileSlug } from '@/lib/download';
import { Button, Callout, EmptyState, PageHeader, PageLoading, SourceBadge } from '@/ui';
import { HighlightItem } from './HighlightList';
import { highlightPlace } from './highlightPlace';
import { shortDate } from './sourceInfo';
import { strings } from './strings';
import { useSourceAccess } from './useSourceAccess';

const h = strings.highlights;

type Group = { sourceId: string; title: string; type: Highlight['sourceType']; items: Highlight[] };

/**
 * Every highlight in the workspace, grouped by source. The groups follow the newest highlight
 * in each, so the book being read now comes first.
 */
export function HighlightsPage() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId/highlights' });
  const { canManage, isGuest } = useSourceAccess(workspaceId);
  const query = useHighlights(workspaceId, undefined, canManage);
  const workspace = useWorkspace(workspaceId);
  const items = useMemo(() => flatItems(query.data), [query.data]);
  const groups = useMemo(() => groupBySource(items), [items]);
  const [exportError, setExportError] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Everything goes into the file, not just the pages loaded so far.
  const download = async () => {
    setExportError(false);
    setExporting(true);
    try {
      let { data, hasNextPage } = query;
      while (hasNextPage) {
        ({ data, hasNextPage } = await query.fetchNextPage({ throwOnError: true }));
      }
      const name = workspace.data?.name ?? '';
      downloadText(
        `${fileSlug(`${h.fileTitle} ${name}`, 'highlights')}.md`,
        toMarkdown(name, groupBySource(flatItems(data))),
        'text/markdown;charset=utf-8',
      );
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  const shell = (children: ReactNode, actions?: ReactNode) => (
    <div className="mx-auto w-full max-w-narrow px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader title={h.title} intro={h.intro} actions={actions} />
      {children}
    </div>
  );

  if (!canManage) {
    return shell(<EmptyState>{isGuest ? h.guest : h.demo}</EmptyState>);
  }
  if (query.isPending) return shell(<PageLoading label={h.loading} rows={3} />);
  if (query.isError && !items.length) {
    return shell(<Callout error={query.error} onRetry={() => void query.refetch()} />);
  }
  if (!items.length) return shell(<EmptyState>{h.empty}</EmptyState>);

  return shell(
    <>
      {exportError && (
        <Callout tone="error" className="mb-6">
          {h.downloadFailed}
        </Callout>
      )}
      <div className="space-y-12">
        {groups.map((group) => (
          <section key={group.sourceId} aria-labelledby={`hl-${group.sourceId}`}>
            <header className="mb-4 flex items-start gap-3">
              <SourceBadge type={group.type} className="mt-1" />
              <div className="min-w-0">
                <h2
                  id={`hl-${group.sourceId}`}
                  className="heading-section min-w-0 [overflow-wrap:anywhere]"
                >
                  <Link
                    to="/w/$workspaceId/sources/$sourceId"
                    params={{ workspaceId, sourceId: group.sourceId }}
                    className="text-ink hover:underline hover:underline-offset-2"
                  >
                    {group.title}
                  </Link>
                </h2>
                <p className="text-xs text-ink-3">{h.count(group.items.length)}</p>
              </div>
            </header>
            <ul className="space-y-7 sm:pl-9">
              {group.items.map((item) => (
                <HighlightItem key={item.id} highlight={item} workspaceId={workspaceId} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          className="mt-6"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {strings.loadMore}
        </Button>
      )}
    </>,
    <Button onClick={() => void download()} loading={exporting}>
      <DownloadSimple size={14} aria-hidden />
      {h.download}
    </Button>,
  );
}

function groupBySource(items: Highlight[]): Group[] {
  const groups = new Map<string, Group>();
  for (const item of items) {
    let group = groups.get(item.sourceId);
    if (!group) {
      group = {
        sourceId: item.sourceId,
        title: displayTitle({ title: item.sourceTitle, type: item.sourceType }).name,
        type: item.sourceType,
        items: [],
      };
      groups.set(item.sourceId, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

/** The highlights as a reading note: a heading per source, each passage quoted with its place. */
function toMarkdown(workspaceName: string, groups: Group[]) {
  const out = [`# ${h.fileTitle}${workspaceName ? `: ${workspaceName}` : ''}`, ''];
  for (const group of groups) {
    out.push(`## ${group.title}`, '');
    for (const item of group.items) {
      for (const line of item.text.split('\n')) out.push(`> ${line}`);
      out.push('>', `> ${highlightPlace(item).text}, ${shortDate(item.createdAt)}`, '');
      if (item.note) out.push(item.note, '');
    }
  }
  return out.join('\n');
}
