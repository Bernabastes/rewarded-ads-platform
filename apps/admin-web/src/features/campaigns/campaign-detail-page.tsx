import type { AdSummary } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, Pause, Play, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { campaignsApi } from '@/lib/api/endpoints';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { formatDate, formatDateTime, formatDuration, formatEtb, formatEtbBare, formatInt, formatPercent, formatShortDate, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { ReasonDialog } from '@/components/ui/confirm';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { IdChip, PageHeader, Progress } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat';
import { CHART_COLORS, ChartTooltip } from '@/features/fraud/fraud-charts';

type Action = 'approve' | 'reject' | 'pause' | 'resume';

export function CampaignDetailPage() {
  const { campaignId = '' } = useParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: queryKeys.campaign(campaignId), queryFn: () => campaignsApi.detail(campaignId), enabled: Boolean(campaignId) });
  const c = q.data;
  const [action, setAction] = useState<Action | null>(null);

  const mutate = useMutation({
    mutationFn: ({ kind, text }: { kind: Action; text: string }) =>
      kind === 'approve' ? campaignsApi.approve(campaignId, text || undefined) : kind === 'reject' ? campaignsApi.reject(campaignId, text) : kind === 'pause' ? campaignsApi.pause(campaignId, text) : campaignsApi.resume(campaignId),
    onSuccess: (res, { kind }) => {
      toast.success({ approve: 'Campaign approved', reject: 'Campaign rejected', pause: 'Campaign paused', resume: 'Campaign resumed' }[kind], {
        description: kind === 'reject' ? 'Unspent reserved budget was refunded to the advertiser wallet.' : kind === 'pause' ? 'Ads are removed from the feed until resumed.' : undefined,
      });
      queryClient.setQueryData(queryKeys.campaign(campaignId), res);
      void queryClient.invalidateQueries({ queryKey: ['campaigns', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      setAction(null);
    },
    onError: (err) => toast.error('Action failed', { description: describeError(err) }),
  });

  const adColumns = useMemo<ColumnDef<AdSummary, unknown>[]>(
    () => [
      {
        id: 'title',
        header: 'Creative',
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-14 shrink-0 overflow-hidden rounded bg-stone-900">{row.original.thumbnailUrl ? <img src={row.original.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}</div>
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.title}</div>
              <div className="text-2xs text-fg-subtle">
                {humanize(row.original.mediaType)} Â· {formatDuration(row.original.durationSeconds)} Â· {row.original.attentionQuestionsCount} question{row.original.attentionQuestionsCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        ),
      },
      { id: 'status', header: 'Review', cell: ({ row }) => <StatusBadge status={row.original.reviewStatus} />, size: 120 },
      { id: 'reason', header: 'Rejection reason', cell: ({ row }) => <span className="text-xs text-danger">{row.original.rejectionReason ?? ''}</span> },
      { id: 'reviewed', header: 'Reviewed', cell: ({ row }) => <span className="text-xs text-fg-muted">{formatDateTime(row.original.reviewedAt)}</span>, size: 150 },
      {
        id: 'open',
        header: '',
        cell: ({ row }) =>
          can('adDetail') ? (
            <Link to={`/review/${row.original.id}?status=${row.original.reviewStatus}`} className="text-xs font-medium text-primary hover:underline">
              {row.original.reviewStatus === 'pending' ? 'Review' : 'Open'}
            </Link>
          ) : null,
        size: 70,
      },
    ],
    [can],
  );

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load campaign" />;

  const canDecide = can('campaignDecide');
  const canPause = can('campaignPauseResume');
  const t = c?.analytics.totals;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: 'Campaigns', to: '/campaigns' }, { label: c?.title ?? 'â€¦' }]}
        title={
          c ? (
            <span className="flex flex-wrap items-center gap-2">
              {c.title} <StatusBadge status={c.status} /> <Badge tone="outline">{humanize(c.targetActionType)}</Badge>
            </span>
          ) : (
            <Skeleton className="h-7 w-72" />
          )
        }
        description={
          c ? (
            <>
              by{' '}
              <Link to={`/advertisers/${c.advertiserId}`} className="font-medium text-fg hover:text-primary hover:underline">
                {c.advertiser?.businessName ?? 'advertiser'}
              </Link>{' '}
              Â· created {formatDate(c.createdAt)}
              {c.startDate ? ` Â· runs ${formatDate(c.startDate)}${c.endDate ? ` â†’ ${formatDate(c.endDate)}` : ' onwards'}` : ''}
            </>
          ) : undefined
        }
        actions={
          c ? (
            <>
              {c.status === 'pending_review' && canDecide ? (
                <>
                  <Button variant="outline" onClick={() => setAction('reject')}>
                    <X className="size-4 text-danger" /> Reject
                  </Button>
                  <Button variant="success" onClick={() => setAction('approve')}>
                    <Check className="size-4" /> Approve campaign
                  </Button>
                </>
              ) : null}
              {c.status === 'active' && canPause ? (
                <Button variant="outline" onClick={() => setAction('pause')}>
                  <Pause className="size-4 text-warning" /> Pause
                </Button>
              ) : null}
              {c.status === 'paused' && canPause ? (
                <Button variant="primary" onClick={() => setAction('resume')}>
                  <Play className="size-4" /> Resume
                </Button>
              ) : null}
              {(c.status === 'active' || c.status === 'paused') && canDecide ? (
                <Button variant="ghost" onClick={() => setAction('reject')}>
                  <X className="size-4 text-danger" /> Reject & refund
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {c?.status === 'rejected' && c.rejectionReason ? (
        <div className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-sm">
          <span className="font-medium">Rejected:</span> {c.rejectionReason}
        </div>
      ) : null}
      {c?.status === 'paused' ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span className="font-medium">Paused</span> ({humanize(c.pausedReason)}). {c.pausedReason === 'admin_paused' ? 'The advertiser cannot resume this; only an admin can.' : 'The advertiser paused it and can resume from their portal.'}
        </div>
      ) : null}
      {c?.status === 'pending_review' && c.approvedAdsCount === 0 && c.adsCount > 0 && c.targetActionType === 'video_view' ? (
        <div className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm">
          None of this campaignâ€™s {c.adsCount} creative{c.adsCount === 1 ? ' is' : 's are'} approved yet - approving the campaign does not approve its ads. Review them in the ad queue first or in parallel.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Spend" value={t ? Number(t.spendEtb) : undefined} format={(v) => formatEtb(v)} loading={!c} tone="primary" hint={c ? `of ${formatEtb(c.budgetEtb)} budget Â· ${formatEtb(c.remainingEtb)} left` : undefined} />
        <StatCard label="Valid completions" value={t?.validCompletions} loading={!c} tone="success" hint={t ? `${formatInt(t.uniqueUsers)} unique users` : undefined} />
        <StatCard label="Raw completions" value={t?.rawCompletions} loading={!c} hint={t ? `${formatInt(t.rawViews)} watch sessions started` : undefined} />
        <StatCard label="Fraud-filtered" value={t ? t.fraudFilteredRate * 100 : undefined} format={(v) => `${v.toFixed(1)}%`} loading={!c} tone="accent" hint={t ? `${formatInt(t.flaggedCompletions)} flagged Â· ${formatInt(t.rejectedCompletions)} rejected` : undefined} />
        <StatCard label="Reward / action" value={c ? Number(c.rewardPerActionEtb) : undefined} format={(v) => formatEtb(v)} loading={!c} hint={c ? `${formatInt(c.rewardCoins)} coins Â· advertiser pays ${formatEtb(c.costPerActionEtb)}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Daily performance" description="Valid vs. raw completions and spend, last 30 days." />
          <CardBody className="h-60 p-2 pr-4">
            {c ? (
              c.analytics.daily.some((d) => d.rawCompletions > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={c.analytics.daily} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gValid" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={formatShortDate} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip labelFormatter={formatShortDate} />} />
                    <Area type="monotone" dataKey="rawCompletions" name="raw" stroke={CHART_COLORS.muted} fill="transparent" strokeDasharray="4 3" />
                    <Area type="monotone" dataKey="validCompletions" name="valid" stroke={CHART_COLORS.primary} fill="url(#gValid)" strokeWidth={2} />
                    <Area type="monotone" dataKey="rejectedCompletions" name="rejected" stroke={CHART_COLORS.danger} fill="transparent" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState compact title="No activity yet" description="Completions will chart here once the campaign is live." />
              )
            ) : (
              <Skeleton className="h-full w-full" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            {c ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-fg-muted">Budget used</span>
                    <span className="tabular font-medium">{formatPercent(Number(c.budgetEtb) ? Number(c.spentEtb) / Number(c.budgetEtb) : 0, 0)}</span>
                  </div>
                  <Progress value={Number(c.spentEtb)} max={Number(c.budgetEtb) || 1} />
                </div>
                <DescriptionList
                  columns={1}
                  items={[
                    { label: 'Description', value: c.description ?? 'â€”' },
                    { label: 'Budget', value: `${formatEtb(c.budgetEtb)} (spent ${formatEtbBare(c.spentEtb)})` },
                    { label: 'Cost per action', value: formatEtb(c.costPerActionEtb) },
                    { label: 'User reward', value: `${formatEtb(c.rewardPerActionEtb)} = ${formatInt(c.rewardCoins)} coins` },
                    { label: 'Attention check', value: c.attentionCheckEnabled ? 'Enabled' : 'Disabled' },
                    { label: 'Creatives', value: `${c.approvedAdsCount} approved / ${c.adsCount}` },
                    { label: 'Campaign id', value: <IdChip id={c.id} length={36} /> },
                  ]}
                />
              </div>
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Creatives" description="Each creative is reviewed individually against the banned-topics checklist." />
        <CardBody className="p-0">
          <DataTable columns={adColumns} data={c?.ads} getRowId={(r) => r.id} isLoading={!c} emptyState={<EmptyState compact title="No creatives" description="The advertiser has not uploaded any media for this campaign." />} aria-label="Campaign creatives" />
        </CardBody>
      </Card>

      {c ? (
        <ReasonDialog
          open={action !== null}
          onOpenChange={(o) => !o && setAction(null)}
          destructive={action === 'reject'}
          optional={action === 'approve' || action === 'resume'}
          reasonLabel={action === 'approve' ? 'Note' : 'Reason'}
          title={{ approve: 'Approve campaign', reject: 'Reject campaign', pause: 'Pause campaign', resume: 'Resume campaign' }[action ?? 'approve']}
          description={
            action === 'approve'
              ? 'The campaign becomes active. Only approved creatives are served, so review them in the ad queue too.'
              : action === 'reject'
                ? 'The campaign is rejected and any unspent reserved budget is refunded to the advertiserâ€™s wallet.'
                : action === 'pause'
                  ? 'Ads stop serving immediately. The advertiser cannot resume an admin-paused campaign.'
                  : 'Ads start serving again.'
          }
          confirmLabel={{ approve: 'Approve', reject: 'Reject & refund', pause: 'Pause', resume: 'Resume' }[action ?? 'approve']}
          confirmVariant={action === 'approve' ? 'success' : action === 'reject' ? 'danger' : 'primary'}
          loading={mutate.isPending}
          onConfirm={(text) => { if (action) mutate.mutate({ kind: action, text }); }}
        />
      ) : null}
    </div>
  );
}
