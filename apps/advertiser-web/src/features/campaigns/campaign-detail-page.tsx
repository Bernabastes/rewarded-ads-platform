import { ErrorCode, type AdSummary } from '@rap/shared';
import { BarChart3, Pause, Pencil, Play, Plus, Radio, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { NotFoundPage } from '@/app/error-pages';
import { ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { CountUp } from '@/components/motion/count-up';
import { PageTransition, Stagger, StaggerItem } from '@/components/motion/motion';
import { Alert } from '@/components/ui/alert';
import { CampaignStatusBadge, ReviewStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Progress } from '@/components/ui/progress';
import { Tooltip } from '@/components/ui/primitives';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { DescriptionList } from '@/components/ui/table';
import { isApiError } from '@/lib/api/errors';
import { toastApiError } from '@/lib/forms';
import { computeBudgetSplit } from '@/lib/utils/budget';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatEtb,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/utils/format';
import { budgetProgress, TARGET_ACTION_META } from './campaign-card';
import { AdPreview } from './creative-preview';
import { useCampaign, useDeleteCampaign, usePauseCampaign, useRemoveAd, useResumeCampaign } from './hooks';
import { StatusTimeline } from './status-timeline';
import { useSubmitCampaignFlow } from './submit-flow';

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const campaign = useCampaign(id);
  const navigate = useNavigate();
  const pause = usePauseCampaign();
  const resume = useResumeCampaign();
  const remove = useDeleteCampaign();
  const removeAd = useRemoveAd();
  const submitFlow = useSubmitCampaignFlow();
  const [confirm, setConfirm] = useState<'pause' | 'resume' | 'delete' | null>(null);
  const [adToDelete, setAdToDelete] = useState<AdSummary | null>(null);

  if (campaign.isError) {
    if (isApiError(campaign.error) && campaign.error.code === ErrorCode.NOT_FOUND)
      return <NotFoundPage embedded />;
    return (
      <Card>
        <ErrorState error={campaign.error} onRetry={() => void campaign.refetch()} />
      </Card>
    );
  }

  if (campaign.isPending || !campaign.data) return <DetailSkeleton />;

  const data = campaign.data;
  const meta = TARGET_ACTION_META[data.targetActionType];
  const progress = budgetProgress(data);
  const split = computeBudgetSplit(data.remainingEtb, data.costPerActionEtb);
  const passRate = data.rawCompletions > 0 ? data.validCompletions / data.rawCompletions : null;
  const isLive = data.status === 'active' || data.status === 'pending_review';
  const editable = data.status === 'draft' || data.status === 'rejected';
  const canPause = data.status === 'active';
  const canResume = data.status === 'paused' && data.pausedReason !== 'admin_paused' && data.remainingEtb > 0;
  const canSubmit = editable && (data.targetActionType !== 'video_view' || data.adsCount > 0);
  const canAddAd = editable || data.status === 'paused' || data.status === 'active';

  const runAction = async (kind: 'pause' | 'resume' | 'delete') => {
    try {
      if (kind === 'pause') {
        await pause.mutateAsync(data.id);
        toast.success('Campaign paused', {
          description: 'Viewers will stop seeing this campaign within a minute.',
        });
      } else if (kind === 'resume') {
        await resume.mutateAsync(data.id);
        toast.success('Campaign resumed');
      } else {
        await remove.mutateAsync(data.id);
        toast.success('Draft deleted');
        navigate('/campaigns', { replace: true });
      }
    } catch (error) {
      toastApiError(error);
      throw error;
    }
  };

  return (
    <PageTransition className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: 'Campaigns', to: '/campaigns' }, { label: data.title }]}
        title={data.title}
        meta={
          <span className="flex items-center gap-2">
            <CampaignStatusBadge status={data.status} />
            {isLive && (
              <Tooltip content="Counts refresh automatically every 15 seconds">
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <Radio className="size-3.5 animate-pulse" /> Live
                </span>
              </Tooltip>
            )}
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <meta.icon className="size-4" /> {meta.label}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatEtb(data.costPerActionEtb)} per action</span>
            <span aria-hidden="true">·</span>
            <span>Updated {formatRelative(data.updatedAt)}</span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={`/campaigns/${data.id}/analytics`}>
                <BarChart3 className="size-4" /> Analytics
              </Link>
            </Button>
            {editable && (
              <Button asChild variant="outline">
                <Link to={`/campaigns/${data.id}/edit`}>
                  <Pencil className="size-4" /> Edit
                </Link>
              </Button>
            )}
            {data.status === 'draft' && (
              <Button
                variant="ghost"
                className="text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => setConfirm('delete')}
                leadingIcon={<Trash2 className="size-4" />}
              >
                Delete
              </Button>
            )}
            {canPause && (
              <Button
                variant="outline"
                onClick={() => setConfirm('pause')}
                leadingIcon={<Pause className="size-4" />}
              >
                Pause
              </Button>
            )}
            {data.status === 'paused' && (
              <Tooltip
                content={
                  canResume
                    ? 'Resume delivery'
                    : data.pausedReason === 'admin_paused'
                      ? 'Paused by the platform team — contact support'
                      : 'Budget exhausted — increase the budget to resume'
                }
              >
                <span>
                  <Button
                    onClick={() => setConfirm('resume')}
                    disabled={!canResume}
                    leadingIcon={<Play className="size-4" />}
                  >
                    Resume
                  </Button>
                </span>
              </Tooltip>
            )}
            {editable && (
              <Tooltip
                content={
                  canSubmit ? 'Reserve the budget and send for review' : 'Upload at least one creative first'
                }
              >
                <span>
                  <Button
                    onClick={() => void submitFlow.submit(data)}
                    disabled={!canSubmit}
                    loading={submitFlow.isSubmitting}
                    leadingIcon={<Send className="size-4" />}
                  >
                    Submit for review
                  </Button>
                </span>
              </Tooltip>
            )}
          </>
        }
      />

      {data.status === 'rejected' && (
        <Alert tone="danger" title="This campaign was not approved">
          {data.rejectionReason ?? 'The review team did not leave a reason.'} Update the campaign or its
          creatives and submit again.
        </Alert>
      )}
      {data.status === 'paused' && data.pausedReason === 'admin_paused' && (
        <Alert tone="warning" title="Paused by the platform team">
          Delivery was paused during a review. Contact support if you believe this was a mistake; you cannot
          resume it yourself.
        </Alert>
      )}
      {data.status === 'paused' && data.pausedReason !== 'admin_paused' && data.remainingEtb <= 0 && (
        <Alert tone="info" title="Budget exhausted">
          The full budget has been spent on verified completions. Increase the budget to resume delivery.
        </Alert>
      )}
      {data.status === 'pending_review' && (
        <Alert tone="info" title="In review">
          Our team is checking the creatives against the advertising guidelines. {formatEtb(data.budgetEtb)}{' '}
          is reserved from your wallet; it is refunded in full if the campaign is rejected.
        </Alert>
      )}

      <Card>
        <CardContent>
          <StatusTimeline campaign={data} />
        </CardContent>
      </Card>

      <Stagger className="grid gap-4 lg:grid-cols-3">
        <StaggerItem className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader title="Budget" description="Spent on verified completions vs remaining reservation" />
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-fg-muted">Spent</p>
                  <p className="text-display text-3xl font-bold tracking-tight text-fg">
                    <CountUp value={data.spentEtb} format={formatEtb} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-fg-muted">Remaining</p>
                  <p className="text-display text-2xl font-semibold text-fg">
                    {formatEtb(data.remainingEtb)}
                  </p>
                </div>
              </div>
              <Progress value={progress} tone={progress >= 0.9 ? 'accent' : 'primary'} label="Budget spent" />
              <p className="text-xs text-fg-subtle">
                {formatPercent(progress, 0)} of {formatEtb(data.budgetEtb)} used · roughly{' '}
                {formatNumber(split.estimatedCompletions)} more verified completions at{' '}
                {formatEtb(data.costPerActionEtb)} each
              </p>
              <dl className="grid gap-4 border-t border-border pt-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-fg-subtle">Viewer receives</dt>
                  <dd className="font-semibold text-fg">
                    {formatEtb(data.rewardPerActionEtb)}{' '}
                    <span className="font-normal text-fg-subtle">
                      ({formatNumber(data.rewardCoins)} coins)
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-subtle">Platform fee</dt>
                  <dd className="font-semibold text-fg">
                    {formatEtb(data.costPerActionEtb - data.rewardPerActionEtb)}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-subtle">Attention check</dt>
                  <dd className="font-semibold text-fg">{data.attentionCheckEnabled ? 'On' : 'Off'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card className="h-full">
            <CardHeader title="Completions" description={isLive ? 'Updating live' : 'Final counts'} />
            <CardContent className="flex flex-col gap-4">
              <div>
                <p className="text-sm text-fg-muted">Verified (you pay for these)</p>
                <p className="text-display text-3xl font-bold tracking-tight text-fg">
                  <CountUp value={data.validCompletions} />
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                <div>
                  <p className="text-fg-subtle">Raw completions</p>
                  <p className="font-semibold tabular-nums text-fg">{formatNumber(data.rawCompletions)}</p>
                </div>
                <div>
                  <p className="text-fg-subtle">Pass rate</p>
                  <p className="font-semibold tabular-nums text-fg">
                    {passRate === null ? '—' : formatPercent(passRate, 0)}
                  </p>
                </div>
              </div>
              <Button asChild variant="secondary" size="sm" className="mt-auto self-start">
                <Link to={`/campaigns/${data.id}/analytics`}>See fraud-filtered breakdown</Link>
              </Button>
            </CardContent>
          </Card>
        </StaggerItem>
      </Stagger>

      <Card>
        <CardHeader
          title={`Creatives (${data.ads.length})`}
          description="Each creative is reviewed individually. Rejected ones can be deleted and replaced."
          action={
            canAddAd && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/campaigns/${data.id}/edit?step=creative`}>
                  <Plus className="size-4" /> Add creative
                </Link>
              </Button>
            )
          }
        />
        <CardContent>
          {data.ads.length === 0 ? (
            <div className="rounded-md border border-dashed border-border-strong px-6 py-10 text-center text-sm text-fg-muted">
              No creatives yet.{' '}
              {canAddAd && (
                <Link
                  to={`/campaigns/${data.id}/edit?step=creative`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Upload a video or image
                </Link>
              )}
            </div>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {data.ads.map((ad) => (
                <li key={ad.id} className="flex flex-col gap-3 rounded-md border border-border p-3">
                  <AdPreview ad={ad} compact />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{ad.title}</p>
                      <p className="text-xs text-fg-subtle">
                        {ad.mediaType === 'video' ? 'Video' : 'Image'} · {formatDuration(ad.durationSeconds)}{' '}
                        · {ad.attentionQuestionsCount} attention question
                        {ad.attentionQuestionsCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <ReviewStatusBadge status={ad.reviewStatus} />
                  </div>
                  {ad.reviewStatus === 'rejected' && (
                    <Alert tone="danger" className="py-2.5">
                      {ad.rejectionReason ?? 'Rejected without a reason.'}
                    </Alert>
                  )}
                  <div className="flex items-center justify-between text-xs text-fg-subtle">
                    <span>
                      {ad.reviewedAt
                        ? `Reviewed ${formatDateTime(ad.reviewedAt)}`
                        : `Added ${formatDate(ad.createdAt)}`}
                    </span>
                    {ad.reviewStatus !== 'approved' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger hover:bg-danger/10 hover:text-danger"
                        onClick={() => setAdToDelete(ad)}
                      >
                        <Trash2 className="size-3.5" /> Remove
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Details" />
        <CardContent>
          <DescriptionList
            items={[
              {
                term: 'Description',
                detail: data.description || <span className="text-fg-subtle">None</span>,
              },
              { term: 'Target action', detail: meta.label },
              {
                term: 'Schedule',
                detail: `${data.startDate ? formatDate(data.startDate) : 'On approval'} → ${data.endDate ? formatDate(data.endDate) : 'Until budget is spent'}`,
              },
              { term: 'Created', detail: formatDateTime(data.createdAt) },
              { term: 'Campaign ID', detail: <code className="text-xs">{data.id}</code> },
            ]}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm === 'pause'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Pause this campaign?"
        description="Viewers stop seeing your ads within a minute. Your remaining budget stays reserved and you can resume at any time."
        confirmLabel="Pause campaign"
        onConfirm={() => runAction('pause')}
      />
      <ConfirmDialog
        open={confirm === 'resume'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Resume this campaign?"
        description="Approved creatives start showing to viewers again and verified completions resume spending the budget."
        confirmLabel="Resume campaign"
        onConfirm={() => runAction('resume')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this draft?"
        description="The draft and its uploaded creatives are removed permanently. Nothing has been charged."
        confirmLabel="Delete draft"
        confirmVariant="danger"
        onConfirm={() => runAction('delete')}
      />
      <ConfirmDialog
        open={adToDelete !== null}
        onOpenChange={(open) => !open && setAdToDelete(null)}
        title="Remove this creative?"
        description={adToDelete ? `“${adToDelete.title}” will be removed from the campaign.` : undefined}
        confirmLabel="Remove creative"
        confirmVariant="danger"
        onConfirm={async () => {
          if (!adToDelete) return;
          try {
            await removeAd.mutateAsync({ campaignId: data.id, adId: adToDelete.id });
            toast.success('Creative removed');
          } catch (error) {
            toastApiError(error);
            throw error;
          }
        }}
      />
      {submitFlow.dialog}
    </PageTransition>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-9 w-2/3 max-w-md" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Card>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 rounded-full" />
                <SkeletonText lines={2} className="flex-1" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <SkeletonText lines={2} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-8 w-24" />
            <SkeletonText lines={3} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
