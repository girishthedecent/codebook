import { useState } from 'react';
import { Link, useLocation, useParams } from '@tanstack/react-router';
import {
  Brain,
  ChartBar,
  ClockCounterClockwise,
  Gear,
  MagnifyingGlass,
  ShieldCheck,
} from '@phosphor-icons/react';
import { Kbd, Sheet } from '@/ui';
import { cn } from '@/lib/cn';
import { shortcutLabel } from '@/lib/keyboard';
import { useMe } from '@/auth';
import { strings } from '@/features/account/strings';
import { openCommandMenu } from '@/features/command/CommandMenu';
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher';
import { SourcesSection } from '@/features/sources/SourcesSection';
import { ConversationsSection } from '@/features/chat/ConversationsSection';
import { icons, labels } from './navItems';

/**
 * Workspace navigation. Sections are filled in by their features (conversations, sources,
 * study); this file owns only the frame and the primary links. Collapsed (tablet) it is a
 * column of icons.
 */
export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  const { isAdmin, isGuest } = useMe();
  const links = [
    { to: '/w/$workspaceId' as const, label: labels.chat, Icon: icons.chat },
    { to: '/w/$workspaceId/sources' as const, label: labels.sources, Icon: icons.sources },
    { to: '/w/$workspaceId/graph' as const, label: labels.graph, Icon: icons.graph },
    { to: '/w/$workspaceId/study' as const, label: labels.study, Icon: icons.study },
  ];
  // Pages outside the workspace. Guests have no memory; admin is for admins only.
  const account = [
    ...(isGuest ? [] : [{ to: '/memory' as const, label: strings.nav.memory, Icon: Brain }]),
    { to: '/usage' as const, label: strings.nav.usage, Icon: ChartBar },
    { to: '/settings' as const, label: strings.nav.settings, Icon: Gear },
    ...(isAdmin ? [{ to: '/admin' as const, label: strings.nav.admin, Icon: ShieldCheck }] : []),
  ];
  const itemClass = (extra: string) =>
    cn(
      'flex items-center gap-2.5 rounded-sm text-sm text-ink-2 hover:bg-paper-3 hover:text-ink',
      '[&.active]:bg-paper-3 [&.active]:font-medium [&.active]:text-ink',
      collapsed ? 'h-10 justify-center' : 'min-h-9 px-2 py-1.5',
      extra,
    );
  return (
    // The outer element stretches to the page so the tint runs full height; the inner one
    // sticks to the viewport and scrolls on its own when the lists are long.
    <nav
      aria-label="Workspace"
      className={cn('shrink-0 bg-paper-2/60', collapsed ? 'w-14' : 'w-64')}
    >
      <div className="sticky top-0 flex h-full max-h-dvh flex-col overflow-y-auto pb-3">
        <WorkspaceSwitcher collapsed={collapsed} />
        <div className="px-2 pb-1">
          <button
            type="button"
            onClick={openCommandMenu}
            aria-label={collapsed ? labels.search : undefined}
            title={collapsed ? `${labels.search} (${shortcutLabel('mod+k')})` : undefined}
            className={cn(itemClass('w-full text-ink-3'), !collapsed && 'justify-between')}
          >
            <span className="flex items-center gap-2.5">
              <MagnifyingGlass size={collapsed ? 20 : 18} aria-hidden className="shrink-0" />
              {!collapsed && 'Search'}
            </span>
            {!collapsed && <Kbd>{shortcutLabel('mod+k')}</Kbd>}
          </button>
        </div>
        <ul className={cn('space-y-0.5 px-2', collapsed && 'mt-1')}>
          {links.map(({ to, label, Icon }) => (
            <li key={to}>
              <Link
                to={to}
                params={{ workspaceId }}
                activeOptions={{ exact: to === '/w/$workspaceId' }}
                aria-label={collapsed ? label : undefined}
                title={collapsed ? label : undefined}
                className={itemClass('')}
              >
                <Icon size={collapsed ? 20 : 18} aria-hidden className="shrink-0" />
                {!collapsed && label}
              </Link>
            </li>
          ))}
        </ul>
        {collapsed ? (
          <Library workspaceId={workspaceId} className="mx-2 my-3" />
        ) : (
          <div className="my-5 space-y-6">
            <ConversationsSection workspaceId={workspaceId} collapsed={false} />
            <SourcesSection workspaceId={workspaceId} collapsed={false} />
          </div>
        )}
        <ul className="mx-2 mt-auto space-y-0.5 border-t border-rule pt-2">
          {account.map(({ to, label, Icon }) => (
            <li key={to}>
              <Link
                to={to}
                aria-label={collapsed ? label : undefined}
                title={collapsed ? label : undefined}
                className={itemClass('')}
              >
                <Icon size={collapsed ? 20 : 18} aria-hidden className="shrink-0" />
                {!collapsed && label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/**
 * Collapsed, the lists don't fit beside the page, so one rail button opens them in a panel.
 * The panel is open only for the page it was opened on, so following a link closes it.
 */
export function Library({ workspaceId, className }: { workspaceId: string; className?: string }) {
  // Every navigation gets its own history key, so even a link to this same page closes it.
  const href = useLocation({ select: (l) => `${l.href}#${l.state.__TSR_key ?? ''}` });
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === href;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpenedOn(href)}
        aria-label={labels.library}
        title={labels.library}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-3 hover:text-ink',
          className,
        )}
      >
        <ClockCounterClockwise size={20} aria-hidden />
      </button>
      <Sheet
        open={open}
        onOpenChange={(next) => setOpenedOn(next ? href : null)}
        title={labels.library}
        side="left"
        width={320}
      >
        <div className="space-y-6 py-3">
          <ConversationsSection workspaceId={workspaceId} collapsed={false} />
          <SourcesSection workspaceId={workspaceId} collapsed={false} />
        </div>
      </Sheet>
    </>
  );
}
