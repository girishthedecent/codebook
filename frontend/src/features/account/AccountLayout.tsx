import type { ReactNode } from 'react';
import { Link, Outlet, useLocation, useRouteContext } from '@tanstack/react-router';
import { useMe } from '@/auth';
import { BackLink, LinkTab, LinkTabs, Wordmark } from '@/ui';
import { cn } from '@/lib/cn';
import { CommandMenu } from '@/features/command/CommandMenu';
import { ShellFrame } from '@/features/shell/ShellFrame';
import { shellStrings } from '@/features/shell/strings';
import { strings } from './strings';

/**
 * Frame for the pages that don't belong to one workspace (memory, usage, settings, admin).
 * They open inside the same frame as the workspaces, with the sidebar or the phone tabs of
 * the workspace last in use. Someone with no workspace yet gets a plain page with the same
 * links across the top.
 */
export function AccountLayout() {
  const { shellWorkspaceId } = useRouteContext({ from: '/_account' });
  // Admin pages have tables and charts that need the room.
  const wide = useLocation({ select: (l) => l.pathname.startsWith('/admin') });
  const page = (
    <div
      className={cn(
        'mx-auto w-full px-4 py-6 sm:px-8 sm:py-10',
        wide ? 'max-w-wide' : 'max-w-narrow',
      )}
    >
      <Outlet />
    </div>
  );

  if (shellWorkspaceId) return <ShellFrame workspaceId={shellWorkspaceId}>{page}</ShellFrame>;
  return <PlainFrame>{page}</PlainFrame>;
}

function PlainFrame({ children }: { children: ReactNode }) {
  const { isAdmin, isGuest } = useMe();
  return (
    <div className="min-h-dvh">
      <header className="flex min-h-14 items-center justify-between gap-4 border-b border-rule px-4 sm:px-8">
        <Link to="/w" aria-label="CodeBook" className="flex min-h-11 items-center">
          <Wordmark />
        </Link>
        <BackLink to="/w">
          {isGuest ? shellStrings.backToDemo : strings.layout.backFallback}
        </BackLink>
      </header>
      <div className="mx-auto w-full max-w-wide px-4 pt-4 sm:px-8">
        <LinkTabs label={strings.layout.nav}>
          {!isGuest && <LinkTab to="/memory">{strings.nav.memory}</LinkTab>}
          <LinkTab to="/usage">{strings.nav.usage}</LinkTab>
          <LinkTab to="/settings">{strings.nav.settings}</LinkTab>
          {isAdmin && <LinkTab to="/admin">{strings.nav.admin}</LinkTab>}
        </LinkTabs>
      </div>
      <main id="main">{children}</main>
      <CommandMenu />
    </div>
  );
}
