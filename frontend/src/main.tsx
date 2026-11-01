import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { queryClient } from './api/queryClient';
import { NotFound } from './ui/NotFound';
import { RouteError } from './ui/RouteError';
import { Toaster } from './ui/Toast';
import { PendingScreen } from './features/shell/PendingScreen';
import './styles/base.css';

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0, // Query owns staleness; the router only triggers loads.
  scrollRestoration: true,
  // A page that takes more than a blink to load shows the branded screen instead of a blank one,
  // and keeps it just long enough not to flash.
  defaultPendingComponent: PendingScreen,
  defaultPendingMs: 400,
  defaultPendingMinMs: 300,
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: RouteError,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
