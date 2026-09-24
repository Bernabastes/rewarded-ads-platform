import { CampaignStatus, type CampaignSummary } from '@rap/shared';
import { Plus, Search, X } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyCampaignsIllustration } from '@/components/feedback/illustrations';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { VerificationBanner } from '@/components/layout/verification-banner';
import { PageTransition, Stagger } from '@/components/motion/motion';
import { CAMPAIGN_STATUS_LABEL } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { ListSkeleton, LoadingAnnouncer } from '@/components/ui/skeleton';
import { CampaignCard } from './campaign-card';
import { useCampaigns } from './hooks';

const STATUS_ORDER: CampaignStatus[] = [
  CampaignStatus.active,
  CampaignStatus.pending_review,
  CampaignStatus.paused,
  CampaignStatus.draft,
  CampaignStatus.completed,
  CampaignStatus.rejected,
];

export type CampaignSort = 'updated' | 'created' | 'budget' | 'spent' | 'title';

const SORT_OPTIONS: Array<{ value: CampaignSort; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Newest first' },
  { value: 'budget', label: 'Budget: high to low' },
  { value: 'spent', label: 'Spend: high to low' },
  { value: 'title', label: 'Title A–Z' },
];

export function filterAndSortCampaigns(
  campaigns: readonly CampaignSummary[],
  { status, search, sort }: { status?: CampaignStatus | 'all'; search?: string; sort: CampaignSort },
): CampaignSummary[] {
  const q = search?.trim().toLowerCase() ?? '';
  const filtered = campaigns.filter((c) => {
    if (status && status !== 'all' && c.status !== status) return false;
    if (q && !`${c.title} ${c.description ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sorters: Record<CampaignSort, (a: CampaignSummary, b: CampaignSummary) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    budget: (a, b) => b.budgetEtb - a.budgetEtb,
    spent: (a, b) => b.spentEtb - a.spentEtb,
    title: (a, b) => a.title.localeCompare(b.title, ['am', 'en']),
  };
  return [...filtered].sort(sorters[sort]);
}

function isStatus(value: string | null): value is CampaignStatus {
  return !!value && value in CampaignStatus;
}

export function CampaignsPage() {
  const [params, setParams] = useSearchParams();
  const status = isStatus(params.get('status')) ? (params.get('status') as CampaignStatus) : 'all';
  const search = params.get('q') ?? '';
  const sortParam = params.get('sort');
  const sort: CampaignSort = SORT_OPTIONS.some((o) => o.value === sortParam) ? (sortParam as CampaignSort) : 'updated';

  const campaigns = useCampaigns();

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '' || value === 'all') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const all = useMemo(() => campaigns.data?.data ?? [], [campaigns.data]);
  const visible = useMemo(() => filterAndSortCampaigns(all, { status, search, sort }), [all, status, search, sort]);
  const counts = useMemo(() => {
    const map = new Map<CampaignStatus, number>();
    for (const c of all) map.set(c.status, (map.get(c.status) ?? 0) + 1);
    return map;
  }, [all]);

  return (
    <PageTransition className="flex flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description="Everything you have drafted, submitted or run. Search and sort happen instantly in your browser."
        actions={
          <Button asChild>
            <Link to="/campaigns/new">
              <Plus className="size-4" /> New campaign
            </Link>
          </Button>
        }
      />
      <VerificationBanner />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={status} onValueChange={(v) => update({ status: v })}>
          <TabsList className="h-auto flex-wrap" aria-label="Filter by status">
            <TabsTrigger value="all">
              All <span className="text-fg-subtle tabular-nums">{all.length}</span>
            </TabsTrigger>
            {STATUS_ORDER.map((s) => (
              <TabsTrigger key={s} value={s}>
                {CAMPAIGN_STATUS_LABEL[s]} <span className="text-fg-subtle tabular-nums">{counts.get(s) ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="sm:w-64">
            <Input
              type="search"
              value={search}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search campaigns"
              aria-label="Search campaigns"
              leading={<Search className="size-4" />}
              trailing={
                search ? (
                  <Button variant="ghost" size="icon-sm" onClick={() => update({ q: null })} aria-label="Clear search">
                    <X className="size-4" />
                  </Button>
                ) : undefined
              }
            />
          </div>
          <div className="sm:w-52">
            <Select value={sort} onValueChange={(v) => update({ sort: v })} options={SORT_OPTIONS} aria-label="Sort campaigns" />
          </div>
        </div>
      </div>

      {campaigns.isPending ? (
        <>
          <LoadingAnnouncer label="Loading campaigns" />
          <ListSkeleton items={4} />
        </>
      ) : campaigns.isError ? (
        <Card>
          <ErrorState error={campaigns.error} onRetry={() => void campaigns.refetch()} />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          {all.length === 0 ? (
            <EmptyState
              illustration={<EmptyCampaignsIllustration className="h-auto w-full" />}
              title="No campaigns yet"
              description="Your first campaign takes about five minutes: describe it, upload a creative, set a budget and submit for review."
              action={
                <Button asChild size="lg">
                  <Link to="/campaigns/new">
                    <Plus className="size-4" /> Create your first campaign
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              compact
              title="Nothing matches these filters"
              description={search ? `No campaign title or description contains “${search}”.` : `You have no ${CAMPAIGN_STATUS_LABEL[status as CampaignStatus]?.toLowerCase() ?? ''} campaigns.`}
              action={
                <Button variant="outline" onClick={() => update({ q: null, status: null })}>
                  Clear filters
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" key={`${status}-${sort}-${search}`}>
          {visible.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </Stagger>
      )}
    </PageTransition>
  );
}
