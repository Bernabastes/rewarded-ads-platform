import type { AdminAdvertiserItem, AdvertiserVerificationStatus } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { advertisersApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useDebouncedValue } from '@/lib/hooks/use-misc';
import { useListParams } from '@/lib/hooks/use-list-params';
import { formatDateTime, formatEtbBare, formatInt, formatRelative } from '@/lib/utils/format';
import { StatusBadge } from '@/components/ui/badge';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/feedback';
import { Label, SearchInput } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';

const TABS: Array<{ value: AdvertiserVerificationStatus | 'all'; label: string }> = [
  { value: 'pending', label: 'Pending verification' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

const defaults = { status: 'pending' as string, q: '' as string, page: 1, limit: 25 };

export function AdvertisersPage() {
  const navigate = useNavigate();
  const { params, set } = useListParams(defaults);
  const status = TABS.some((t) => t.value === params.status) ? params.status : 'pending';
  const [search, setSearch] = useState(params.q);
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== params.q) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const queryParams = useMemo(
    () => ({ status: status === 'all' ? undefined : (status as AdvertiserVerificationStatus), q: params.q || undefined, page: params.page, limit: params.limit }),
    [status, params.q, params.page, params.limit],
  );
  const list = useQuery({ queryKey: queryKeys.advertisers(queryParams), queryFn: () => advertisersApi.list(queryParams), placeholderData: (p) => p });

  const columns = useMemo<ColumnDef<AdminAdvertiserItem, unknown>[]>(
    () => [
      {
        id: 'business',
        header: 'Business',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.businessName}</div>
            <div className="truncate font-mono text-2xs text-fg-subtle">{row.original.businessRegistrationNumber}</div>
          </div>
        ),
      },
      {
        id: 'contact',
        header: 'Contact',
        cell: ({ row }) => (
          <div className="min-w-0 text-xs">
            <div className="truncate">{row.original.contactEmail}</div>
            <div className="font-mono text-2xs text-fg-subtle">{row.original.contactPhone}</div>
          </div>
        ),
      },
      { id: 'status', header: 'Verification', cell: ({ row }) => <StatusBadge status={row.original.verificationStatus} />, size: 130 },
      { id: 'campaigns', header: 'Campaigns', meta: { align: 'right', numeric: true }, cell: ({ row }) => formatInt(row.original.campaignsCount), size: 100 },
      { id: 'wallet', header: 'Wallet', meta: { align: 'right', numeric: true }, cell: ({ row }) => `ETB ${formatEtbBare(row.original.walletBalanceEtb)}`, size: 130 },
      { id: 'spend', header: 'Lifetime spend', meta: { align: 'right', numeric: true }, cell: ({ row }) => `ETB ${formatEtbBare(row.original.lifetimeSpendEtb)}`, size: 140 },
      {
        id: 'created',
        header: 'Registered',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
    ],
    [],
  );

  return (
    <div className="space-y-3">
      <PageHeader title="Advertisers" description="Verify business registrations before campaigns can go live; inspect wallets and campaigns.">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Tabs value={status} onValueChange={(v) => set({ status: v, page: 1 })}>
            <TabsList className="h-auto flex-wrap">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="w-72">
            <Label htmlFor="adv-search" className="sr-only">
              Search
            </Label>
            <SearchInput id="adv-search" value={search} onValueChange={setSearch} placeholder="Business, email or registration no." />
          </div>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(a) => navigate(`/advertisers/${a.id}`)}
        emptyState={<EmptyState compact icon={Building2} title={status === 'pending' ? 'No pending verifications' : 'No advertisers'} description={status === 'pending' ? 'New business registrations land here for a document check.' : 'Nothing matches the current filters.'} />}
        aria-label="Advertisers"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />
    </div>
  );
}
