import { ArrowRight, Eye, Megaphone, Plus, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { StatCard } from '@/components/charts/stat-card';
import { EmptyCampaignsIllustration } from '@/components/feedback/illustrations';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { VerificationBanner } from '@/components/layout/verification-banner';
import { CountUp } from '@/components/motion/count-up';
import { PageTransition, Stagger, StaggerItem } from '@/components/motion/motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChartSkeleton, ListSkeleton, LoadingAnnouncer, StatCardSkeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-provider';
import { CampaignCard } from '@/features/campaigns/campaign-card';
import { useCampaigns, useOverview } from '@/features/campaigns/hooks';
import { formatEtb, formatEtbNumber, formatNumber, formatPercent } from '@/lib/utils/format';
import { SpendChart, ViewsChart } from './dashboard-charts';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage() {
  const { profile } = useAuth();
  const overview = useOverview();
  const campaigns = useCampaigns();

  const recent = [...(campaigns.data?.data ?? [])]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 3);

  const isNewAccount = overview.data && overview.data.totalCampaigns === 0;
  const fraudRate =
    overview.data && overview.data.totalValidCompletions + overview.data.totalFlaggedCompletions > 0
      ? overview.data.totalFlaggedCompletions /
        (overview.data.totalValidCompletions + overview.data.totalFlaggedCompletions)
      : 0;

  return (
    <PageTransition className="flex flex-col gap-8">
      <PageHeader
        title={`${greeting()}, ${profile?.businessName ?? 'there'}`}
        description="Here is how your campaigns are performing. Every number below counts verified attention only, unless labelled raw."
        actions={
          <Button asChild>
            <Link to="/campaigns/new">
              <Plus className="size-4" /> New campaign
            </Link>
          </Button>
        }
      />

      <VerificationBanner />

      {overview.isPending ? (
        <>
          <LoadingAnnouncer label="Loading your overview" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Spend over time" />
              <CardContent>
                <ChartSkeleton />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Views over time" />
              <CardContent>
                <ChartSkeleton />
              </CardContent>
            </Card>
          </div>
        </>
      ) : overview.isError ? (
        <Card>
          <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
        </Card>
      ) : isNewAccount ? (
        <NewAccountState walletBalanceEtb={overview.data.walletBalanceEtb} />
      ) : (
        <>
          <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Active campaigns"
              value={overview.data.activeCampaigns}
              icon={Megaphone}
              hint={`${overview.data.totalCampaigns} total`}
            />
            <StatCard
              label="Total spend"
              value={overview.data.totalSpendEtb}
              format={(v) => `ETB ${formatEtbNumber(v, 0)}`}
              icon={Wallet}
              tone="accent"
              hint="Verified completions only"
            />
            <StatCard
              label="Verified views"
              value={overview.data.totalValidCompletions}
              icon={Eye}
              tone="info"
              hint={
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="size-3.5 text-success" />
                  {formatNumber(overview.data.totalFlaggedCompletions)} filtered (
                  {formatPercent(fraudRate, 0)})
                </span>
              }
            />
            <StatCard
              label="Estimated reach"
              value={overview.data.estimatedReach}
              icon={Users}
              tone="success"
              hint={`${formatNumber(overview.data.totalRawViews)} raw views`}
            />
          </Stagger>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Spend over time" description="Last 30 days, ETB per day" />
              <CardContent>
                <SpendChart data={overview.data.daily} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Views over time" description="Raw views vs verified completions" />
              <CardContent>
                <ViewsChart data={overview.data.daily} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="flex flex-col gap-4 lg:col-span-2" aria-labelledby="recent-heading">
              <div className="flex items-center justify-between">
                <h2 id="recent-heading" className="text-display text-lg font-semibold text-fg">
                  Recent campaigns
                </h2>
                <Button asChild variant="link" size="sm">
                  <Link to="/campaigns">
                    View all <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
              {campaigns.isPending ? (
                <ListSkeleton items={3} />
              ) : campaigns.isError ? (
                <Card>
                  <ErrorState compact error={campaigns.error} onRetry={() => void campaigns.refetch()} />
                </Card>
              ) : recent.length === 0 ? (
                <Card>
                  <EmptyState
                    compact
                    title="No campaigns yet"
                    description="Create your first campaign to start reaching verified viewers."
                  />
                </Card>
              ) : (
                <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {recent.map((campaign) => (
                    <CampaignCard key={campaign.id} campaign={campaign} />
                  ))}
                </Stagger>
              )}
            </section>

            <WalletCard balanceEtb={overview.data.walletBalanceEtb} />
          </div>
        </>
      )}
    </PageTransition>
  );
}

function WalletCard({ balanceEtb }: { balanceEtb: number }) {
  return (
    <Stagger>
      <StaggerItem>
        <Card className="relative overflow-hidden bg-forest-800 text-forest-50 dark:bg-forest-900">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background: 'radial-gradient(70% 60% at 100% 0%, rgb(230 123 65 / 0.35), transparent 60%)',
            }}
          />
          <CardContent className="relative flex flex-col gap-5">
            <div className="flex items-center gap-2 text-sm text-forest-100">
              <Wallet className="size-4" /> Wallet balance
            </div>
            <p className="text-display text-3xl font-bold tracking-tight">
              <CountUp value={balanceEtb} format={(v) => formatEtb(v)} />
            </p>
            <p className="text-sm leading-relaxed text-forest-100/85">
              Budgets are reserved from this balance when you submit a campaign. Keep it topped up so
              approvals go live immediately.
            </p>
            <Button asChild variant="accent" className="w-full">
              <Link to="/billing?topup=start">
                <Plus className="size-4" /> Add funds
              </Link>
            </Button>
          </CardContent>
        </Card>
      </StaggerItem>
    </Stagger>
  );
}

function NewAccountState({ walletBalanceEtb }: { walletBalanceEtb: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <EmptyState
          illustration={<EmptyCampaignsIllustration className="h-auto w-full" />}
          title="Launch your first campaign"
          description={
            <>
              Upload a video or image creative, set a budget and cost per view, and our team reviews it within
              a working day. You only pay for completions that pass our fraud checks.
            </>
          }
          action={
            <>
              <Button asChild size="lg">
                <Link to="/campaigns/new">
                  <Plus className="size-4" /> Create your first campaign
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/billing?topup=start">Add funds first</Link>
              </Button>
            </>
          }
        />
      </Card>
      <WalletCard balanceEtb={walletBalanceEtb} />
    </div>
  );
}
