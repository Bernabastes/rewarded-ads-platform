import type { AdminMe } from '@rap/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { Toaster } from 'sonner';
import { authStore, tokenStore } from '@/lib/api/api';
import { TooltipProvider } from '@/components/ui/primitives';
import { tokens } from './msw/fixtures';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } } });
}

/** Put the singleton auth store into an authenticated (or anonymous) state for a test. */
export function signInAs(admin: AdminMe | null): void {
  if (admin) {
    tokenStore.set(tokens());
    authStore.setState({ status: 'authenticated', admin, lastLogoutReason: null });
  } else {
    tokenStore.clear();
    authStore.setState({ status: 'anonymous', admin: null, lastLogoutReason: null });
  }
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  admin?: AdminMe | null;
  /** Initial URL; the element is mounted at `path` (default "*"). */
  route?: string;
  path?: string;
  extraRoutes?: RouteObject[];
  queryClient?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, { admin = null, route = '/', path = '*', extraRoutes = [], queryClient = createTestQueryClient(), ...options }: RenderWithProvidersOptions = {}) {
  signInAs(admin);
  const router = createMemoryRouter([{ path, element: ui }, ...extraRoutes], { initialEntries: [route] });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const result = render(<RouterProvider router={router} />, { wrapper: Wrapper, ...options });
  return { ...result, router, queryClient };
}
