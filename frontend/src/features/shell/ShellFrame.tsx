import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { MagnifyingGlass, NotePencil } from '@phosphor-icons/react';
import { Button } from '@/ui';
import { useBreakpoint } from '@/lib/breakpoints';
import type { ViewerTarget } from '@/lib/viewerParams';
import { CommandMenu, openCommandMenu } from '@/features/command/CommandMenu';
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher';
import { en } from '@/i18n/en';
import { GuestBar } from './GuestBar';
import { PhoneTabs } from './PhoneTabs';
import { Library, Sidebar } from './Sidebar';
import { ViewerLayout } from '@/features/viewer/ViewerLayout';
import { ViewerFallback } from './ViewerFallback';

// The viewer is its own chunk: pdf.js and Shiki only load once something is cited.
const ViewerPane = lazy(() => import('@/features/viewer/ViewerPane'));

/**
 * The frame around every page of a workspace and the account pages beside it. Three panes on
 * desktop (navigation, the page, the viewer), two on tablet with the viewer over the page,
 * and on phones a full-screen page with bottom tabs and the viewer as a sheet.
 */
export function ShellFrame({
  workspaceId,
  target,
  children,
}: {
  workspaceId: string;
  /** What the viewer shows, if the address names a citation. */
  target?: ViewerTarget;
  children: ReactNode;
}) {
  const bp = useBreakpoint();

  if (bp === 'phone') {
    return (
      <div className="flex min-h-dvh flex-col">
        <GuestBar />
        <div className="flex min-h-12 items-center border-b border-rule pr-[max(0.25rem,env(safe-area-inset-right))] pl-[env(safe-area-inset-left)]">
          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher workspaceId={workspaceId} collapsed={false} />
          </div>
          <Library workspaceId={workspaceId} />
          <Button asChild variant="ghost" className="w-11 shrink-0">
            <Link to="/w/$workspaceId" params={{ workspaceId }} aria-label={en.nav.newChat}>
              <NotePencil size={22} aria-hidden />
            </Link>
          </Button>
          <Button
            variant="ghost"
            className="w-11 shrink-0"
            onClick={openCommandMenu}
            aria-label={en.nav.search}
          >
            <MagnifyingGlass size={20} aria-hidden />
          </Button>
        </div>
        <main
          id="main"
          className="flex flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] [@media(max-height:480px)]:pb-[calc(2.75rem+env(safe-area-inset-bottom))]"
        >
          {children}
        </main>
        <PhoneTabs workspaceId={workspaceId} />
        <CommandMenu />
        {target && (
          <Suspense fallback={<ViewerFallback presentation="sheet" />}>
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
        <Sidebar workspaceId={workspaceId} collapsed={bp === 'tablet'} />
        <ViewerLayout
          main={
            <main id="main" className="relative flex min-w-0 flex-1 flex-col border-l border-rule">
              {children}
              {target && bp === 'tablet' && (
                // The panel overlays the page and manages its own scrim and focus.
                <Suspense fallback={<ViewerFallback presentation="panel" />}>
                  <ViewerPane target={target} presentation="panel" />
                </Suspense>
              )}
            </main>
          }
          viewer={
            target && bp === 'desktop' ? (
              <Suspense fallback={<ViewerFallback presentation="pane" />}>
                <ViewerPane target={target} presentation="pane" />
              </Suspense>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
