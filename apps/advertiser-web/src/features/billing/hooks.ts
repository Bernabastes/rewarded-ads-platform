import type { CreateTopupDto } from '@rap/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { billingApi } from '@/lib/api';
import { queryKeys } from '@/lib/query/keys';

export function useWalletBalance(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.billing.balance,
    queryFn: billingApi.balance,
    enabled: options.enabled ?? true,
  });
}

export function usePayments(page: number, limit = 10) {
  return useQuery({
    queryKey: queryKeys.billing.payments({ page, limit }),
    queryFn: () => billingApi.payments({ page, limit }),
    placeholderData: keepPreviousData,
  });
}

export function usePayment(id: string | null, options: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: queryKeys.billing.payment(id ?? ''),
    queryFn: () => billingApi.payment(id!),
    enabled: !!id,
    refetchInterval: options.refetchInterval ?? false,
  });
}

export function useInvoices(page: number, limit = 10) {
  return useQuery({
    queryKey: queryKeys.billing.invoices({ page, limit }),
    queryFn: () => billingApi.invoices({ page, limit }),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string) {
  return useQuery({ queryKey: queryKeys.billing.invoice(id), queryFn: () => billingApi.invoice(id) });
}

export function useLedger(page: number, limit = 10) {
  return useQuery({
    queryKey: queryKeys.billing.ledger({ page, limit }),
    queryFn: () => billingApi.ledger({ page, limit }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateTopup() {
  return useMutation({ mutationFn: (dto: CreateTopupDto) => billingApi.createTopup(dto) });
}

export function useInvalidateBilling() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.billing.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      ]),
    [queryClient],
  );
}
