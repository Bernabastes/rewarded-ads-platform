import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { TooltipProvider } from '@/components/ui/primitives';
import { AuthProvider } from '@/features/auth/auth-provider';
import { authStore } from '@/lib/api/auth-store';
import { profileFixture, tokensFixture } from './mocks/fixtures';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });
}

function Providers({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MotionConfig reducedMotion="always">
          <TooltipProvider>{children}</TooltipProvider>
        </MotionConfig>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export interface RenderWithAppOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL for the memory router (default "/"). */
  route?: string;
  /** Extra routes to register alongside the element under test (e.g. navigation targets). */
  routes?: RouteObject[];
  /** Path the element under test is mounted at (default matches `route`). */
  path?: string;
  authenticated?: boolean;
}

/** Render a component under the real providers and a memory router. */
export function renderWithApp(ui: ReactElement, { route = '/', routes = [], path, authenticated = false, ...options }: RenderWithAppOptions = {}) {
  if (authenticated) authStore.signIn(tokensFixture, profileFixture, true);
  const client = createTestQueryClient();
  const router = createMemoryRouter([{ path: path ?? route.split('?')[0], element: ui }, ...routes], { initialEntries: [route] });
  const result = render(<RouterProvider router={router} />, {
    wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    ...options,
  });
  return { ...result, router, client };
}
