import type { Paginated, PaginationMeta } from '@rap/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';

import { usersApi } from '@/api/endpoints/users';
import { invalidateMoney, queryKeys } from '@/api/queryClient';
import { useAuthStore } from '@/auth/authStore';

export const PAGE_SIZE = 20;

export function nextPageParam<T, M extends PaginationMeta>(last: Paginated<T, M>): number | undefined {
  const loaded = last.meta.page * last.meta.limit;
  return loaded < last.meta.total ? last.meta.page + 1 : undefined;
}

/** Generic helper for `?page&limit` endpoints. */
export function usePaginatedQuery<T, M extends PaginationMeta = PaginationMeta>(
  key: QueryKey,
  fetcher: (page: number) => Promise<Paginated<T, M>>,
  options: { enabled?: boolean; staleTime?: number } = {},
) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetcher(pageParam),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
    enabled: options.enabled,
    staleTime: options.staleTime,
  });
}

export function useMe(enabled = true) {
  const setUser = useAuthStore((s) => s.setUser);
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const user = await usersApi.me();
      setUser(user);
      return user;
    },
    enabled,
  });
}

export function useSummary(enabled = true) {
  return useQuery({ queryKey: queryKeys.summary, queryFn: usersApi.summary, enabled, staleTime: 15_000 });
}

/** The only source of truth for the coin balance. */
export function useBalance(enabled = true) {
  return useQuery({ queryKey: queryKeys.balance, queryFn: usersApi.balance, enabled, staleTime: 10_000 });
}

export function useLedger(enabled = true) {
  return usePaginatedQuery(queryKeys.ledger, (page) => usersApi.ledger({ page, limit: PAGE_SIZE }), {
    enabled,
  });
}

export function useNotifications(enabled = true) {
  return usePaginatedQuery(
    queryKeys.notifications,
    (page) => usersApi.notifications({ page, limit: PAGE_SIZE }),
    { enabled, staleTime: 15_000 },
  );
}

export function useUpdateProfile() {
  const client = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return useMutation({
    mutationFn: usersApi.update,
    onSuccess: (user) => {
      setUser(user);
      client.setQueryData(queryKeys.me, user);
    },
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: usersApi.markNotificationRead,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.notifications });
      void client.invalidateQueries({ queryKey: queryKeys.summary });
    },
  });
}

export function useReportAd() {
  return useMutation({ mutationFn: usersApi.reportAd });
}

export function useInvalidateMoney() {
  const client = useQueryClient();
  return () => invalidateMoney(client);
}
