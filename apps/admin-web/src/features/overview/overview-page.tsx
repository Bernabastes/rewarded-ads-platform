import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowRight, Banknote, BellRing, Building2, Coins, Flag, IdCard, Megaphone, ShieldAlert, Smartphone, UserRoundX, Users, Video } from 'lucide-react';
import { Link } from 'react-router';
import { fraudApi, homeApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { useQueueCounters } from '@/lib/hooks/use-queue-counters';
import { formatEtbBare, formatInt, formatPercent } from '@/lib/utils/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat';
import { FraudTrendChart } from '@/features/fraud/fraud-charts';

export function OverviewPage() {
  const { admin, can } = useAuth();
  const overview = useQuery({ queryKey: queryKeys.overview, queryFn: homeApi.overview, refetchInterval: 30_000 });
  const fraud = useQuery({ queryKey: queryKeys.fraudMetrics, queryFn: fraudApi.metrics, enabled: can('fraud'), refetchInterval: 60_000 });
  const { counters } = useQueueCounters();
  const o = overview.data;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = admin?.fullName?.split(' ')[0] ?? admin?.email ?? '';

  const todayTotal = (o?.todayValidCompletions ?? 0) + (o?.todayFlaggedCompletions ?? 0);
  const todayFlaggedRate = todayTotal ? (o?.todayFlaggedCompletions ?? 0) / todayTotal : 0;

  const queues = [
    { key: 'reviewQueue' as const, label: 'Ads awaiting review', value: o?.pendingAdReviews, to: '/review', icon: Video, tone: 'accent' as const, hint: 'Approve against the banned-topics checklist' },
    { key: 'alerts' as const, label: 'Open alerts', value: counters.openAlerts, to: '/alerts', icon: BellRing, tone: 'danger' as const, hint: 'Ledger drift, payout failures, minting, OTP spikes', loading: counters.openAlerts === undefined },
    { key: 'kyc' as const, label: 'KYC submissions pending', value: counters.pendingKyc, to: '/kyc', icon: IdCard, tone: 'primary' as const, hint: 'Identity documents to review', loading: counters.pendingKyc === undefined },
    { key: 'campaigns' as const, label: 'Campaigns pending', value: o?.pendingCampaignReviews, to: '/campaigns?status=pending_review', icon: Megaphone, tone: 'warning' as const, hint: 'Campaign-level approvals' },
    { key: 'withdrawals' as const, label: 'Withdrawals held for review', value: o?.withdrawalsAwaitingReview, to: '/withdrawals?status=flagged_for_review', icon: Banknote, tone: 'accent' as const, hint: `${formatInt(o?.withdrawalsPendingPayout ?? 0)} queued / processing${o?.withdrawalsNeedingManualReview ? ` · ${formatInt(o.withdrawalsNeedingManualReview)} need manual review` : ''}` },
    { key: 'adjustments' as const, label: 'Coin adjustments awaiting 2nd approval', value: o?.pendingCoinAdjustments, to: '/adjustments?status=pending_approval', icon: Coins, tone: 'warning' as const, hint: 'Needs a different admin than the requester' },
    { key: 'fraud' as const, label: 'Open fraud flags', value: o?.openFraudFlags, to: '/fraud', icon: ShieldAlert, tone: 'danger' as const, hint: `${formatInt(o?.suspendedUsers ?? 0)} users suspended` },
    { key: 'deletionRequests' as const, label: 'Deletion requests pending', value: counters.pendingDeletionRequests, to: '/deletion-requests', icon: UserRoundX, tone: 'info' as const, hint: 'Grace period running; execute or cancel', loading: counters.pendingDeletionRequests === undefined },
    { key: 'adReports' as const, label: 'Open ad reports', value: o?.openAdReports, to: '/ad-reports', icon: Flag, tone: 'info' as const, hint: 'Submitted by users in the app' },
    { key: 'advertisers' as const, label: 'Advertisers to verify', value: o?.pendingAdvertiserVerifications, to: '/advertisers?status=pending', icon: Building2, tone: 'primary' as const, hint: 'Business registration checks' },
  ].filter((q) => can(q.key));

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${greeting}${firstName ? `, ${firstName}` : ''}`}
        description="What needs attention across the platform right now."
        actions={
          <Badge tone="outline" className="gap-1.5">
            <span className="size-1.5 animate-pulse rounded-full bg-success" aria-hidden /> Live · refreshes every 30s
          </Badge>
        }
      />

      {overview.isError ? <ErrorState error={overview.error} onRetry={() => void overview.refetch()} compact /> : null}

      <section aria-labelledby="queues-heading">
        <h2 id="queues-heading" className="mb-2 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
          Work queues
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {queues.map((q) => (
            <StatCard key={q.key} label={q.label} value={q.value} loading={'loading' in q ? q.loading : overview.isPending} icon={q.icon} tone={q.tone} to={q.to} hint={q.hint} />
          ))}
        </div>
      </section>

      <section aria-labelledby="today-heading">
        <h2 id="today-heading" className="mb-2 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
          Today (UTC)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Valid completions" value={o?.todayValidCompletions} loading={overview.isPending} icon={Activity} tone="success" hint="Rewards credited via the ledger" />
          <StatCard
            label="Flagged / rejected"
            value={o?.todayFlaggedCompletions}
            loading={overview.isPending}
            icon={ShieldAlert}
            tone="warning"
            hint={`${formatPercent(todayFlaggedRate)} of today’s ${formatInt(todayTotal)} completions`}
          />
          <StatCard
            label="Platform revenue"
            value={o ? Number(o.todayPlatformRevenueEtb) : undefined}
            format={(v) => `ETB ${formatEtbBare(v)}`}
            loading={overview.isPending}
            icon={Coins}
            tone="primary"
            hint="Advertiser spend minus user rewards"
            to={can('revenue') ? '/revenue' : undefined}
          />
          <StatCard label="Active users" value={o?.activeUsers} loading={overview.isPending} icon={Users} hint={`${formatInt(o?.activeCampaigns ?? 0)} active campaigns`} to={can('users') ? '/users' : undefined} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {can('fraud') ? (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Fraud filter - last 7 days"
              description={
                fraud.data ? `${formatPercent(fraud.data.weekly.flaggedRate)} of ${formatInt(fraud.data.weekly.rawCompletions)} completions were flagged or rejected` : 'Loading…'
              }
              actions={
                <Link to="/fraud" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Fraud dashboard <ArrowRight className="size-3" />
                </Link>
              }
            />
            <CardBody className="h-56 p-2 pr-4">{fraud.data ? <FraudTrendChart data={fraud.data.daily} /> : <Skeleton className="h-full w-full" />}</CardBody>
          </Card>
        ) : (
          <Card className="lg:col-span-2">
            <CardHeader title="Your access" description="Sections available to your role. Everything else is hidden and blocked by the API." />
            <CardBody className="grid gap-2 sm:grid-cols-2">
              {admin?.permissions.map((p) => (
                <div key={p} className="flex items-center gap-2 rounded-md border bg-sunken/40 px-3 py-2 text-sm">
                  <span className="size-1.5 rounded-full bg-success" aria-hidden />
                  <span className="font-mono text-xs">{p}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Shortcuts" description="Jump straight into a queue." />
          <CardBody className="space-y-1 p-2">
            {[
              { to: '/review', label: 'Review next ad', icon: Video, key: 'reviewQueue' as const },
              { to: '/kyc', label: 'Review KYC documents', icon: IdCard, key: 'kyc' as const },
              { to: '/alerts', label: 'Check open alerts', icon: BellRing, key: 'alerts' as const },
              { to: '/withdrawals?status=flagged_for_review', label: 'Held withdrawals', icon: Banknote, key: 'withdrawals' as const },
              { to: '/adjustments', label: 'New coin adjustment', icon: Coins, key: 'adjustments' as const },
              { to: '/fraud', label: 'Triage fraud flags', icon: ShieldAlert, key: 'fraud' as const },
              { to: '/users', label: 'Find a user', icon: Users, key: 'users' as const },
              { to: '/deletion-requests', label: 'Deletion requests', icon: UserRoundX, key: 'deletionRequests' as const },
              { to: '/app-installs', label: 'Verify app installs', icon: Smartphone, key: 'appInstalls' as const },
              { to: '/audit', label: 'Browse the audit log', icon: Activity, key: 'audit' as const },
            ]
              .filter((s) => can(s.key))
              .map((s) => (
                <Link key={s.to} to={s.to} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg hover:bg-sunken">
                  <s.icon className="size-4 text-fg-subtle" />
                  <span className="flex-1">{s.label}</span>
                  <ArrowRight className="size-3.5 text-fg-subtle" />
                </Link>
              ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
