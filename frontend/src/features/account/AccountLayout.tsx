import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MagnifyingGlass } from '@phosphor-icons/react';
import { workspaceQueryOptions } from '@/api/queries/workspaces';
import { useMe } from '@/auth';
import { cn } from '@/lib/cn';
import { en } from '@/i18n/en';
import { CommandMenu, openCommandMenu } from '@/features/command/CommandMenu';
import { strings } from './strings';
import { readLastWorkspaceId } from './lastWorkspaceId';

/**
 * Frame for the pages that don't belong to one workspace (memory, usage, settings).
 * Desktop and tablet get a short left nav; on phones the nav sits above the page as plain rows.
 */
export function AccountLayout() {
  // Admin pages have tables and charts that need the room, so they drop the side column
  // and put the same links in a row across the top.
  const wide = useLocation({ select: (l) => l.pathname.startsWith('/admin') });
  return (
    <div className="min-h-dvh">
      <header className="flex min-h-12 items-center gap-4 border-b border-rule px-4">
        <Link
          to="/w"
          className="flex shrink-0 items-center font-mono text-xs tracking-wide text-ink-2 hover:text-ink max-[719px]:min-h-11"
        >
          {en.app.name}
        </Link>
        <BackLink />
        {/* Phones have no keyboard shortcut for the command menu. */}
        <button
          type="button"
          onClick={openCommandMenu}
          aria-label={en.nav.search}
          className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:text-ink min-[720px]:hidden"
        >
          <MagnifyingGlass size={20} aria-hidden />
        </button>
      </header>
      <div
        className={cn(
          'mx-auto flex flex-col',
          wide ? 'max-w-[1200px]' : 'max-w-[1040px] min-[720px]:flex-row',
        )}
      >
        <AccountNav row={wide} />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 min-[720px]:px-8 min-[720px]:py-10">
          <Outlet />
        </main>
      </div>
      <CommandMenu />
    </div>
  );
}

function BackLink() {
  const id = readLastWorkspaceId();
  const workspace = useQuery({ ...workspaceQueryOptions(id ?? ''), enabled: Boolean(id) });
  const name = workspace.data?.name;
  // While the name loads, hold the slot rather than flashing the fallback and swapping.
  if (id && workspace.isPending) return <span className="h-5" aria-hidden />;
  if (id && name) {
    return (
      <Link
        to="/w/$workspaceId"
        params={{ workspaceId: id }}
        className="flex min-w-0 items-center gap-1.5 text-sm text-ink-2 hover:text-ink max-[719px]:min-h-11"
      >
        <ArrowLeft size={14} aria-hidden className="shrink-0" />
        <span className="truncate">{strings.layout.back(name)}</span>
      </Link>
    );
  }
  return (
    <Link
      to="/w"
      className="flex min-w-0 items-center gap-1.5 text-sm text-ink-2 hover:text-ink max-[719px]:min-h-11"
    >
      <ArrowLeft size={14} aria-hidden className="shrink-0" />
      <span className="truncate">{strings.layout.backFallback}</span>
    </Link>
  );
}

const linkClass =
  'block whitespace-nowrap rounded-sm px-3 py-2 text-sm text-ink-2 hover:bg-paper-2 hover:text-ink ' +
  '[&.active]:bg-paper-2 [&.active]:font-medium [&.active]:text-ink max-[719px]:min-h-11 max-[719px]:py-2.5';

function AccountNav({ row }: { row: boolean }) {
  const { isAdmin, isGuest } = useMe();
  return (
    <nav
      aria-label={strings.layout.nav}
      className={cn(
        'shrink-0 border-b border-rule px-2 py-2',
        !row && 'min-[720px]:w-52 min-[720px]:border-b-0 min-[720px]:py-10',
      )}
    >
      <ul className={cn('flex gap-1 overflow-x-auto', !row && 'min-[720px]:flex-col')}>
        {!isGuest && (
          <li>
            <Link to="/memory" className={linkClass}>
              {strings.nav.memory}
            </Link>
          </li>
        )}
        <li>
          <Link to="/usage" className={linkClass}>
            {strings.nav.usage}
          </Link>
        </li>
        <li>
          <Link to="/settings" className={linkClass}>
            {strings.nav.settings}
          </Link>
        </li>
        {isAdmin && (
          <li>
            <Link to="/admin" className={linkClass}>
              {strings.nav.admin}
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
