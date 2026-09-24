import type { CampaignDetail, CampaignStatus, CampaignSummary, CreateAdDto, CreateCampaignDto, UpdateCampaignDto } from '@rap/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query/keys';

/** The API caps pages at 100; the portal fetches one large page and filters/sorts client-side. */
export const CAMPAIGN_LIST_LIMIT = 100;

export function useOverview() {
  return useQuery({ queryKey: queryKeys.overview, queryFn: campaignsApi.overview });
}

export function useCampaigns(params: { status?: CampaignStatus; page?: number; limit?: number } = {}) {
  const query = { page: params.page ?? 1, limit: params.limit ?? CAMPAIGN_LIST_LIMIT, status: params.status };
  return useQuery({
    queryKey: queryKeys.campaigns.list(query),
    queryFn: () => campaignsApi.list(query),
    placeholderData: keepPreviousData,
  });
}

const LIVE_STATUSES: CampaignStatus[] = ['active', 'pending_review'];

export function useCampaign(id: string | undefined, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.campaigns.detail(id ?? ''),
    queryFn: () => campaignsApi.detail(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      if (options.poll === false) return false;
      const status = query.state.data?.status;
      return status && LIVE_STATUSES.includes(status) ? 15_000 : false;
    },
  });
}

export function useCampaignAnalytics(id: string | undefined, range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: queryKeys.campaigns.analytics(id ?? '', range),
    queryFn: () => campaignsApi.analytics(id!, range),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useInvalidateCampaigns() {
  const queryClient = useQueryClient();
  return async (id?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.all }),
      id ? queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(id) }) : Promise.resolve(),
    ]);
  };
}

function useCampaignMutation<TVars, TData extends CampaignSummary | CampaignDetail | void>(
  fn: (vars: TVars) => Promise<TData>,
  getId?: (vars: TVars) => string,
) {
  const invalidate = useInvalidateCampaigns();
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: async (data, vars) => {
      const id = getId?.(vars) ?? (data && 'id' in data ? data.id : undefined);
      if (data && id && 'id' in data) {
        queryClient.setQueryData<CampaignDetail>(queryKeys.campaigns.detail(id), (prev) =>
          prev ? { ...prev, ...data } : prev,
        );
      }
      await invalidate(id);
    },
  });
}

export const useCreateCampaign = () => useCampaignMutation((dto: CreateCampaignDto) => campaignsApi.create(dto));
export const useUpdateCampaign = () =>
  useCampaignMutation(({ id, dto }: { id: string; dto: UpdateCampaignDto }) => campaignsApi.update(id, dto), (v) => v.id);
export const useSubmitCampaign = () => useCampaignMutation((id: string) => campaignsApi.submit(id), (id) => id);
export const usePauseCampaign = () => useCampaignMutation((id: string) => campaignsApi.pause(id), (id) => id);
export const useResumeCampaign = () => useCampaignMutation((id: string) => campaignsApi.resume(id), (id) => id);
export const useDeleteCampaign = () => useCampaignMutation((id: string) => campaignsApi.remove(id), (id) => id);

export function useAddAd() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: ({ campaignId, dto }: { campaignId: string; dto: CreateAdDto }) => campaignsApi.addAd(campaignId, dto),
    onSuccess: (_data, vars) => invalidate(vars.campaignId),
  });
}

export function useRemoveAd() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: ({ campaignId, adId }: { campaignId: string; adId: string }) => campaignsApi.removeAd(campaignId, adId),
    onSuccess: (_data, vars) => invalidate(vars.campaignId),
  });
}
