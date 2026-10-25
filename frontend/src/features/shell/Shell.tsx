import { Link, Outlet, useParams, useSearch } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useBreakpoint } from '@/lib/breakpoints';
import { viewerTarget } from '@/lib/viewerParams';
import { Library, Sidebar } from './Sidebar';
import { PhoneTabs } from './PhoneTabs';
import { GuestBar } from './GuestBar';
import { useRememberWorkspace } from '@/features/workspaces/lastWorkspace';
import { CommandMenu, openCommandMenu } from '@/features/command/CommandMenu';
import { MagnifyingGlass, NotePencil } from '@phosphor-icons/react';
import { en } from '@/i18n/en';
import { isApiError } from '@/api/client';
import { useDemo } from '@/api/queries/demo';
import { useWorkspace } from '@/api/queries/workspaces';
import { NotFound } from '@/ui';
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher';

// The viewer is its own chunk: pdf.js and Shiki only load once something is cited.
const ViewerPane = lazy(() => import('@/features/viewer/ViewerPane'));

/**
 * Three panes on desktop (navigation · main · viewer), two on tablet with the viewer over the
 * main area, and on phones a full-screen main area with bottom tabs and the viewer as a sheet.
 * The viewer opens whenever the URL names a target; closing it clears those params.
 */
export function Shell() {
  const bp = useBreakpoint();
  const search = useSearch({ from: '/w/$workspaceId' });
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  useRememberWorkspace(workspaceId);
  const target = viewerTarget(search);

  // A workspace that is missing or belongs to someone else gets a plain page, not an empty
  // shell. The demo isn't served by workspace routes to visitors, so it is ruled out first.
  const workspace = useWorkspace(workspaceId);
  const demo = useDemo();
  const gone =
    (isApiError(workspace.error, 404) || isApiError(workspace.error, 403)) &&
    demo.isSuccess &&
    demo.data.workspace.id !== workspaceId;
  if (gone) return <NotFound />;

  if (bp === 'phone') {
    return (
      <div className="flex min-h-dvh flex-col">
        <GuestBar />
        <div className="flex h-12 items-center border-b border-rule pl-[env(safe-area-inset-left)] pr-[max(0.25rem,env(safe-area-inset-right))]">
          <div className="min-w-0 flex-1 [&>button]:h-12">
            <WorkspaceSwitcher collapsed={false} />
          </div>
          <Library workspaceId={workspaceId} className="size-11" />
          <Link
            to="/w/$workspaceId"
            params={{ workspaceId }}
            aria-label={en.nav.newChat}
            className="flex size-11 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2"
          >
            <NotePencil size={22} aria-hidden />
          </Link>
          <button
            type="button"
            onClick={openCommandMenu}
            aria-label={en.nav.search}
            className="flex size-10 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2"
          >
            <MagnifyingGlass size={20} aria-hidden />
          </button>
        </div>
        <main
          id="main"
          className="flex flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] [@media(max-height:480px)]:pb-[calc(2.5rem+env(safe-area-inset-bottom))]"
        >
          <Outlet />
        </main>
        <PhoneTabs />
        <CommandMenu />
        {target && (
          <Suspense fallback={null}>
            <ViewerPane target={target} presentation="sheet" />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <GuestBar />
      <CommandMenu />
      <div className="flex flex-1">
        <Sidebar collapsed={bp === 'tablet'} />
        <main id="main" className="relative flex min-w-0 flex-1 flex-col border-l border-rule">
          <Outlet />
          {target && bp === 'tablet' && (
            // The pane positions itself absolutely; a fixed frame keeps it on screen while the
            // page scrolls instead of spanning the whole document height.
            <div className="pointer-events-none fixed inset-0 z-30 [&>*]:pointer-events-auto">
              <Suspense fallback={null}>
                <ViewerPane target={target} presentation="panel" />
              </Suspense>
            </div>
          )}
        </main>
        {target && bp === 'desktop' && (
          // The pane brings its own sticky h-dvh; capped to the column so a guest bar above
          // doesn't push the page taller than the screen.
          <aside className="w-[min(42vw,640px)] shrink-0 border-l border-rule [&>*]:h-full! [&>*]:max-h-dvh!">
            <Suspense fallback={null}>
              <ViewerPane target={target} presentation="pane" />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  );
}
