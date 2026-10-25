import { Link, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from '@phosphor-icons/react';
import { workspaceQueryOptions } from '@/api/queries/workspaces';
import { useMe } from '@/auth';
import { en } from '@/i18n/en';
import { CommandMenu } from '@/features/command/CommandMenu';
import { strings } from './strings';
import { readLastWorkspaceId } from './lastWorkspaceId';

/**
 * Frame for the pages that don't belong to one workspace (memory, usage, settings).
 * Desktop and tablet get a short left nav; on phones the nav sits above the page as plain rows.
 */
export function AccountLayout() {
  return (
    <div className="min-h-dvh">
      <header className="flex h-12 items-center gap-4 border-b border-rule px-4">
        <Link to="/w" className="font-mono text-xs tracking-wide text-ink-2 hover:text-ink">
          {en.app.name}
        </Link>
        <BackLink />
      </header>
      <div className="mx-auto flex max-w-[1040px] flex-col min-[720px]:flex-row">
        <AccountNav />
        <main className="min-w-0 flex-1 px-4 py-6 min-[720px]:px-8 min-[720px]:py-10">
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
  if (id && name) {
    return (
      <Link
        to="/w/$workspaceId"
        params={{ workspaceId: id }}
        className="flex min-w-0 items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden className="shrink-0" />
        <span className="truncate">{strings.layout.back(name)}</span>
      </Link>
    );
  }
  return (
    <Link to="/w" className="flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
      <ArrowLeft size={14} aria-hidden />
      {strings.layout.backFallback}
    </Link>
  );
}

const linkClass =
  'block rounded-sm px-3 py-2 text-sm text-ink-2 hover:bg-paper-2 hover:text-ink ' +
  '[&.active]:font-medium [&.active]:text-ink max-[719px]:min-h-11 max-[719px]:py-2.5';

function AccountNav() {
  const { isAdmin, isGuest } = useMe();
  return (
    <nav
      aria-label={strings.layout.nav}
      className="shrink-0 border-b border-rule px-2 py-2 min-[720px]:w-52 min-[720px]:border-b-0 min-[720px]:py-10"
    >
      <ul className="flex gap-1 min-[720px]:flex-col">
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
