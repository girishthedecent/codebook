import { Outlet, useParams, useSearch } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { useBreakpoint } from '@/lib/breakpoints';
import { viewerTarget } from '@/lib/viewerParams';
import { Sidebar } from './Sidebar';
import { PhoneTabs } from './PhoneTabs';
import { GuestBar } from './GuestBar';
import { useRememberWorkspace } from '@/features/workspaces/lastWorkspace';
import { CommandMenu } from '@/features/command/CommandMenu';

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

  if (bp === 'phone') {
    return (
      <div className="flex min-h-dvh flex-col">
        <GuestBar />
        <main className="flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
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
        <main className="relative min-w-0 flex-1 border-l border-rule">
          <Outlet />
          {target && bp === 'tablet' && (
            <Suspense fallback={null}>
              <ViewerPane target={target} presentation="panel" />
            </Suspense>
          )}
        </main>
        {target && bp === 'desktop' && (
          <aside className="w-[min(42vw,640px)] shrink-0 border-l border-rule">
            <Suspense fallback={null}>
              <ViewerPane target={target} presentation="pane" />
            </Suspense>
          </aside>
        )}
      </div>
    </div>
  );
}
