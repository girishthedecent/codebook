import { useEffect, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Dialog as RadixDialog } from 'radix-ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { conversationsQueryOptions } from '@/api/queries/conversations';
import { flatItems } from '@/api/queries/keys';
import { searchQueryOptions, sourcesQueryOptions } from '@/api/queries/sources';
import { workspacesQueryOptions } from '@/api/queries/workspaces';
import type { SearchHit } from '@/api/types';
import { useMe } from '@/auth';
import { useSignOut } from '@/auth/useSignOut';
import { setTheme } from '@/lib/theme';
import { displayTitle } from '@/lib/displayTitle';
import { shortcutLabel, useShortcut } from '@/lib/keyboard';
import { useBreakpoint } from '@/lib/breakpoints';
import { viewerSearchFor } from '@/lib/viewerParams';
import { Kbd, SourceBadge, VisuallyHidden } from '@/ui';
import { readLastWorkspaceId } from '@/features/account/lastWorkspaceId';
import { en } from '@/i18n/en';
import { strings } from '@/features/account/strings';
import { Highlight, hitTarget, hitWhere, snippetAround } from './passages';
import { commandStrings as c } from './strings';
import { openShortcuts } from '@/features/shell/ShortcutsDialog';

const s = strings.command;
const OPEN_EVENT = 'codebook:open-command';

