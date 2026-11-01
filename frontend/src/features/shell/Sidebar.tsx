import { useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import {
  Brain,
  ChartBar,
  Gear,
  MagnifyingGlass,
  ShieldCheck,
  SidebarSimple,
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
import { shellStrings } from './strings';

const navClass = (collapsed: boolean) =>
  cn(
    'flex items-center gap-2.5 rounded-sm text-sm text-ink-2 hover:bg-paper-3 hover:text-ink',
    '[&.active]:bg-paper-3 [&.active]:font-medium [&.active]:text-ink',
    '[@media(pointer:coarse)]:min-h-11',
    collapsed ? 'h-10 justify-center' : 'min-h-9 px-2 py-1.5',
  );

/**
 * Workspace navigation: the switcher, the primary links, the conversations and sources lists,
 * and the pages that sit beside the workspaces. Collapsed (tablet) it is a column of icons
 * with one button that opens the whole thing over the page.
 */
export function Sidebar({ workspaceId, collapsed }: { workspaceId: string; collapsed: boolean }) {
  return (
    // The outer element stretches to the page so the tint runs full height; the inner one
    // sticks to the viewport and scrolls on its own when the lists are long.
    <nav
      aria-label="Workspace"
      className={cn('shrink-0 bg-paper-2/60', collapsed ? 'w-14' : 'w-64')}
    >
      <div className="sticky top-0 flex h-full max-h-dvh flex-col overflow-y-auto pb-3">
        <WorkspaceSwitcher workspaceId={workspaceId} collapsed={collapsed} />
        <SidebarBody workspaceId={workspaceId} collapsed={collapsed} />
        {collapsed && <Library workspaceId={workspaceId} full className="mx-2 my-3" />}
      </div>
    </nav>
  );
}

function SidebarBody({ workspaceId, collapsed }: { workspaceId: string; collapsed: boolean }) {
  const { isAdmin, isGuest } = useMe();
  const links = [
    { to: '/w/$workspaceId' as const, label: labels.chat, Icon: icons.chat },
    { to: '/w/$workspaceId/sources' as const, label: labels.sources, Icon: icons.sources },
    { to: '/w/$workspaceId/graph' as const, label: labels.graph, Icon: icons.graph },
    { to: '/w/$workspaceId/study' as const, label: labels.study, Icon: icons.study },
  ];
  // Guests have no memory; admin is for admins only.
  const account = [
    ...(isGuest ? [] : [{ to: '/memory' as const, label: strings.nav.memory, Icon: Brain }]),
    { to: '/usage' as const, label: strings.nav.usage, Icon: ChartBar },
    { to: '/settings' as const, label: strings.nav.settings, Icon: Gear },
    ...(isAdmin ? [{ to: '/admin' as const, label: strings.nav.admin, Icon: ShieldCheck }] : []),
  ];
  const size = collapsed ? 20 : 18;
  return (
    <>
      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={openCommandMenu}
          aria-label={collapsed ? labels.search : undefined}
          title={collapsed ? `${labels.search} (${shortcutLabel('mod+k')})` : undefined}
          className={cn(navClass(collapsed), 'w-full text-ink-3', !collapsed && 'justify-between')}
        >
          <span className="flex items-center gap-2.5">
            <MagnifyingGlass size={size} aria-hidden className="shrink-0" />
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
              className={navClass(collapsed)}
            >
              <Icon size={size} aria-hidden className="shrink-0" />
              {!collapsed && label}
            </Link>
          </li>
        ))}
      </ul>
      {!collapsed && (
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
              className={navClass(collapsed)}
            >
              <Icon size={size} aria-hidden className="shrink-0" />
              {!collapsed && label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The button that brings back what the narrow layouts leave out. On a tablet it opens the
 * whole sidebar over the page; on a phone it opens the conversations and sources, since the
 * bottom tabs already cover the links. The panel is open only for the page it was opened on,
 * so following a link inside it closes it.
 */
export function Library({
  workspaceId,
  full,
  className,
}: {
  workspaceId: string;
  full?: boolean;
  className?: string;
}) {
  // Every navigation gets its own history key, so even a link to this same page closes it.
  const href = useLocation({ select: (l) => `${l.href}#${l.state.__TSR_key ?? ''}` });
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === href;
  const label = full ? shellStrings.library.open : shellStrings.library.title;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpenedOn(href)}
        aria-label={label}
        title={label}
        className={cn(
          'flex size-10 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-3 hover:text-ink',
          'max-sm:size-11',
          className,
        )}
      >
        <SidebarSimple size={20} aria-hidden />
      </button>
      <Sheet
        open={open}
        onOpenChange={(next) => setOpenedOn(next ? href : null)}
        title={shellStrings.library.title}
        side="left"
        width={320}
      >
        {full ? (
          <div className="flex min-h-full flex-col pb-3">
            <SidebarBody workspaceId={workspaceId} collapsed={false} />
          </div>
        ) : (
          <div className="space-y-6 py-3">
            <ConversationsSection workspaceId={workspaceId} collapsed={false} />
            <SourcesSection workspaceId={workspaceId} collapsed={false} />
          </div>
        )}
      </Sheet>
    </>
  );
}
