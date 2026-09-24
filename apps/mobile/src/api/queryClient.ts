import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/api/errors';

/** Retry only transient failures (network / 5xx / 429 handled by UI), never 4xx business errors. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isApiError(error)) return true;
  if (error.isNetworkError) return true;
  return error.statusCode >= 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();

export const queryKeys = {
  me: ['me'] as const,
  summary: ['summary'] as const,
  balance: ['balance'] as const,
  ledger: ['ledger'] as const,
  feed: ['feed'] as const,
  ad: (id: string) => ['ad', id] as const,
  offers: (type: string) => ['offers', type] as const,
  survey: (id: string) => ['survey', id] as const,
  appInstall: (id: string) => ['appInstall', id] as const,
  offerCompletions: ['offerCompletions'] as const,
  withdrawalConfig: ['withdrawalConfig'] as const,
  withdrawals: ['withdrawals'] as const,
  withdrawal: (id: string) => ['withdrawal', id] as const,
  notifications: ['notifications'] as const,
};

/** Everything that changes when coins move. Balance is the only source of truth, so refetch it. */
export function invalidateMoney(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.balance }),
    client.invalidateQueries({ queryKey: queryKeys.summary }),
    client.invalidateQueries({ queryKey: queryKeys.ledger }),
    client.invalidateQueries({ queryKey: queryKeys.me }),
  ]);
}
