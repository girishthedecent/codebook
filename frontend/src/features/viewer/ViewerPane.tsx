import type { ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Dialog as RadixDialog } from 'radix-ui';
import { Drawer } from 'vaul';
import { CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { useSource } from '@/api/queries';
import { displayTitle } from '@/lib/displayTitle';
import { cn } from '@/lib/cn';
import { useShortcut } from '@/lib/keyboard';
import { closedViewerSearch, viewerSearchFor, type ViewerTarget } from '@/lib/viewerParams';
import { Button, ProgressRule, Tooltip, type ButtonProps } from '@/ui';
import { BookView } from './BookView';
import { CodeView } from './CodeView';
import { WebView } from './WebView';
import { useCitationNav, type CitationStop } from './useCitationNav';
import { ViewError } from './ViewError';
import { s } from './strings';
import './viewer.css';

export type ViewerPresentation = 'pane' | 'panel' | 'sheet';

export type ViewerPaneProps = {
  target: ViewerTarget;
  /**
   * `pane` fills its parent (the desktop column), `panel` is an overlay with a scrim for
   * tablets, `sheet` is the draggable bottom sheet of a phone.
   */
  presentation: ViewerPresentation;
  /**
   * Where the open citation sits among the answer's citations, for "2 of 5" beside the
   * arrows. Both are optional: without them the viewer works it out from the conversation.
   */
  citeIndex?: number;
  citeCount?: number;
};

// Sheet heights as fractions of the screen: a page of a book needs the room, code and text less.
const SHEET_SNAPS_BOOK = [0.92, 1];
const SHEET_SNAPS_TEXT = [0.6, 1];

/**
 * The cited page, lines or section, opened beside the conversation. Everything it shows
 * comes from the URL, so a view can be linked and the back button closes it.
 */
export default function ViewerPane({
  target,
  presentation,
  citeIndex,
  citeCount,
}: ViewerPaneProps) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { cite?: number; from?: string };
  const source = useSource(target.sourceId);
  const nav = useCitationNav(search.cite, search.from);

  // Flipping pages replaces the entry, so Back closes the viewer instead of walking the pages.
  const setSearch = (patch: Record<string, unknown>, replace = false) =>
    void navigate({
      to: '.',
      replace,
      search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
    });
  const close = () => setSearch(closedViewerSearch);
  const goTo = (stop: CitationStop | undefined) => {
    if (stop) setSearch(viewerSearchFor(stop.target, stop.citation.n, search.from));
  };

  // The overlay and the sheet close on Escape themselves; only the plain pane needs this.
  useShortcut('escape', close, { enabled: presentation === 'pane' });
  useShortcut('[', () => goTo(nav.prev), { enabled: Boolean(nav.prev) });
  useShortcut(']', () => goTo(nav.next), { enabled: Boolean(nav.next) });

  const shown = source.data ? displayTitle(source.data) : undefined;
  const title = shown?.name ?? (source.isError ? s.unavailable : '');
  const where = locationOf(target);
  const snippet = nav.current?.citation.snippet;

  const body = (
    <Body
      target={target}
      sourceType={source.data?.type}
      sourceError={source.isError ? source.error : undefined}
      onRetry={() => void source.refetch()}
      snippet={snippet}
      onPage={(page) => setSearch({ page }, true)}
    />
  );

  const position = citeIndex ?? nav.position;
  const total = citeCount ?? (nav.count > 1 ? nav.count : undefined);
  const citeNav =
    position !== undefined && total !== undefined && total > 1 ? (
      <CiteNav
        position={position}
        total={total}
        onPrev={nav.prev && (() => goTo(nav.prev))}
        onNext={nav.next && (() => goTo(nav.next))}
      />
    ) : null;

  const header = (
    <Header
      title={title}
      where={where.text}
      mono={where.mono}
      citeNav={citeNav}
      close={
        presentation === 'panel' ? (
          <RadixDialog.Close asChild>
            <CloseButton />
          </RadixDialog.Close>
        ) : presentation === 'sheet' ? (
          <Drawer.Close asChild>
            <CloseButton />
          </Drawer.Close>
        ) : (
          <CloseButton onClick={close} />
        )
      }
    />
  );

  if (presentation === 'sheet') {
    return (
      <Drawer.Root
        open
        onOpenChange={(open) => !open && close()}
        snapPoints={target.kind === 'page' ? SHEET_SNAPS_BOOK : SHEET_SNAPS_TEXT}
        fadeFromIndex={0}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-overlay" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-2rem)] flex-col rounded-t-md border-t border-rule bg-paper outline-none">
            <Drawer.Handle className="mx-auto mt-2 h-1 w-9 rounded-full bg-rule-2" />
            <Drawer.Title className="sr-only">{`${s.region}: ${title}`}</Drawer.Title>
            <Drawer.Description className="sr-only">{where.text}</Drawer.Description>
            {header}
            <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
              {body}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  if (presentation === 'panel') {
    return (
      <RadixDialog.Root open onOpenChange={(open) => !open && close()}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[fade-in_150ms_ease-out]" />
          <RadixDialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 right-0 z-50 flex w-[min(520px,calc(100vw-4rem))] flex-col border-l border-rule bg-paper shadow-float outline-none data-[state=open]:animate-[fade-in_150ms_ease-out]"
          >
            <RadixDialog.Title className="sr-only">{`${s.region}: ${title}`}</RadixDialog.Title>
            {header}
            {body}
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    );
  }

  return (
    <section
      aria-label={`${s.region}: ${title}`}
      className={cn('sticky top-0 flex h-dvh min-h-0 flex-col bg-paper')}
    >
      {header}
      {body}
    </section>
  );
}

function Header({
  title,
  where,
  mono,
  citeNav,
  close,
}: {
  title: string;
  where: string;
  mono: boolean;
  citeNav: ReactNode;
  close: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-rule py-2 pr-2 pl-4">
      <div className="min-w-0 flex-1">
        <div className="heading-minor truncate text-ink">{title}</div>
        <div className={cn('truncate text-xs text-ink-3', mono && 'font-mono')}>{where}</div>
      </div>
      {citeNav}
      {close}
    </header>
  );
}

function CloseButton(props: ButtonProps) {
  return (
    <Tooltip content={`${s.close}  Esc`}>
      <Button variant="ghost" size="sm" aria-label={s.close} {...props}>
        <X size={16} aria-hidden />
      </Button>
    </Tooltip>
  );
}

function Body({
  target,
  sourceType,
  sourceError,
  onRetry,
  snippet,
  onPage,
}: {
  target: ViewerTarget;
  sourceType?: 'PDF' | 'GITHUB_REPO' | 'WEBSITE';
  sourceError?: unknown;
  onRetry: () => void;
  snippet?: string;
  onPage: (page: number) => void;
}) {
  if (sourceError) return <ViewError error={sourceError} onRetry={onRetry} missing={s.deleted} />;
  if (target.kind === 'page') {
    return (
      <BookView sourceId={target.sourceId} page={target.page} snippet={snippet} onPage={onPage} />
    );
  }
  // A path is a repository file or a web page; until the source loads we can't tell which.
  if (!sourceType) return <ProgressRule label={s.loading} />;
  if (sourceType === 'WEBSITE') {
    return (
      <WebView
        sourceId={target.sourceId}
        url={target.path}
        heading={target.heading}
        snippet={snippet}
      />
    );
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
  return <ViewError message={s.unknown} />;
}

function CiteNav({
  position,
  total,
  onPrev,
  onNext,
}: {
  position: number;
  total: number;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="flex items-center">
      <NavButton label={s.prevCite} shortcut="[" onClick={onPrev}>
        <CaretLeft size={14} aria-hidden />
      </NavButton>
      <span className="px-1 text-xs whitespace-nowrap text-ink-2 tabular-nums">
        {s.citePosition(position, total)}
      </span>
      <NavButton label={s.nextCite} shortcut="]" onClick={onNext}>
        <CaretRight size={14} aria-hidden />
      </NavButton>
    </div>
  );
}

function NavButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={`${label}  ${shortcut}`}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={label}
        aria-keyshortcuts={shortcut}
        disabled={!onClick}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

/** "p. 157", "lib/router/index.js:42–61", "Routing". Paths are set in mono. */
function locationOf(target: ViewerTarget): { text: string; mono: boolean } {
  if (target.kind === 'page') return { text: `p. ${target.page}`, mono: false };
  if (target.heading) return { text: target.heading, mono: false };
  if (target.lineStart === undefined) return { text: target.path, mono: true };
  const lines =
    target.lineEnd && target.lineEnd !== target.lineStart
      ? `${target.lineStart}–${target.lineEnd}`
      : String(target.lineStart);
  return { text: `${target.path}:${lines}`, mono: true };
}
