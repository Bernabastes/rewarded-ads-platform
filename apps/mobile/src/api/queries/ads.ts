import type { OfferType } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';

import { adsApi } from '@/api/endpoints/ads';
import { offersApi } from '@/api/endpoints/offers';
import { queryKeys } from '@/api/queryClient';

import { PAGE_SIZE, usePaginatedQuery } from './users';

export function useFeed(enabled = true) {
  return usePaginatedQuery(queryKeys.feed, (page) => adsApi.feed({ page, limit: PAGE_SIZE }), {
    enabled,
    staleTime: 20_000,
  });
}

export function useAd(adId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ad(adId ?? ''),
    queryFn: () => adsApi.detail(adId as string),
    enabled: Boolean(adId),
  });
}

export function useOffers(type: OfferType | 'all', enabled = true) {
  return usePaginatedQuery(
    queryKeys.offers(type),
    (page) => offersApi.list({ page, limit: PAGE_SIZE, type: type === 'all' ? undefined : type }),
    { enabled, staleTime: 20_000 },
  );
}

export function useSurvey(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.survey(id ?? ''),
    queryFn: () => offersApi.survey(id as string),
    enabled: Boolean(id),
  });
}

export function useAppInstallOffer(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.appInstall(id ?? ''),
    queryFn: () => offersApi.appInstall(id as string),
    enabled: Boolean(id),
  });
}
