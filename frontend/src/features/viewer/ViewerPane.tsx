import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Dialog as RadixDialog } from 'radix-ui';
import { Drawer } from 'vaul';
import { CaretLeft, CaretRight, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useSource } from '@/api/queries';
import { useHighlights } from '@/api/queries/highlights';
import { flatItems } from '@/api/queries/keys';
import type { SourceType } from '@/api/types';
import { rememberPlace } from '@/features/sources/recent';
import { useSourceAccess } from '@/features/sources/useSourceAccess';
import { displayTitle } from '@/lib/displayTitle';
import { cn } from '@/lib/cn';
import { shortcutLabel, useShortcut } from '@/lib/keyboard';
import { closedViewerSearch, viewerSearchFor, type ViewerTarget } from '@/lib/viewerParams';
import { Button, ProgressRule, Tooltip, type ButtonProps } from '@/ui';
import { BookView } from './BookView';
import { CodeView } from './CodeView';
import { FindBar } from './FindBar';
import { WebView } from './WebView';
import { usePrintedLabel } from './pageLabels';
import { SelectionToolbar } from './SelectionToolbar';
import { useCitationNav, type CitationStop } from './useCitationNav';
import { ViewerContext } from './viewerContext';
import { ViewError } from './ViewError';
import { s } from './strings';
import './code.css';
import './marks.css';
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

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform);
const FIND_KEY = 'mod+f';

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
  const { workspaceId } = useParams({ strict: false }) as { workspaceId?: string };
  const pathname = useLocation({ select: (l) => l.pathname });
  const source = useSource(target.sourceId);
  const nav = useCitationNav(search.cite, search.from);
  // The element that holds the viewer: it takes focus when the reader clicks in it, so the
  // find key works there, and the selection bar is placed inside it.
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const targetKey = JSON.stringify(target);

  const access = useSourceAccess(workspaceId ?? '');
  const canHighlight = Boolean(workspaceId) && access.canManage;
  const highlightBlocked = canHighlight
    ? undefined
    : access.isGuest
      ? s.selection.guest
      : s.selection.demo;
  const highlights = useSourceHighlights(workspaceId, target.sourceId, canHighlight);

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The current hit starts over on every new page or file.
  const [step, setStep] = useState({ key: targetKey, index: 0 });
  const findIndex = step.key === targetKey ? step.index : 0;
  const [findCount, setFindCount] = useState(0);
  const [findPartial, setFindPartial] = useState(false);
  const findInput = useRef<HTMLInputElement>(null);
  const [focusFind, setFocusFind] = useState(0);
  useEffect(() => {
    if (!focusFind) return;
    findInput.current?.focus();
    findInput.current?.select();
  }, [focusFind]);

  const trimmed = query.trim();
  const find = useMemo(
    () => (findOpen && trimmed ? { query: trimmed, index: findIndex } : undefined),
    [findOpen, trimmed, findIndex],
  );
  const context = useMemo(
    () => ({ find, setFindCount, setFindPartial, highlights }),
    [find, highlights],
  );

  const openFind = () => {
    setFindOpen(true);
    setFocusFind((n) => n + 1);
  };
  const closeFind = () => {
    setFindOpen(false);
    frame?.focus({ preventScroll: true });
  };
  const stepFind = (delta: 1 | -1) =>
    setStep({
      key: targetKey,
      index: findCount ? ((findIndex % findCount) + delta + findCount) % findCount : 0,
    });
  // The browser's own find stays for the rest of the page; inside the viewer, ours answers.
  const onFrameKey = useEffectEvent((event: KeyboardEvent) => {
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openFind();
    }
  });
  useEffect(() => {
    if (!frame) return;
    const listener = (event: KeyboardEvent) => onFrameKey(event);
    frame.addEventListener('keydown', listener);
    return () => frame.removeEventListener('keydown', listener);
  }, [frame]);
  // Escape closes what is open inside the viewer first: the find bar, then a selection.
  const dismissInner = () => {
    if (findOpen) {
      closeFind();
      return true;
    }
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed && frame?.contains(selection.anchorNode)) {
      selection.removeAllRanges();
      return true;
    }
    return false;
  };
  const onEscape = (event: { preventDefault: () => void }) => {
    if (dismissInner()) event.preventDefault();
  };

  const remember = useEffectEvent(() => {
    if (!workspaceId || !source.data) return;
    rememberPlace(workspaceId, {
      sourceId: source.data.id,
      title: displayTitle(source.data).name,
      type: source.data.type,
      target,
    });
  });
  const loadedId = source.data?.id;
  useEffect(() => {
    remember();
  }, [targetKey, loadedId, workspaceId]);

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
  useShortcut(
    'escape',
    () => {
      if (!dismissInner()) close();
    },
    { enabled: presentation === 'pane' },
  );
  useShortcut('[', () => goTo(nav.prev), { enabled: Boolean(nav.prev) });
  useShortcut(']', () => goTo(nav.next), { enabled: Boolean(nav.next) });

  const shown = source.data ? displayTitle(source.data) : undefined;
  const title = shown?.name ?? (source.isError ? s.unavailable : '');
  const printed = usePrintedLabel(target.sourceId, target.kind === 'page' ? target.page : 0);
  const where = locationOf(target, printed);
  const snippet = nav.current?.citation.snippet;

  // The message box is on the conversation pages, and a new conversation has one. On phones
  // and tablets the viewer covers it, so the viewer steps aside once the question is set up.
  const onChat = /^\/w\/[^/]+\/?$/.test(pathname) || /\/c\/[^/]+\/?$/.test(pathname);
  const afterAsk = () => {
    const covering = presentation !== 'pane';
    if (onChat && !covering) return;
    const keep = (prev: Record<string, unknown>) =>
      covering ? { ...prev, ...closedViewerSearch } : prev;
    if (onChat || !workspaceId) void navigate({ to: '.', search: keep });
    else void navigate({ to: '/w/$workspaceId', params: { workspaceId }, search: keep });
  };

  const sourceType = source.data?.type;
  const wholeType: SourceType | undefined =
    target.kind === 'page' ? 'PDF' : sourceType === 'WEBSITE' ? 'WEBSITE' : undefined;

  const body = (
    <ViewerContext value={context}>
      {findOpen && (
        <FindBar
          inputRef={findInput}
          query={query}
          onQuery={(next) => {
            setQuery(next);
            setStep({ key: targetKey, index: 0 });
          }}
          index={findIndex}
          count={findCount}
          partial={findPartial}
          onStep={stepFind}
          onClose={closeFind}
          placeholder={
            target.kind === 'file' && sourceType === 'GITHUB_REPO'
              ? s.find.placeholderFile
              : s.find.placeholder
          }
          whole={
            workspaceId && wholeType
              ? {
                  workspaceId,
                  sourceId: target.sourceId,
                  sourceType: wholeType,
                  onOpen: (next) => setSearch(viewerSearchFor(next)),
                }
              : undefined
          }
        />
      )}
      <Body
        target={target}
        sourceType={sourceType}
        sourceError={source.isError ? source.error : undefined}
        onRetry={() => void source.refetch()}
        snippet={snippet}
        onPage={(page) => setSearch({ page }, true)}
      />
      <SelectionToolbar
        frame={frame}
        target={target}
        source={{ title, type: sourceType }}
        workspaceId={workspaceId}
        highlightBlocked={highlightBlocked}
        onAsked={afterAsk}
      />
    </ViewerContext>
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
      find={
        <Tooltip content={`${s.find.open}  ${shortcutLabel(FIND_KEY)}`}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={s.find.open}
            aria-keyshortcuts={isMac ? 'Meta+F' : 'Control+F'}
            aria-pressed={findOpen}
            onClick={() => (findOpen ? closeFind() : openFind())}
          >
            <MagnifyingGlass size={16} aria-hidden />
          </Button>
        </Tooltip>
      }
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
          <Drawer.Content
            ref={setFrame}
            data-viewer
            onEscapeKeyDown={onEscape}
            className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-2rem)] flex-col rounded-t-md border-t border-rule bg-paper outline-none"
          >
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
            ref={setFrame}
            data-viewer
            onEscapeKeyDown={onEscape}
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
      ref={setFrame}
      data-viewer
      tabIndex={-1}
      aria-label={`${s.region}: ${title}`}
      className={cn('sticky top-0 flex h-dvh min-h-0 flex-col bg-paper outline-none')}
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
  find,
  close,
}: {
  title: string;
  where: string;
  mono: boolean;
  citeNav: ReactNode;
  find: ReactNode;
  close: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-rule py-2 pr-2 pl-4">
      <div className="min-w-0 flex-1">
        <div className="heading-minor truncate text-ink">{title}</div>
        <div className={cn('truncate text-xs text-ink-3', mono && 'font-mono')}>{where}</div>
      </div>
      {citeNav}
      {find}
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

/** "p. 157", "model.py:42–61", "Attention". Paths are set in mono. */
function locationOf(target: ViewerTarget, printed?: string): { text: string; mono: boolean } {
  if (target.kind === 'page') {
    return { text: printed ? `p. ${target.page} (${printed})` : `p. ${target.page}`, mono: false };
  }
  if (target.heading) return { text: target.heading, mono: false };
  if (target.lineStart === undefined) return { text: target.path, mono: true };
  const lines =
    target.lineEnd && target.lineEnd !== target.lineStart
      ? `${target.lineStart}–${target.lineEnd}`
      : String(target.lineStart);
  return { text: `${target.path}:${lines}`, mono: true };
}

/** The reader's highlights in one source, every page of them: the views mark them all. */
function useSourceHighlights(workspaceId: string | undefined, sourceId: string, enabled: boolean) {
  const on = enabled && Boolean(workspaceId);
  const query = useHighlights(workspaceId ?? '', sourceId, on);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  return useMemo(() => (on ? flatItems(query.data) : []), [on, query.data]);
}
