import { useQuery } from '@tanstack/react-query';
import type { NavCounterKey } from '@/app/navigation';
import { homeApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';

export type QueueCounters = Partial<Record<NavCounterKey, number>>;

/**
 * Live queue sizes for sidebar badges and overview tiles. Since Phase 4C `GET /admin/overview` also carries the
 * Phase 4 queues (`pendingKyc`, `openAlerts`, `pendingDeletionRequests`), so a single request feeds every badge.
 */
export function useQueueCounters(): { counters: QueueCounters; isLoading: boolean; refetch: () => void } {
  const overview = useQuery({ queryKey: queryKeys.overview, queryFn: homeApi.overview, staleTime: 30_000, refetchInterval: 60_000 });

  const o = overview.data;
  const counters: QueueCounters = {
    pendingAdReviews: o?.pendingAdReviews,
    pendingCampaignReviews: o?.pendingCampaignReviews,
    pendingAdvertiserVerifications: o?.pendingAdvertiserVerifications,
    withdrawalsAwaitingReview: o?.withdrawalsAwaitingReview,
    pendingCoinAdjustments: o?.pendingCoinAdjustments,
    openFraudFlags: o?.openFraudFlags,
    openAdReports: o?.openAdReports,
    pendingKyc: o?.pendingKyc,
    openAlerts: o?.openAlerts,
    pendingDeletionRequests: o?.pendingDeletionRequests,
  };

  return {
    counters,
    isLoading: overview.isPending,
    refetch: () => {
      void overview.refetch();
    },
  };
}
