import type { AdminReferralItem, ReferralStatus } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Coins, Gift, ShieldAlert, Smartphone, TrendingUp, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { referralsApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { useListParams } from '@/lib/hooks/use-list-params';
import { formatCoins, formatDateTime, formatEtb, formatInt, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { IdChip, PageHeader } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/stat';

const STATUSES: ReferralStatus[] = ['pending', 'qualified', 'paid', 'rejected'];

/** Rejection reasons are stable codes; explain them for the support desk. */
const REJECTION_HELP: Record<string, string> = {
  self_referral_device: 'Referee signed up on a device fingerprint already used by the referrer (self-referral).',
  self_referral_ip: 'Referee signed up from the referrer’s IP address.',
  referrer_daily_cap: 'Referrer already hit the daily paid-referral cap when the referee qualified.',
  referrer_inactive: 'Referrer was suspended / banned when the bonus was due.',
};

const defaults = { status: '' as string, referrerId: '' as string, refereeId: '' as string, page: 1, limit: 50 };

export function ReferralsPage() {
  const { can } = useAuth();
  const { params, set, reset } = useListParams(defaults);
  const queryParams = useMemo(
    () => ({ status: (params.status || undefined) as ReferralStatus | undefined, referrerId: params.referrerId || undefined, refereeId: params.refereeId || undefined, page: params.page, limit: params.limit }),
    [params.status, params.referrerId, params.refereeId, params.page, params.limit],
  );
  const metrics = useQuery({ queryKey: queryKeys.referralMetrics, queryFn: referralsApi.metrics, staleTime: 30_000 });
  const list = useQuery({ queryKey: queryKeys.referrals(queryParams), queryFn: () => referralsApi.list(queryParams), placeholderData: (p) => p });
  const m = metrics.data;
  const canOpenUsers = can('users');

  const userLink = (id: string, label: string) =>
    canOpenUsers ? (
      <Link to={`/users/${id}`} className="font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
        {label}
      </Link>
    ) : (
      <span className="font-medium">{label}</span>
    );

  const columns = useMemo<ColumnDef<AdminReferralItem, unknown>[]>(
    () => [
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} />, size: 110 },
      {
        id: 'referrer',
        header: 'Referrer',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate">{userLink(row.original.referrer.id, row.original.referrer.fullName ?? 'Unnamed')}</div>
            <div className="font-mono text-2xs text-fg-subtle">{row.original.referrer.phoneNumber}</div>
          </div>
        ),
      },
      {
        id: 'referee',
        header: 'Referee',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate">{userLink(row.original.referee.id, row.original.referee.displayName)}</div>
            <div className="font-mono text-2xs text-fg-subtle">
              {row.original.refereePhone} · joined {formatRelative(row.original.referee.joinedAt)}
            </div>
          </div>
        ),
      },
      {
        id: 'bonus',
        header: 'Bonus (referrer / referee)',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className={row.original.status === 'paid' ? 'font-medium text-success' : 'text-fg-muted'}>
            {formatCoins(row.original.referrerBonusCoins)} / {formatCoins(row.original.refereeBonusCoins)}
          </span>
        ),
        size: 170,
      },
      {
        id: 'reason',
        header: 'Rejection reason',
        cell: ({ row }) =>
          row.original.rejectionReason ? (
            <Tooltip content={REJECTION_HELP[row.original.rejectionReason] ?? row.original.rejectionReason}>
              <span>
                <Badge tone="danger" size="sm" className="gap-1">
                  <ShieldAlert className="size-2.5" /> {humanize(row.original.rejectionReason)}
                </Badge>
              </span>
            </Tooltip>
          ) : row.original.status === 'qualified' ? (
            <Tooltip content="First valid completion happened but the bonus is withheld (e.g. referrer daily cap); it pays on a later day or gets rejected.">
              <span>
                <Badge tone="warning" size="sm">
                  withheld
                </Badge>
              </span>
            </Tooltip>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
        size: 170,
      },
      {
        id: 'signup',
        header: 'Signup IP / device',
        cell: ({ row }) => (
          <div className="font-mono text-2xs text-fg-muted">
            <div>{row.original.signupIp ?? '—'}</div>
            <div className="flex items-center gap-1 truncate">
              <Smartphone className="size-2.5 shrink-0" /> {row.original.signupDeviceFingerprint ? `${row.original.signupDeviceFingerprint.slice(0, 12)}…` : '—'}
            </div>
          </div>
        ),
        size: 150,
      },
      {
        id: 'dates',
        header: 'Created / qualified / paid',
        cell: ({ row }) => (
          <div className="text-2xs text-fg-muted">
            <div>{formatDateTime(row.original.createdAt)}</div>
            <div>
              {row.original.qualifiedAt ? `Q ${formatDateTime(row.original.qualifiedAt)}` : 'not qualified'} {row.original.paidAt ? `· P ${formatDateTime(row.original.paidAt)}` : ''}
            </div>
          </div>
        ),
        size: 200,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canOpenUsers],
  );

  const hasFilters = Boolean(params.status || params.referrerId || params.refereeId);

  return (
    <div className="space-y-4">
      <PageHeader title="Referrals" description="Invite bonuses are credited with the referee’s first valid ad completion; self-referrals (shared device / IP) are rejected and flagged." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total referrals" value={m?.total} loading={!m} icon={Gift} hint={m ? STATUSES.map((s) => `${formatInt(m.byStatus[s] ?? 0)} ${s}`).join(' · ') : undefined} />
        <StatCard label="Paid" value={m?.byStatus.paid} loading={!m} tone="success" hint={m ? `${formatInt(m.byStatus.qualified ?? 0)} qualified but withheld` : undefined} />
        <StatCard label="Bonus coins paid" value={m?.bonusCoinsPaid} loading={!m} icon={Coins} tone="primary" hint={m ? `${formatEtb(m.bonusEtbPaid)} platform cost (not advertiser-funded)` : undefined} to={can('revenue') ? '/revenue' : undefined} />
        <StatCard label="Rejected" value={m?.byStatus.rejected} loading={!m} tone={m && m.byStatus.rejected > 0 ? 'danger' : 'default'} icon={ShieldAlert} hint="Self-referral or cap / status rules" />
        <StatCard label="Last 7 days" value={m?.last7Days.invited} loading={!m} icon={TrendingUp} tone="info" hint={m ? `${formatInt(m.last7Days.paid)} paid · ${formatInt(m.last7Days.rejected)} rejected` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="ref-status" className="mb-1">
                Status
              </Label>
              <NativeSelect id="ref-status" value={params.status} onChange={(e) => set({ status: e.target.value })} className="w-36">
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="ref-referrer" className="mb-1">
                Referrer user id
              </Label>
              <Input id="ref-referrer" value={params.referrerId} onChange={(e) => set({ referrerId: e.target.value.trim() })} placeholder="uuid" className="w-64 font-mono text-xs" />
            </div>
            <div>
              <Label htmlFor="ref-referee" className="mb-1">
                Referee user id
              </Label>
              <Input id="ref-referee" value={params.refereeId} onChange={(e) => set({ refereeId: e.target.value.trim() })} placeholder="uuid" className="w-64 font-mono text-xs" />
            </div>
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={reset}>
                Clear
              </Button>
            ) : null}
          </div>

          <DataTable
            columns={columns}
            data={list.data?.data}
            getRowId={(r) => r.id}
            isLoading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
            emptyState={<EmptyState compact icon={Gift} title="No referrals" description={hasFilters ? 'No referrals match these filters.' : 'Referrals appear once users share their code and friends sign up with it.'} />}
            aria-label="Referrals"
          />
          <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />
        </div>

        <Card className="self-start">
          <CardHeader title="Top referrers" description="By paid referrals, all time." actions={<Trophy className="size-4 text-fg-subtle" />} />
          {!m ? (
            <CardBody>
              <Skeleton className="h-40 w-full" />
            </CardBody>
          ) : m.topReferrers.length === 0 ? (
            <EmptyState compact title="Nobody paid yet" />
          ) : (
            <ul className="divide-y">
              {m.topReferrers.map((r, i) => (
                <li key={r.userId} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-4 text-right font-mono text-xs text-fg-subtle">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{userLink(r.userId, r.fullName ?? 'Unnamed')}</div>
                    <div className="font-mono text-2xs text-fg-subtle">{r.phoneNumber}</div>
                  </div>
                  <Button variant="link" size="xs" onClick={() => set({ referrerId: r.userId, status: '' })} aria-label={`Filter referrals by ${r.phoneNumber}`}>
                    {formatInt(r.paid)} paid
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t px-4 py-2 text-2xs text-fg-subtle">
            Filter by a user: <IdChip id={params.referrerId || null} /> {params.referrerId ? '' : 'paste an id above or click a name.'}
          </div>
        </Card>
      </div>
    </div>
  );
}
