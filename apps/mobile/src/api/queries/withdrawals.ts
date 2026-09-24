import type { WithdrawalItem } from '@rap/shared';
import { WithdrawalStatus } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { withdrawalsApi } from '@/api/endpoints/withdrawals';
import { invalidateMoney, queryKeys } from '@/api/queryClient';

import { PAGE_SIZE, usePaginatedQuery } from './users';

export const ACTIVE_WITHDRAWAL_STATUSES = new Set<string>([
  WithdrawalStatus.pending,
  WithdrawalStatus.processing,
  WithdrawalStatus.flagged_for_review,
]);

export function isWithdrawalActive(item: WithdrawalItem | undefined): boolean {
  return Boolean(item && ACTIVE_WITHDRAWAL_STATUSES.has(item.status));
}

export function useWithdrawalConfig(enabled = true) {
  return useQuery({ queryKey: queryKeys.withdrawalConfig, queryFn: withdrawalsApi.config, enabled, staleTime: 60_000 });
}

export function useWithdrawals(enabled = true) {
  return usePaginatedQuery(queryKeys.withdrawals, (page) => withdrawalsApi.list({ page, limit: PAGE_SIZE }), {
    enabled,
    staleTime: 10_000,
  });
}

/** Polls every 5s while the request is still moving (pending / processing / under review). */
export function useWithdrawal(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.withdrawal(id ?? ''),
    queryFn: () => withdrawalsApi.detail(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => (isWithdrawalActive(query.state.data) ? 5000 : false),
    refetchIntervalInBackground: false,
  });
}

export function useCreateWithdrawal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: withdrawalsApi.create,
    onSuccess: (item) => {
      client.setQueryData(queryKeys.withdrawal(item.id), item);
      void client.invalidateQueries({ queryKey: queryKeys.withdrawals });
      void invalidateMoney(client);
    },
  });
}
