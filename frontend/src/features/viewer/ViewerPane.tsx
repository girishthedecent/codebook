import type { ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { useSource } from '@/api/queries';
import { Sheet, Tooltip } from '@/ui';
import { cn } from '@/lib/cn';
import { useShortcut } from '@/lib/keyboard';
import { closedViewerSearch, viewerSearchFor, type ViewerTarget } from '@/lib/viewerParams';
import { BookView } from './BookView';
import { CodeView } from './CodeView';
import { WebView } from './WebView';
import { useCitationNav, type CitationStop } from './useCitationNav';
import { s } from './strings';
import './viewer.css';

export type ViewerPresentation = 'pane' | 'panel' | 'sheet';

export type ViewerPaneProps = {
  target: ViewerTarget;
  presentation: ViewerPresentation;
};

/**
 * The cited page, lines or section, opened beside the conversation. Everything it shows
 * comes from the URL, so a view can be linked and the back button closes it.
 */
export default function ViewerPane({ target, presentation }: ViewerPaneProps) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { cite?: number };
  const source = useSource(target.sourceId);
  const nav = useCitationNav(search.cite);

  const setSearch = (patch: Record<string, unknown>) =>
    void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }) });
  const close = () => setSearch(closedViewerSearch);
  const goTo = (stop: CitationStop | undefined) => {
    if (stop) setSearch(viewerSearchFor(stop.target, stop.citation.n));
  };

  useShortcut('escape', close);
  useShortcut('[', () => goTo(nav.prev), { enabled: Boolean(nav.prev) });
  useShortcut(']', () => goTo(nav.next), { enabled: Boolean(nav.next) });

  const title = source.data?.title ?? (source.isError ? '' : '…');
  const where = locationOf(target);
  const snippet = nav.current?.citation.snippet;

  const body = (
    <Body
      target={target}
      sourceType={source.data?.type}
      snippet={snippet}
      onPage={(page) => setSearch({ page })}
    />
  );
  const citeNav = nav.hasStops ? (
    <CiteNav
      onPrev={nav.prev && (() => goTo(nav.prev))}
      onNext={nav.next && (() => goTo(nav.next))}
    />
  ) : null;

  if (presentation === 'sheet') {
    return (
      <Sheet
        open
        onOpenChange={(open) => !open && close()}
        title={title}
        description={<span className="font-mono">{where}</span>}
      >
        <div className="flex h-full min-h-0 flex-col">
          {citeNav && (
            <div className="flex justify-end border-b border-rule px-2 py-1">{citeNav}</div>
          )}
          {body}
        </div>
      </Sheet>
    );
  }

  return (
    <section
      aria-label={`${s.region}: ${title}`}
      className={cn(
        'flex h-full min-h-0 flex-col bg-paper',
        presentation === 'pane' && 'sticky top-0 h-dvh',
        presentation === 'panel' &&
          'absolute inset-y-0 right-0 z-30 w-[min(520px,100%)] border-l border-rule shadow-float',
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-rule pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{title}</div>
          <div className="truncate font-mono text-xs text-ink-3">{where}</div>
        </div>
        {citeNav}
        <IconButton label={s.close} onClick={close}>
          <X size={16} />
        </IconButton>
      </header>
      {body}
    </section>
  );
}

function Body({
  target,
  sourceType,
  snippet,
  onPage,
}: {
  target: ViewerTarget;
  sourceType?: 'PDF' | 'GITHUB_REPO' | 'WEBSITE';
  snippet?: string;
  onPage: (page: number) => void;
}) {
  if (target.kind === 'page') {
    return (
      <BookView sourceId={target.sourceId} page={target.page} snippet={snippet} onPage={onPage} />
    );
  }
  // A path is a repository file or a web page; until the source loads we can't tell which.
  if (!sourceType) return <div className="flex-1" />;
  if (sourceType === 'WEBSITE') {
    return <WebView sourceId={target.sourceId} url={target.path} heading={target.heading} />;
  }
  if (sourceType === 'GITHUB_REPO') {
    return (
      <CodeView
        sourceId={target.sourceId}
        path={target.path}
        lineStart={target.lineStart}
        lineEnd={target.lineEnd}
      />
    );
  }
  return <p className="px-5 py-6 text-sm text-ink-2">{s.unknown}</p>;
}

function CiteNav({ onPrev, onNext }: { onPrev?: () => void; onNext?: () => void }) {
  return (
    <div className="flex items-center">
      <IconButton label={s.prevCite} shortcut="[" onClick={onPrev}>
        <CaretLeft size={14} />
      </IconButton>
      <IconButton label={s.nextCite} shortcut="]" onClick={onNext}>
        <CaretRight size={14} />
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={shortcut ? `${label}  ${shortcut}` : label}>
      <button
        type="button"
        aria-label={label}
        aria-keyshortcuts={shortcut}
        disabled={!onClick}
        onClick={onClick}
        className="flex size-9 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-40"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** "p. 157", "lib/router/index.js:42–61", "Routing". */
function locationOf(target: ViewerTarget) {
  if (target.kind === 'page') return `p. ${target.page}`;
  if (target.heading) return target.heading;
  if (target.lineStart === undefined) return target.path;
  const lines =
    target.lineEnd && target.lineEnd !== target.lineStart
      ? `${target.lineStart}–${target.lineEnd}`
      : String(target.lineStart);
  return `${target.path}:${lines}`;
}
