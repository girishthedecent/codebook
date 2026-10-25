import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { ConnectionBanner } from '@/features/shell/ConnectionBanner';
import { SkipLink, useRouteFocus } from '@/features/shell/RouteFocus';
import { useSessionExpiry } from '@/features/shell/useSessionExpiry';

export type RouterContext = {
  queryClient: QueryClient;
};

function Root() {
  useSessionExpiry();
  useRouteFocus();
  return (
    <>
      <SkipLink />
      <ConnectionBanner />
      <Outlet />
    </>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
});