/** Opens the menu from anywhere, e.g. the phone top bar that has no keyboard. */
export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * ⌘K / Ctrl K. Finds sources, passages, workspaces and recent conversations, and lists the
 * actions: the few that don't need a form, then a "Go to" for every page. Mounted once by each
 * layout.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  useShortcut('mod+k', () => setOpen((o) => !o));
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  return (
    <>
      <RadixDialog.Root open={open} onOpenChange={setOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
          <RadixDialog.Content
            aria-describedby={undefined}
            className="fixed inset-x-4 top-[14vh] max-sm:top-[8vh] z-50 mx-auto max-w-[560px] overflow-hidden rounded-md border border-rule bg-paper shadow-float outline-none"
          >
            <VisuallyHidden>
              <RadixDialog.Title>{s.label}</RadixDialog.Title>
            </VisuallyHidden>
            {open && (
              <Menu
                close={() => setOpen(false)}
                showShortcuts={() => {
                  setOpen(false);
                  openShortcuts();
                }}
              />
            )}
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// Passages are searched from this many letters, so a first keystroke doesn't fire a search.
const MIN_PASSAGE_QUERY = 2;
const SOURCES_SHOWN = 6;

function Menu({ close, showShortcuts }: { close: () => void; showShortcuts: () => void }) {
  const bp = useBreakpoint();
  const navigate = useNavigate();
  const { signOut } = useSignOut();
  const { isAdmin, isGuest } = useMe();
  const params = useParams({ strict: false }) as { workspaceId?: string };
  const current = params.workspaceId;
  const workspaceId = current ?? readLastWorkspaceId() ?? undefined;

  const [text, setText] = useState('');
  const query = text.trim();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // Every word has to be in the label; with no words everything shows.
  const match = (label: string) => words.every((w) => label.toLowerCase().includes(w));

  const workspaces = useInfiniteQuery(workspacesQueryOptions);
  const conversations = useInfiniteQuery({
    ...conversationsQueryOptions(current ?? ''),
    enabled: Boolean(current),
  });
  const sources = useInfiniteQuery({
    ...sourcesQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });

  // Keyword mode: the database matches the words, with no embedding or model call behind a
  // keystroke.
  const passageQuery = useDebounced(query, 300);
  const passages = useQuery({
    ...searchQueryOptions(workspaceId ?? '', {
      query: passageQuery,
      mode: 'keyword',
      topK: 6,
      expandParents: false,
      rerank: false,
    }),
    enabled: Boolean(workspaceId) && passageQuery.length >= MIN_PASSAGE_QUERY,
    placeholderData: keepPreviousData,
  });
  const searching = query.length >= MIN_PASSAGE_QUERY;
  const hits = searching && passages.data ? passages.data.results : [];

  // `href` keeps these working for routes other features own; the router still navigates in-app.
  const go = (href: string) => {
    close();
    void navigate({ href });
  };
  const inWorkspace = (path: string) => go(workspaceId ? `/w/${workspaceId}${path}` : '/w');
  const openPassage = (hit: SearchHit) => {
    close();
    const target = viewerSearchFor(hitTarget(hit));
    // Beside whatever is open when inside a workspace; otherwise on its chat page.
    if (current) {
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, ...target }),
      });
    } else if (workspaceId) {
      void navigate({ to: '/w/$workspaceId', params: { workspaceId }, search: target });
    }
  };

  const toggleTheme = () => {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === 'dark' ||
      (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setTheme(dark ? 'light' : 'dark');
    close();
  };

  type Action = [label: string, run: () => void];
  const when = (yes: boolean, ...items: Action[]) => (yes ? items : []);

  const shownSources = flatItems(sources.data)
    .filter((src) => match(displayTitle(src).name))
    .slice(0, SOURCES_SHOWN);
  const allWorkspaces = flatItems(workspaces.data);
  const shownWorkspaces = allWorkspaces.filter((w) => match(w.name));
  const shownConversations = flatItems(conversations.data)
    .filter((conv) => match(conv.title))
    .slice(0, 8);

  // `go` takes a plain address, so a page another part of the app adds later needs no import here.
  const actions: Action[] = [
    ...when(Boolean(workspaceId), [s.newConversation, () => inWorkspace('')]),
    [c.switchTheme, toggleTheme],
    ...when(bp !== 'phone', [s.shortcuts, showShortcuts]),
    [c.goTo(c.library), () => inWorkspace('/sources')],
    [c.goTo(s.study), () => inWorkspace('/study')],
    [c.goTo(c.graph), () => inWorkspace('/graph')],
    // Highlights belong to an account; a visitor has none.
    ...when(!isGuest && Boolean(workspaceId), [
      c.goTo(c.highlights),
      () => inWorkspace('/highlights'),
    ]),
    ...when(!isGuest, [c.goTo(strings.nav.memory), () => go('/memory')]),
    [c.goTo(strings.nav.usage), () => go('/usage')],
    [c.goTo(strings.nav.settings), () => go('/settings')],
    ...when(isAdmin, [c.goTo(strings.nav.admin), () => go('/admin')]),
    isGuest
      ? [
          en.auth.signIn,
          () =>
            go(
              `/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
            ),
        ]
      : [
          strings.nav.signOut,
          () => {
            close();
            void signOut();
          },
        ],
  ];
  const shownActions = actions.filter(([label]) => match(label));

  return (
    <Command label={s.label} loop shouldFilter={false} className="flex max-h-[60vh] flex-col">
      <div className="flex items-center gap-2 border-b border-rule px-4">
        {/* Radix moves focus to the first focusable element, which is this input. */}
        <Command.Input
          value={text}
          onValueChange={setText}
          placeholder={c.placeholder}
          className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 max-sm:text-base"
        />
        <Kbd>{shortcutLabel('escape')}</Kbd>
      </div>
      <Command.List className="overflow-y-auto p-1">
        {!searching || !passages.isFetching ? (
          <Command.Empty className="px-3 py-6 text-sm text-ink-3">{s.empty}</Command.Empty>
        ) : null}

        {shownSources.length > 0 && (
          <Group heading={c.sources}>
            {shownSources.map((src) => {
              const { name, ref } = displayTitle(src);
              return (
                <Item
                  key={src.id}
                  value={`source ${src.title}`}
                  onSelect={() => go(`/w/${workspaceId}/sources/${src.id}`)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <SourceBadge type={src.type} />
                    <span className="truncate">{name}</span>
                  </span>
                  {ref && <Hint>{ref}</Hint>}
                </Item>
              );
            })}
          </Group>
        )}

        {searching && (hits.length > 0 || passages.isFetching || passages.isError) && (
          <Group heading={c.passages}>
            {hits.map((hit, i) => (
              <Item key={hit.chunkId} value={`passage ${i}`} tall onSelect={() => openPassage(hit)}>
                <span className="min-w-0">
                  <span className="block truncate text-xs text-ink-3">
                    {displayTitle({ title: hit.sourceTitle, type: hit.sourceType }).name} ·{' '}
                    {hitWhere(hit)}
                  </span>
                  <span className="mt-0.5 line-clamp-2 font-serif text-sm text-ink">
                    <Highlight
                      text={snippetAround(hit.content, passageQuery)}
                      query={passageQuery}
                    />
                  </span>
                </span>
              </Item>
            ))}
            {hits.length === 0 && passages.isFetching && (
              <p role="status" className="px-3 py-2 text-sm text-ink-3">
                {c.searching}
              </p>
            )}
            {hits.length === 0 && passages.isError && !passages.isFetching && (
              <p className="px-3 py-2 text-sm text-ink-3">{c.passagesFailed}</p>
            )}
          </Group>
        )}

        {allWorkspaces.length > 1 && shownWorkspaces.length > 0 && (
          <Group heading={s.workspaces}>
            {shownWorkspaces.map((w) => (
              <Item key={w.id} value={`workspace ${w.name}`} onSelect={() => go(`/w/${w.id}`)}>
                {w.name}
                {w.id === current && <Hint>current</Hint>}
              </Item>
            ))}
          </Group>
        )}

        {current && shownConversations.length > 0 && (
          <Group heading={s.conversations}>
            {shownConversations.map((conv, i) => (
              <Item
                key={conv.id}
                // Titles repeat ("New conversation"), and cmdk takes equal values for one item.
                value={`conversation ${i} ${conv.title}`}
                onSelect={() => go(`/w/${current}/c/${conv.id}`)}
              >
                {conv.title}
              </Item>
            ))}
          </Group>
        )}

        {shownActions.length > 0 && (
          <Group heading={s.actions}>
            {shownActions.map(([label, run]) => (
              <Item key={label} value={`action ${label}`} onSelect={run}>
                {label}
              </Item>
            ))}
          </Group>
        )}
      </Command.List>
    </Command>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-3"
    >
      {children}
    </Command.Group>
  );
}

function Item({
  children,
  onSelect,
  value,
  tall,
}: {
  children: ReactNode;
  onSelect: () => void;
  value: string;
  /** Two lines of content, so the row isn't centred on a fixed height. */
  tall?: boolean;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={
        'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-3 text-sm text-ink data-[selected=true]:bg-paper-2 ' +
        (tall ? 'min-h-12 py-2' : 'min-h-10 max-sm:min-h-11')
      }
    >
      {children}
    </Command.Item>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-xs text-ink-3">{children}</span>;
}
