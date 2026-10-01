import type { CreateWithdrawalDto, WithdrawalItem } from '@rap/shared';
import { WithdrawalStatus } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import { withdrawalsApi } from '@/api/endpoints/withdrawals';
import { invalidateMoney, queryKeys } from '@/api/queryClient';
import { submitWithdrawal, type SubmitWithdrawalResult } from '@/features/withdrawals/submitWithdrawal';

import { PAGE_SIZE, usePaginatedQuery } from './users';

export const ACTIVE_WITHDRAWAL_STATUSES = new Set<string>([
  WithdrawalStatus.pending,
  WithdrawalStatus.processing,
  WithdrawalStatus.flagged_for_review,
  WithdrawalStatus.needs_manual_review,
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

export interface CreateWithdrawalVariables {
  dto: CreateWithdrawalDto;
  /** Per-intent `Idempotency-Key` (see `createIntentKeys`); reused on retries of the same payload. */
  idempotencyKey: string;
  intentStartedAt?: number;
}

/**
 * `POST /withdrawals` through the idempotent submitter: a network retry with the same key replays the
 * original response, and a `409 IDEMPOTENCY_KEY_REUSED { inProgress: true }` polls the list instead of
 * posting twice.
 */
export function useCreateWithdrawal() {
  const client = useQueryClient();
  return useMutation<SubmitWithdrawalResult, unknown, CreateWithdrawalVariables>({
    mutationFn: ({ dto, idempotencyKey, intentStartedAt }) =>
      submitWithdrawal(
        {
          create: (body, key) => withdrawalsApi.create(body, key),
          listRecent: async () => (await withdrawalsApi.list({ page: 1, limit: 10 })).data,
          newKey: () => randomUUID(),
        },
        dto,
        idempotencyKey,
        intentStartedAt,
      ),
    onSuccess: ({ item }) => {
      client.setQueryData(queryKeys.withdrawal(item.id), item);
      void client.invalidateQueries({ queryKey: queryKeys.withdrawals });
      void client.invalidateQueries({ queryKey: queryKeys.withdrawalConfig });
      void invalidateMoney(client);
    },
  });
}
