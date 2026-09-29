import { useQuery } from '@tanstack/react-query';
import type { NavCounterKey } from '@/app/navigation';
import { alertsApi, deletionRequestsApi, homeApi, kycApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';

export type QueueCounters = Partial<Record<NavCounterKey, number>>;

/**
 * Live queue sizes for sidebar badges and overview tiles. `GET /admin/overview` covers the Phase 1-3 queues; the
 * Phase 4A queues are not part of it, so we read `meta.total` / `meta.openCount` of one-row list requests, each
 * only when the current role may call the endpoint.
 */
export function useQueueCounters(): { counters: QueueCounters; isLoading: boolean; refetch: () => void } {
  const { can } = useAuth();
  const overview = useQuery({ queryKey: queryKeys.overview, queryFn: homeApi.overview, staleTime: 30_000, refetchInterval: 60_000 });
  const kyc = useQuery({
    queryKey: queryKeys.kycQueue({ status: 'pending', limit: 1, counter: true }),
    queryFn: () => kycApi.list({ status: 'pending', limit: 1 }),
    enabled: can('kyc'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const alerts = useQuery({
    queryKey: queryKeys.alerts({ limit: 1, counter: true }),
    queryFn: () => alertsApi.list({ limit: 1 }),
    enabled: can('alerts'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const deletion = useQuery({
    queryKey: queryKeys.deletionRequests({ status: 'pending', limit: 1, counter: true }),
    queryFn: () => deletionRequestsApi.list({ status: 'pending', limit: 1 }),
    enabled: can('deletionRequests'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const o = overview.data;
  const counters: QueueCounters = {
    pendingAdReviews: o?.pendingAdReviews,
    pendingCampaignReviews: o?.pendingCampaignReviews,
    pendingAdvertiserVerifications: o?.pendingAdvertiserVerifications,
    withdrawalsAwaitingReview: o?.withdrawalsAwaitingReview,
    pendingCoinAdjustments: o?.pendingCoinAdjustments,
    openFraudFlags: o?.openFraudFlags,
    openAdReports: o?.openAdReports,
    pendingKyc: kyc.data?.meta.total,
    openAlerts: alerts.data?.meta.openCount,
    pendingDeletionRequests: deletion.data?.meta.total,
  };

  return {
    counters,
    isLoading: overview.isPending,
    refetch: () => {
      void overview.refetch();
      if (can('kyc')) void kyc.refetch();
      if (can('alerts')) void alerts.refetch();
      if (can('deletionRequests')) void deletion.refetch();
    },
  };
}
