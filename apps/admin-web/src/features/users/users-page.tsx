import type { AdminUserListItem, UserStatus } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Flag, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { usersApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useDebouncedValue } from '@/lib/hooks/use-misc';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatDateTime, formatRelative } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/feedback';
import { Input, Label, NativeSelect, SearchInput } from '@/components/ui/input';
import { Initials, PageHeader } from '@/components/ui/page';
import { Checkbox, Tooltip } from '@/components/ui/primitives';

const defaults = { q: '' as string, status: '' as string, minTrustScore: '' as string, maxTrustScore: '' as string, flagged: false, page: 1, limit: 25 };

export function TrustScore({ value, className }: { value: number; className?: string }) {
  const tone = value < 30 ? 'bg-danger' : value < 50 ? 'bg-accent' : value < 70 ? 'bg-warning' : 'bg-success';
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className="tabular text-xs font-medium">{value}</span>
    </span>
  );
}

export function UsersPage() {
  const navigate = useNavigate();
  const { params, set, reset } = useListParams(defaults);
  const [search, setSearch] = useState(params.q);
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== params.q) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const queryParams = useMemo(
    () => ({
      q: params.q || undefined,
      status: (params.status || undefined) as UserStatus | undefined,
      minTrustScore: params.minTrustScore !== '' ? Number(params.minTrustScore) : undefined,
      maxTrustScore: params.maxTrustScore !== '' ? Number(params.maxTrustScore) : undefined,
      page: params.page,
      limit: params.limit,
    }),
    [params.q, params.status, params.minTrustScore, params.maxTrustScore, params.page, params.limit],
  );
  const list = useQuery({ queryKey: queryKeys.users(queryParams), queryFn: () => usersApi.list(queryParams), placeholderData: (prev) => prev });

  // "Has open flags" is not a server filter; apply it to the current page and say so.
  const rows = useMemo(() => (params.flagged ? list.data?.data.filter((u) => u.openFlags > 0) : list.data?.data), [list.data, params.flagged]);

  const columns = useMemo<ColumnDef<AdminUserListItem, unknown>[]>(
    () => [
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Initials name={row.original.fullName} />
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.fullName ?? <span className="text-fg-subtle">Profile incomplete</span>}</div>
              <div className="font-mono text-2xs text-fg-subtle">{row.original.phoneNumber}</div>
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <StatusBadge status={row.original.status} />
            {row.original.statusReason ? <span className="max-w-48 truncate text-2xs text-fg-subtle">{row.original.statusReason}</span> : null}
          </div>
        ),
        size: 160,
      },
      { id: 'trust', header: 'Trust', cell: ({ row }) => <TrustScore value={row.original.trustScore} />, size: 120 },
      { id: 'balance', header: 'Balance', meta: { align: 'right', numeric: true }, cell: ({ row }) => <span>{formatCoins(row.original.coinBalance)}</span>, size: 110 },
      {
        id: 'flags',
        header: 'Open flags',
        meta: { align: 'center' },
        cell: ({ row }) =>
          row.original.openFlags > 0 ? (
            <Badge tone="danger" className="gap-1 tabular">
              <Flag className="size-3" /> {row.original.openFlags}
            </Badge>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
        size: 100,
      },
      {
        id: 'age',
        header: 'Age check',
        cell: ({ row }) => <StatusBadge status={row.original.ageVerificationStatus === 'verified_adult' ? 'verified' : row.original.ageVerificationStatus} size="sm" />,
        size: 110,
      },
      {
        id: 'lastLogin',
        header: 'Last login',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.lastLoginAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.lastLoginAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
      {
        id: 'created',
        header: 'Joined',
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

  const hasFilters = Boolean(params.q || params.status || params.minTrustScore !== '' || params.maxTrustScore !== '' || params.flagged);

  return (
    <div className="space-y-3">
      <PageHeader title="Users" description="Search by phone or name, inspect trust and flag history, suspend or ban with a reason.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Label htmlFor="user-search" className="mb-1">
              Search
            </Label>
            <SearchInput id="user-search" value={search} onValueChange={setSearch} placeholder="+2519… or name" autoFocus />
          </div>
          <div>
            <Label htmlFor="user-status" className="mb-1">
              Status
            </Label>
            <NativeSelect id="user-status" value={params.status} onChange={(e) => set({ status: e.target.value })} className="w-36">
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="banned">Banned</option>
            </NativeSelect>
          </div>
          <div>
            <Label className="mb-1" htmlFor="trust-min">
              Trust score
            </Label>
            <div className="flex items-center gap-1">
              <Input id="trust-min" type="number" min={0} max={100} placeholder="min" className="w-20 tabular" value={params.minTrustScore} onChange={(e) => set({ minTrustScore: e.target.value })} aria-label="Minimum trust score" />
              <span className="text-fg-subtle">–</span>
              <Input type="number" min={0} max={100} placeholder="max" className="w-20 tabular" value={params.maxTrustScore} onChange={(e) => set({ maxTrustScore: e.target.value })} aria-label="Maximum trust score" />
            </div>
          </div>
          <div className="pb-1.5">
            <Checkbox id="flagged-only" checked={params.flagged} onCheckedChange={(v) => set({ flagged: v === true })} label="Has open flags" description="Filters the current page" />
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
        onRowClick={(u) => navigate(`/users/${u.id}`)}
        emptyState={<EmptyState compact icon={Users} title="No users found" description={hasFilters ? 'Try a different phone number, name or filter.' : 'Users appear here once they sign up in the app.'} />}
        aria-label="Users"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />
    </div>
  );
}
