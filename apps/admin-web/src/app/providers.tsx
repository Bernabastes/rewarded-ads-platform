import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { toast, Toaster } from 'sonner';
import { describeError, isApiError } from '@/lib/api/errors';
import { useTheme } from '@/lib/hooks/use-theme';
import { TooltipProvider } from '@/components/ui/primitives';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Background refetch failures for data already on screen get a toast; initial failures render inline.
        if (query.state.data !== undefined && !(isApiError(error) && error.isAuth)) {
          toast.error('Could not refresh data', { description: describeError(error), id: `refetch-${String(query.queryKey[0])}` });
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 400)) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{ classNames: { toast: 'font-sans text-sm border shadow-pop', description: 'text-xs' } }}
    />
  );
}

export function AppProviders({ children, client }: { children: ReactNode; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300} skipDelayDuration={200}>
        {children}
        <ThemedToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
