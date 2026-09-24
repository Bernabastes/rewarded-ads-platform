import type { CampaignStatus } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { campaignsApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useListParams } from '@/lib/hooks/use-list-params';
import { Button } from '@/components/ui/button';
import { PaginationBar } from '@/components/ui/data-table';
import { IdChip, PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { CampaignsTable } from './campaigns-table';

const TABS: Array<{ value: CampaignStatus | 'all'; label: string }> = [
  { value: 'pending_review', label: 'Pending review' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'draft', label: 'Draft' },
  { value: 'all', label: 'All' },
];

const defaults = { status: 'pending_review' as string, advertiserId: '' as string, page: 1, limit: 25 };

export function CampaignsPage() {
  const { params, set } = useListParams(defaults);
  const status = TABS.some((t) => t.value === params.status) ? params.status : 'pending_review';
  const queryParams = useMemo(
    () => ({ status: status === 'all' ? undefined : (status as CampaignStatus), advertiserId: params.advertiserId || undefined, page: params.page, limit: params.limit }),
    [status, params.advertiserId, params.page, params.limit],
  );
  const list = useQuery({ queryKey: queryKeys.campaigns(queryParams), queryFn: () => campaignsApi.list(queryParams), placeholderData: (p) => p });

  return (
    <div className="space-y-3">
      <PageHeader title="Campaigns" description="Approve pending campaigns, pause live ones, and inspect fraud-filtered performance.">
        <Tabs value={status} onValueChange={(v) => set({ status: v, page: 1 })}>
          <TabsList className="h-auto flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>
      {params.advertiserId ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          Filtered to advertiser <IdChip id={params.advertiserId} to={`/advertisers/${params.advertiserId}`} />
          <Button variant="link" size="xs" onClick={() => set({ advertiserId: '' })}>
            Clear
          </Button>
        </div>
      ) : null}
      <CampaignsTable
        rows={list.data?.data}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={status === 'pending_review' ? 'No campaigns awaiting review' : 'No campaigns'}
        emptyDescription={status === 'pending_review' ? 'Advertisers submit campaigns here once the budget is reserved from their wallet.' : 'Nothing with this status.'}
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />
    </div>
  );
}
