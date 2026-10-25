import { useEffect, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { Dialog as RadixDialog } from 'radix-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { conversationsQueryOptions } from '@/api/queries/conversations';
import { flatItems } from '@/api/queries/keys';
import { workspacesQueryOptions } from '@/api/queries/workspaces';
import { signOut, useMe } from '@/auth';
import { setTheme } from '@/lib/theme';
import { shortcutLabel, useShortcut } from '@/lib/keyboard';
import { useBreakpoint } from '@/lib/breakpoints';
import { Dialog, Kbd, VisuallyHidden } from '@/ui';
import { readLastWorkspaceId } from '@/features/account/lastWorkspaceId';
import { en } from '@/i18n/en';
import { strings } from '@/features/account/strings';

const s = strings.command;
const OPEN_EVENT = 'codebook:open-command';

/** Opens the menu from anywhere, e.g. the phone top bar that has no keyboard. */
export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * ⌘K / Ctrl K. Jumps to any page, workspace or recent conversation, and runs the few actions
 * that don't need a form. Mounted once by each layout.
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
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
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <RadixDialog.Content
            aria-describedby={undefined}
            className="fixed inset-x-4 top-[14vh] max-[719px]:top-[8vh] z-50 mx-auto max-w-[560px] overflow-hidden rounded-md border border-rule bg-paper shadow-float outline-none"
          >
            <VisuallyHidden>
              <RadixDialog.Title>{s.label}</RadixDialog.Title>
            </VisuallyHidden>
            {open && (
              <Menu
                close={() => setOpen(false)}
                showShortcuts={() => {
                  setOpen(false);
                  setHelp(true);
                }}
              />
            )}
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </>
  );
}

function Menu({ close, showShortcuts }: { close: () => void; showShortcuts: () => void }) {
  const bp = useBreakpoint();
  const navigate = useNavigate();
  const { isAdmin, isGuest } = useMe();
  const params = useParams({ strict: false }) as { workspaceId?: string };
  const current = params.workspaceId;
  const workspaceId = current ?? readLastWorkspaceId() ?? undefined;

  const workspaces = useInfiniteQuery(workspacesQueryOptions);
  const conversations = useInfiniteQuery({
    ...conversationsQueryOptions(current ?? ''),
    enabled: Boolean(current),
  });

  // `href` keeps these working for routes other features own; the router still navigates in-app.
  const go = (href: string) => {
    close();
    void navigate({ href });
  };
  const inWorkspace = (path: string) => go(workspaceId ? `/w/${workspaceId}${path}` : '/w');

  const toggleTheme = () => {
    const root = document.documentElement;
    const dark =
      root.dataset.theme === 'dark' ||
      (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setTheme(dark ? 'light' : 'dark');
    close();
  };

  return (
    <Command label={s.label} loop className="flex max-h-[60vh] flex-col">
      <div className="flex items-center gap-2 border-b border-rule px-4">
        {/* Radix moves focus to the first focusable element, which is this input. */}
        <Command.Input
          placeholder={s.placeholder}
          className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
        <Kbd>{shortcutLabel('escape')}</Kbd>
      </div>
      <Command.List className="overflow-y-auto p-1">
        <Command.Empty className="px-3 py-6 text-sm text-ink-3">{s.empty}</Command.Empty>

        <Group heading={s.goTo}>
          <Item onSelect={() => inWorkspace('')}>{s.chat}</Item>
          <Item onSelect={() => inWorkspace('/sources')}>{s.sources}</Item>
          <Item onSelect={() => inWorkspace('/graph')}>{strings.nav.graph}</Item>
          <Item onSelect={() => inWorkspace('/study')}>{s.study}</Item>
          {!isGuest && <Item onSelect={() => go('/memory')}>{strings.nav.memory}</Item>}
          <Item onSelect={() => go('/usage')}>{strings.nav.usage}</Item>
          <Item onSelect={() => go('/settings')}>{strings.nav.settings}</Item>
          {isAdmin && <Item onSelect={() => go('/admin')}>{strings.nav.admin}</Item>}
        </Group>

        {flatItems(workspaces.data).length > 1 && (
          <Group heading={s.workspaces}>
            {flatItems(workspaces.data).map((w) => (
              <Item
                key={w.id}
                value={`workspace ${w.name} ${w.id}`}
                onSelect={() => go(`/w/${w.id}`)}
              >
                {w.name}
                {w.id === current && <Hint>current</Hint>}
              </Item>
            ))}
          </Group>
        )}

        {current && flatItems(conversations.data).length > 0 && (
          <Group heading={s.conversations}>
            {flatItems(conversations.data)
              .slice(0, 8)
              .map((c) => (
                <Item
                  key={c.id}
                  value={`conversation ${c.title} ${c.id}`}
                  onSelect={() => go(`/w/${current}/c/${c.id}`)}
                >
                  {c.title}
                </Item>
              ))}
          </Group>
        )}

        <Group heading={s.actions}>
          {workspaceId && <Item onSelect={() => inWorkspace('')}>{s.newConversation}</Item>}
          <Item onSelect={toggleTheme}>{s.toggleTheme}</Item>
          {bp !== 'phone' && <Item onSelect={showShortcuts}>{s.shortcuts}</Item>}
          {isGuest && (
            <Item
              onSelect={() =>
                go(
                  `/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
                )
              }
            >
              {en.auth.signIn}
            </Item>
          )}
          {!isGuest && (
            <Item
              onSelect={async () => {
                close();
                await signOut();
                void navigate({ to: '/' });
              }}
            >
              {strings.nav.signOut}
            </Item>
          )}
        </Group>
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
}: {
  children: ReactNode;
  onSelect: () => void;
  value?: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 text-sm text-ink data-[selected=true]:bg-paper-2 max-[719px]:min-h-11"
    >
      {children}
    </Command.Item>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs text-ink-3">{children}</span>;
}

const shortcutList: [string, string][] = [
  [shortcutLabel('mod+k'), 'Search and commands'],
  ['/', 'Focus the message box'],
  ['Esc', 'Close the viewer or a dialog'],
  ['[  ]', 'Previous and next page in the viewer'],
  ['\u2190  \u2192', 'Previous and next flashcard'],
  ['1 to 6', 'Pick a quiz answer, Enter for next'],
];

function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={s.shortcuts} size="sm">
      <dl className="space-y-2">
        {shortcutList.map(([keys, what]) => (
          <div key={what} className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-2">{what}</dt>
            <dd className="shrink-0">
              <Kbd>{keys}</Kbd>
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
