import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/api/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Never retry client errors (4xx); retry transient failures twice.
          if (isApiError(error) && error.statusCode >= 400 && error.statusCode < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: 0 },
    },
  });
}
