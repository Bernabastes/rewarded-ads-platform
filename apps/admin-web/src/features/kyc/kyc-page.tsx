import type { AdminKycSummary, KycIdType, KycStatus } from '@rap/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCheck, FlaskConical, IdCard } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { kycApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { parseProviderResult, preCheckVerdict } from '@/lib/domain/kyc-rules';
import { useHotkeys } from '@/lib/hooks/use-hotkeys';
import { useListParams } from '@/lib/hooks/use-list-params';
import { useDebouncedValue } from '@/lib/hooks/use-misc';
import { cn } from '@/lib/utils/cn';
import { formatDate, formatDateTime, formatPercent, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { EmptyState, Kbd } from '@/components/ui/feedback';
import { Label, NativeSelect, SearchInput } from '@/components/ui/input';
import { Initials, PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';
import type { DocKind } from './kyc-documents';
import { KycSheet } from './kyc-sheet';

const TABS: Array<{ value: KycStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
const ID_TYPES: KycIdType[] = ['fayda', 'national_id', 'passport'];

const defaults = { status: 'pending' as string, idType: '' as string, q: '' as string, page: 1, limit: 50 };

export function KycPage() {
  const { kycId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canDecide = can('kyc');
  const { params, set, reset } = useListParams(defaults);
  const status = (TABS.some((t) => t.value === params.status) ? params.status : 'pending') as KycStatus;
  const [search, setSearch] = useState(params.q);
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== params.q) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    // Keep the box in sync when the palette / a link sets ?q= (but never while the user is still typing).
    if (params.q !== debounced) setSearch(params.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q]);

  const queryParams = useMemo(
    () => ({ status, idType: (params.idType || undefined) as KycIdType | undefined, q: params.q || undefined, page: params.page, limit: params.limit }),
    [status, params.idType, params.q, params.page, params.limit],
  );
  const list = useQuery({ queryKey: queryKeys.kycQueue(queryParams), queryFn: () => kycApi.list(queryParams), refetchInterval: status === 'pending' ? 30_000 : false, placeholderData: (p) => p });
  const rows = useMemo(() => list.data?.data ?? [], [list.data]);

  // Drawer + dialog state lives here so the page-level hotkeys can drive it.
  const [zoom, setZoom] = useState<DocKind | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  useEffect(() => {
    setZoom(null);
    setApproveOpen(false);
    setRejectOpen(false);
  }, [kycId]);

  const select = useCallback((id: string | null) => navigate({ pathname: id ? `/kyc/${id}` : '/kyc', search: window.location.search }, { replace: Boolean(kycId) && Boolean(id) }), [navigate, kycId]);

  const onDecided = (id: string, result: AdminKycSummary) => {
    const index = rows.findIndex((r) => r.id === id);
    const next = rows[index + 1] ?? rows[index - 1];
    if (status === 'pending') {
      // Optimistic removal from the pending queue; the invalidation right after confirms it.
      queryClient.setQueryData(queryKeys.kycQueue(queryParams), (old: typeof list.data) =>
        old ? { ...old, data: old.data.filter((r) => r.id !== id), meta: { ...old.meta, total: Math.max(0, old.meta.total - 1) } } : old,
      );
      select(next?.id ?? null);
    } else {
      queryClient.setQueryData(queryKeys.kycQueue(queryParams), (old: typeof list.data) => (old ? { ...old, data: old.data.map((r) => (r.id === id ? { ...r, ...result } : r)) } : old));
    }
  };

  const selectedIndex = rows.findIndex((r) => r.id === kycId);
  const move = (delta: number) => {
    if (!rows.length) return;
    const idx = selectedIndex < 0 ? (delta > 0 ? -1 : 0) : selectedIndex;
    const next = rows[Math.min(rows.length - 1, Math.max(0, idx + delta))];
    if (next && next.id !== kycId) select(next.id);
  };
  const selected = rows.find((r) => r.id === kycId);
  const dialogOpen = approveOpen || rejectOpen || zoom !== null;
  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      arrowdown: (e) => {
        e.preventDefault();
        move(1);
      },
      arrowup: (e) => {
        e.preventDefault();
        move(-1);
      },
      a: () => {
        if (kycId && selected?.status === 'pending' && canDecide) setApproveOpen(true);
      },
      r: () => {
        if (kycId && selected?.status === 'pending' && canDecide) setRejectOpen(true);
      },
      z: () => {
        if (kycId) setZoom('front');
      },
    },
    { enabled: !dialogOpen },
  );

  const columns = useMemo<ColumnDef<AdminKycSummary, unknown>[]>(
    () => [
      {
        id: 'submitted',
        header: status === 'pending' ? 'Waiting' : 'Submitted',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Initials name={row.original.user.fullName ?? row.original.fullName} />
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.user.fullName ?? <span className="text-fg-subtle">Profile incomplete</span>}</div>
              <div className="font-mono text-2xs text-fg-subtle">
                {row.original.user.phoneNumber} · trust {row.original.user.trustScore}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'document',
        header: 'Document',
        cell: ({ row }) => (
          <div>
            <div className="flex items-center gap-1.5">
              <Badge tone="neutral">{humanize(row.original.idType)}</Badge>
              <span className="font-mono text-xs text-fg-muted">•••• {row.original.idNumberLast4}</span>
            </div>
            <div className="mt-0.5 truncate text-xs text-fg-muted">
              {row.original.fullName} · {formatDate(row.original.dateOfBirth)}
            </div>
          </div>
        ),
        size: 230,
      },
      {
        id: 'precheck',
        header: 'Pre-check',
        cell: ({ row }) => {
          const p = parseProviderResult(row.original.providerResult);
          const v = preCheckVerdict(p);
          if (!p || !v) return <span className="text-fg-subtle">—</span>;
          return (
            <span className="inline-flex items-center gap-1">
              <Badge tone={v === 'strong' ? 'success' : v === 'weak' ? 'warning' : 'danger'} size="sm" className="tabular">
                {v === 'not_found' ? 'not found' : v === 'error' ? 'error' : formatPercent(p.score, 0)}
              </Badge>
              {p.mock ? (
                <Tooltip content="Mock registry provider (ID_VERIFICATION_PROVIDER=mock)">
                  <FlaskConical className="size-3 text-warning" aria-label="mock" />
                </Tooltip>
              ) : null}
            </span>
          );
        },
        size: 110,
      },
      { id: 'tier', header: 'Tier', cell: ({ row }) => <Badge tone={row.original.user.kycTier === 'id_verified' ? 'success' : 'outline'} size="sm">{humanize(row.original.user.kycTier)}</Badge>, size: 110 },
      ...(status !== 'pending'
        ? [
            { id: 'status', header: 'Decision', cell: ({ row }) => <StatusBadge status={row.original.status} />, size: 120 } as ColumnDef<AdminKycSummary, unknown>,
            {
              id: 'reviewed',
              header: 'Reviewed',
              cell: ({ row }) => <span className="whitespace-nowrap text-xs text-fg-muted">{formatDateTime(row.original.reviewedAt)}</span>,
              size: 150,
            } as ColumnDef<AdminKycSummary, unknown>,
          ]
        : []),
    ],
    [status],
  );

  const hasFilters = Boolean(params.q || params.idType);

  return (
    <div className="space-y-3">
      <PageHeader
        title="KYC queue"
        description="Review identity documents. Approving promotes the user to id-verified; rejecting sends them your reason."
        actions={
          <div className="hidden items-center gap-1.5 text-xs text-fg-subtle md:flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> navigate · <Kbd>A</Kbd> approve · <Kbd>R</Kbd> reject · <Kbd>Z</Kbd> zoom
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Tabs value={status} onValueChange={(v) => set({ status: v, page: 1 })}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                  {t.value === 'pending' && status === 'pending' && list.data ? (
                    <Badge tone="accent" size="sm" className="tabular">
                      {list.data.meta.total}
                    </Badge>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div>
            <Label htmlFor="kyc-idtype" className="mb-1">
              Id type
            </Label>
            <NativeSelect id="kyc-idtype" value={params.idType} onChange={(e) => set({ idType: e.target.value })} className="w-36">
              <option value="">Any</option>
              {ID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="w-64">
            <Label htmlFor="kyc-q" className="mb-1">
              Search
            </Label>
            <SearchInput id="kyc-q" value={search} onValueChange={setSearch} placeholder="phone, name or last 4 digits" />
          </div>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                reset();
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => select(r.id)}
        selectedRowId={kycId ?? null}
        rowClassName={(r) => cn(parseProviderResult(r.providerResult) && preCheckVerdict(parseProviderResult(r.providerResult)) !== 'strong' && status === 'pending' && 'bg-warning/5')}
        emptyState={
          <EmptyState
            compact
            icon={status === 'pending' ? CheckCheck : IdCard}
            title={status === 'pending' ? 'No pending submissions' : `No ${status} submissions`}
            description={hasFilters ? 'Try another id type or search term.' : status === 'pending' ? 'New identity submissions from the app appear here automatically.' : 'Decisions will show up here once made.'}
          />
        }
        aria-label="KYC submissions"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />

      <KycSheet
        id={kycId ?? null}
        initial={selected}
        onClose={() => select(null)}
        onDecided={onDecided}
        canDecide={canDecide}
        zoom={zoom}
        onZoomChange={setZoom}
        approveOpen={approveOpen}
        onApproveOpenChange={setApproveOpen}
        rejectOpen={rejectOpen}
        onRejectOpenChange={setRejectOpen}
      />
    </div>
  );
}
