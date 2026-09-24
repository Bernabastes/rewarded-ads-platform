import type { CampaignAnalytics, CampaignSummary } from '@rap/shared';
import { Download, Eye, Layers, Users, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { StatCard } from '@/components/charts/stat-card';
import { EmptyDataIllustration } from '@/components/feedback/illustrations';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { PageTransition, Stagger } from '@/components/motion/motion';
import { Alert } from '@/components/ui/alert';
import { CampaignStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { ChartSkeleton, LoadingAnnouncer, Skeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { useCampaignAnalytics, useCampaigns, useOverview } from '@/features/campaigns/hooks';
import { downloadCsv, slugify, toCsv } from '@/lib/utils/csv';
import {
  addDaysIso,
  formatEtb,
  formatEtbNumber,
  formatNumber,
  formatPercent,
  todayIsoDate,
} from '@/lib/utils/format';
import { SpendChart, ViewsChart } from '@/features/dashboard/dashboard-charts';
import { AnalyticsSpendChart, CompletionsChart, Funnel } from './analytics-charts';
import { FraudFilterPanel, summarizeFraud } from './fraud-panel';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;

type RangeValue = (typeof RANGES)[number]['value'];

const ALL = 'all';

export function AnalyticsPage() {
  const { id: routeId } = useParams<{ id?: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const campaigns = useCampaigns();
  const rangeParam = params.get('range');
  const range: RangeValue = RANGES.some((r) => r.value === rangeParam) ? (rangeParam as RangeValue) : '30';
  const selectedId = routeId ?? ALL;

  const options = useMemo(
    () => [
      { value: ALL, label: 'All campaigns (overview)' },
      ...(campaigns.data?.data ?? []).map((c) => ({
        value: c.id,
        label: c.title,
        description: c.status.replace('_', ' '),
      })),
    ],
    [campaigns.data],
  );

  const onSelectCampaign = (value: string) => {
    const query = range !== '30' ? `?range=${range}` : '';
    navigate(value === ALL ? `/analytics${query}` : `/campaigns/${value}/analytics${query}`);
  };

  const onRange = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === '30') next.delete('range');
    else next.set('range', value);
    setParams(next, { replace: true });
  };

  const selectedCampaign = campaigns.data?.data.find((c) => c.id === routeId);

  return (
    <PageTransition className="flex flex-col gap-6">
      <PageHeader
        crumbs={
          routeId && selectedCampaign
            ? [
                { label: 'Campaigns', to: '/campaigns' },
                { label: selectedCampaign.title, to: `/campaigns/${routeId}` },
                { label: 'Analytics' },
              ]
            : undefined
        }
        title="Analytics"
        meta={selectedCampaign && <CampaignStatusBadge status={selectedCampaign.status} />}
        description="Raw numbers next to verified numbers, always. Verified completions are the only ones you are ever charged for."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Select
                value={selectedId}
                onValueChange={onSelectCampaign}
                options={options}
                aria-label="Choose campaign"
                disabled={campaigns.isPending}
              />
            </div>
            {routeId && (
              <Tabs value={range} onValueChange={onRange}>
                <TabsList aria-label="Date range">
                  {RANGES.map((r) => (
                    <TabsTrigger key={r.value} value={r.value}>
                      {r.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
          </div>
        }
      />
      {routeId ? (
        <CampaignAnalyticsView campaignId={routeId} campaign={selectedCampaign} rangeDays={Number(range)} />
      ) : (
        <OverviewAnalyticsView />
      )}
    </PageTransition>
  );
}

function CampaignAnalyticsView({
  campaignId,
  campaign,
  rangeDays,
}: {
  campaignId: string;
  campaign?: CampaignSummary;
  rangeDays: number;
}) {
  const today = todayIsoDate();
  const from = addDaysIso(today, -(rangeDays - 1));
  const analytics = useCampaignAnalytics(campaignId, { from, to: today });

  if (analytics.isPending) {
    return (
      <>
        <LoadingAnnouncer label="Loading analytics" />
        <Skeleton className="h-64 rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <Card>
          <CardContent>
            <ChartSkeleton />
          </CardContent>
        </Card>
      </>
    );
  }
  if (analytics.isError) {
    return (
      <Card>
        <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} />
      </Card>
    );
  }

  const data = analytics.data;
  const costPerAction =
    campaign?.costPerActionEtb ??
    (data.totals.validCompletions > 0 ? data.totals.spendEtb / data.totals.validCompletions : 0);
  const fraud = summarizeFraud(data.totals, costPerAction);
  const hasData = data.totals.rawViews > 0 || data.totals.rawCompletions > 0;

  return (
    <>
      <FraudFilterPanel summary={fraud} campaignTitle={campaign?.title} />

      {!hasData ? (
        <Card>
          <EmptyState
            illustration={<EmptyDataIllustration className="h-auto w-full" />}
            title="No activity in this period yet"
            description={
              campaign?.status === 'active'
                ? 'Viewers have not completed this campaign in the selected range. Try a wider range, or check back soon.'
                : 'Analytics fill in once the campaign is approved and viewers start watching.'
            }
          />
        </Card>
      ) : (
        <>
          <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Raw views"
              value={data.totals.rawViews}
              icon={Eye}
              tone="neutral"
              hint="Every watch session started"
            />
            <StatCard
              label="Verified completions"
              value={data.totals.validCompletions}
              icon={Layers}
              hint={`${formatNumber(data.totals.rawCompletions)} raw completions`}
            />
            <StatCard
              label="Unique viewers"
              value={data.totals.uniqueUsers}
              icon={Users}
              tone="info"
              hint="Distinct people reached"
            />
            <StatCard
              label="Spend"
              value={data.totals.spendEtb}
              format={(v) => `ETB ${formatEtbNumber(v, 0)}`}
              icon={Wallet}
              tone="accent"
              hint={`${formatEtb(data.totals.remainingEtb)} remaining of ${formatEtb(data.totals.budgetEtb)}`}
            />
          </Stagger>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Completions per day"
                description="Verified completions are billed; flagged and rejected ones are filtered before billing."
                action={<ExportButton analytics={data} title={campaign?.title ?? campaignId} />}
              />
              <CardContent>
                <CompletionsChart data={data.daily} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="Funnel" description="From a started view to a paid completion" />
              <CardContent>
                <Funnel
                  stages={[
                    { label: 'Views started', value: data.totals.rawViews, tone: 'neutral' },
                    {
                      label: 'Completed',
                      value: data.totals.rawCompletions,
                      tone: 'soft',
                      hint: 'Watched to the end and submitted',
                    },
                    {
                      label: 'Verified & billed',
                      value: data.totals.validCompletions,
                      tone: 'primary',
                      hint: `${formatPercent(fraud.rate, 1)} filtered out by fraud checks`,
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Spend per day" description="ETB charged for verified completions" />
              <CardContent>
                <AnalyticsSpendChart data={data.daily} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader title="What we do not show" />
              <CardContent className="flex flex-col gap-3 text-sm text-fg-muted">
                <p>
                  <strong className="font-medium text-fg">Demographics</strong> — the platform only collects a
                  phone number and date of birth for age verification, so we do not estimate audience
                  demographics. We would rather show nothing than made-up numbers.
                </p>
                <p>
                  <strong className="font-medium text-fg">Attention pass-rate</strong> — wrong answers are
                  counted inside “rejected” above; a separate breakdown will appear here once the API exposes
                  it.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function OverviewAnalyticsView() {
  const overview = useOverview();
  if (overview.isPending) {
    return (
      <>
        <LoadingAnnouncer label="Loading analytics" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <Card>
          <CardContent>
            <ChartSkeleton />
          </CardContent>
        </Card>
      </>
    );
  }
  if (overview.isError) {
    return (
      <Card>
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      </Card>
    );
  }
  const data = overview.data;
  const totalCompletions = data.totalValidCompletions + data.totalFlaggedCompletions;
  const fraud = summarizeFraud(
    {
      rawCompletions: totalCompletions,
      validCompletions: data.totalValidCompletions,
      flaggedCompletions: data.totalFlaggedCompletions,
      rejectedCompletions: 0,
      fraudFilteredRate: totalCompletions > 0 ? data.totalFlaggedCompletions / totalCompletions : 0,
    },
    data.totalValidCompletions > 0 ? data.totalSpendEtb / data.totalValidCompletions : 0,
  );

  if (data.totalCampaigns === 0) {
    return (
      <Card>
        <EmptyState
          illustration={<EmptyDataIllustration className="h-auto w-full" />}
          title="Analytics appear once you have a campaign"
          description="Create a campaign and, as soon as viewers start watching, you will see raw versus verified numbers here."
          action={
            <Button asChild>
              <Link to="/campaigns/new">Create a campaign</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <FraudFilterPanel summary={fraud} />
      <Alert tone="info">
        The overview aggregates the last 30 days across all campaigns. Select a single campaign above for the
        full flagged/rejected breakdown, funnel and CSV export.
      </Alert>
      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Raw views"
          value={data.totalRawViews}
          icon={Eye}
          tone="neutral"
          hint="All campaigns, all time"
        />
        <StatCard
          label="Verified completions"
          value={data.totalValidCompletions}
          icon={Layers}
          hint={`${formatNumber(data.totalFlaggedCompletions)} flagged`}
        />
        <StatCard
          label="Estimated reach"
          value={data.estimatedReach}
          icon={Users}
          tone="info"
          hint="Distinct people reached"
        />
        <StatCard
          label="Total spend"
          value={data.totalSpendEtb}
          format={(v) => `ETB ${formatEtbNumber(v, 0)}`}
          icon={Wallet}
          tone="accent"
          hint="Verified completions only"
        />
      </Stagger>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Spend over time"
            description="Last 30 days"
            action={
              <Button
                variant="outline"
                size="sm"
                leadingIcon={<Download className="size-4" />}
                onClick={() =>
                  downloadCsv(
                    `gize-overview-${todayIsoDate()}`,
                    toCsv(data.daily, [
                      { key: 'date', header: 'Date' },
                      { key: 'rawViews', header: 'Raw views' },
                      { key: 'validCompletions', header: 'Verified completions' },
                      { key: 'spendEtb', header: 'Spend (ETB)' },
                    ]),
                  )
                }
              >
                Export CSV
              </Button>
            }
          />
          <CardContent>
            <SpendChart data={data.daily} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Views over time" description="Raw views vs verified completions" />
          <CardContent>
            <ViewsChart data={data.daily} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function ExportButton({ analytics, title }: { analytics: CampaignAnalytics; title: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      leadingIcon={<Download className="size-4" />}
      onClick={() =>
        downloadCsv(
          `gize-${slugify(title)}-${analytics.from.slice(0, 10)}-to-${analytics.to.slice(0, 10)}`,
          toCsv(analytics.daily, [
            { key: 'date', header: 'Date' },
            { key: 'rawViews', header: 'Raw views' },
            { key: 'rawCompletions', header: 'Raw completions' },
            { key: 'validCompletions', header: 'Verified completions' },
            { key: 'flaggedCompletions', header: 'Flagged' },
            { key: 'rejectedCompletions', header: 'Rejected' },
            { key: 'spendEtb', header: 'Spend (ETB)' },
          ]),
        )
      }
    >
      Export CSV
    </Button>
  );
}
