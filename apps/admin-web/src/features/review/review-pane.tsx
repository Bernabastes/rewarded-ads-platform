import { type BannedTopicKey, type ReviewStatus } from '@rap/shared';
import { AlertTriangle, BadgeCheck, Check, CircleHelp, Clapperboard, Clock, ExternalLink, Flag, Image as ImageIcon, RefreshCw, X } from 'lucide-react';
import { Link } from 'react-router';
import type { AdReview } from '@/lib/api/types';
import { type Checks, durationCorrectionLabel, isChecklistComplete, mediaApproveBlock, missingTopics, probeSummary } from '@/lib/domain/review-rules';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatDuration, formatEtb, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, MEDIA_STATUS_TONE, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { Kbd } from '@/components/ui/feedback';
import { IdChip } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/primitives';
import { BannedTopicsChecklist, ChecklistSummary } from './banned-topics-checklist';
import { MediaPreview } from './media-preview';

export interface ReviewPaneProps {
  ad: AdReview;
  mode: ReviewStatus;
  checks: Checks;
  onChecksChange: (c: Checks) => void;
  notes: string;
  onNotesChange: (n: string) => void;
  flagged: BannedTopicKey[];
  onToggleFlagged: (k: BannedTopicKey) => void;
  onApprove: () => void;
  onReject: () => void;
  approving?: boolean;
  canDecide: boolean;
  /** Re-run the media pipeline (probe / transcode / poster); undefined hides the action. */
  onReprocessMedia?: () => void;
  reprocessing?: boolean;
}

export function ReviewPane({ ad, mode, checks, onChecksChange, notes, onNotesChange, flagged, onToggleFlagged, onApprove, onReject, approving, canDecide, onReprocessMedia, reprocessing }: ReviewPaneProps) {
  const pending = ad.reviewStatus === 'pending';
  const complete = isChecklistComplete(checks);
  const missing = missingTopics(checks);
  const mediaBlock = mediaApproveBlock(ad);
  const approveBlocked = !pending
    ? 'This ad has already been reviewed.'
    : mediaBlock
      ? mediaBlock
      : flagged.length
        ? 'You flagged a banned topic as present - reject instead, or un-flag it.'
        : !complete
          ? `Confirm the remaining ${missing.length} banned topic${missing.length === 1 ? '' : 's'} first.`
          : !canDecide
            ? 'Your role cannot decide ads.'
            : null;
  const correction = durationCorrectionLabel(ad);
  const probe = probeSummary(ad.mediaProbe);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-fg">{ad.title}</h2>
            <StatusBadge status={ad.reviewStatus} />
            <MediaStatusBadge ad={ad} />
            {ad.openReports > 0 ? (
              <Badge tone="danger" className="gap-1">
                <Flag className="size-3" /> {ad.openReports} open report{ad.openReports === 1 ? '' : 's'}
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> submitted {formatRelative(ad.createdAt)}
            </span>
            <span>·</span>
            <span>
              {humanize(ad.mediaType)} · {formatDuration(ad.durationSeconds)}
              {correction ? <span className="ml-1 text-warning">(declared {correction})</span> : null}
            </span>
            {probe ? (
              <>
                <span>·</span>
                <span className="font-mono">{probe}</span>
              </>
            ) : null}
            <span>·</span>
            <IdChip id={ad.id} />
          </div>
        </div>
        {pending ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onReject} disabled={!canDecide}>
              <X className="size-4 text-danger" /> Reject <Kbd className="ml-1">R</Kbd>
            </Button>
            <Tooltip content={approveBlocked} disabled={!approveBlocked}>
              <span tabIndex={approveBlocked ? 0 : -1} className="inline-flex">
                <Button variant="success" onClick={onApprove} disabled={Boolean(approveBlocked)} loading={approving} aria-describedby={approveBlocked ? 'approve-blocked' : undefined}>
                  <Check className="size-4" /> Approve <Kbd className="ml-1 border-white/30 bg-white/15 text-white">A</Kbd>
                </Button>
              </span>
            </Tooltip>
          </div>
        ) : null}
      </div>
      {approveBlocked && pending ? (
        <p id="approve-blocked" className="sr-only">
          {approveBlocked}
        </p>
      ) : null}

      {mediaBlock && pending ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-fg" role="note" data-testid="media-not-ready">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" />
          <span className="flex-1">{mediaBlock}</span>
          {onReprocessMedia ? (
            <Button variant="outline" size="xs" onClick={onReprocessMedia} loading={reprocessing} data-testid="reprocess-media">
              <RefreshCw className="size-3" /> Reprocess media
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <MediaPreview mediaUrl={ad.mediaUrl} mediaType={ad.mediaType} thumbnailUrl={ad.thumbnailUrl} durationSeconds={ad.durationSeconds} title={ad.title} resetKey={ad.id} />
          {ad.description ? <p className="text-sm text-fg-muted">{ad.description}</p> : null}

          <Card>
            <CardHeader
              title="Media pipeline"
              description="ffprobe + 720p H.264 transcode + poster. Only ready / duration-corrected creatives are served in the feed."
              actions={
                onReprocessMedia && ad.mediaType === 'video' ? (
                  <Button variant="outline" size="xs" onClick={onReprocessMedia} loading={reprocessing}>
                    <RefreshCw className="size-3" /> Reprocess
                  </Button>
                ) : null
              }
            />
            <CardBody className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
              <DescriptionList
                items={[
                  { label: 'Status', value: <MediaStatusBadge ad={ad} /> },
                  { label: 'Processed', value: formatDateTime(ad.mediaProcessedAt) },
                  {
                    label: 'Duration (declared → probed)',
                    value: (
                      <span className="tabular">
                        {ad.durationDeclaredSeconds ?? '—'}s → {ad.durationProbedSeconds ?? '—'}s
                        {correction ? (
                          <Badge tone="warning" size="sm" className="ml-1.5">
                            corrected
                          </Badge>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    label: 'Probe',
                    value: ad.mediaProbe ? (
                      <span className="font-mono text-xs">
                        {ad.mediaProbe.width && ad.mediaProbe.height ? `${ad.mediaProbe.width}×${ad.mediaProbe.height}` : '—'} · {ad.mediaProbe.codec ?? '—'}
                        {ad.mediaProbe.bitrate ? ` · ${Math.round(ad.mediaProbe.bitrate / 1000)} kb/s` : ''}
                        {ad.mediaProbe.container ? ` · ${ad.mediaProbe.container}` : ''}
                      </span>
                    ) : (
                      <span className="text-fg-subtle">not probed yet</span>
                    ),
                  },
                  ...(ad.mediaError ? [{ label: 'Error', value: <span className="text-danger">{ad.mediaError}</span>, span: 2 as const }] : []),
                ]}
              />
              <div>
                <div className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">Poster</div>
                <div className="relative aspect-video overflow-hidden rounded-md border bg-stone-950">
                  {ad.thumbnailUrl ? (
                    <img src={ad.thumbnailUrl} alt={`Poster for ${ad.title}`} className="h-full w-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-stone-500">
                      <ImageIcon className="size-4" />
                      <span className="text-2xs">{ad.mediaStatus === 'processing' ? 'generating…' : 'no poster'}</span>
                    </span>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Attention questions"
              description={ad.attentionQuestions.length ? 'Shown after the video. Correct answers are visible to admins only.' : 'This creative has no attention question.'}
            />
            {ad.attentionQuestions.length ? (
              <CardBody className="space-y-3">
                {ad.attentionQuestions.map((q, qi) => (
                  <div key={q.id} className="rounded-md border bg-sunken/40 p-3">
                    <div className="flex items-start gap-2 text-sm font-medium text-fg">
                      <CircleHelp className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                      <span>
                        Q{qi + 1}. {q.prompt}
                      </span>
                    </div>
                    <ol className="mt-2 grid gap-1 sm:grid-cols-2">
                      {q.options.map((opt, i) => (
                        <li
                          key={i}
                          className={cn(
                            'flex items-center gap-2 rounded-md border px-2 py-1 text-xs',
                            i === q.correctIndex ? 'border-success/40 bg-success/10 font-medium text-fg' : 'border-transparent text-fg-muted',
                          )}
                        >
                          <span className="font-mono text-2xs text-fg-subtle">{String.fromCharCode(65 + i)}</span>
                          <span className="flex-1">{opt}</span>
                          {i === q.correctIndex ? (
                            <Badge tone="success" size="sm">
                              correct
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Campaign & advertiser"
              actions={
                <Link to={`/campaigns/${ad.campaign.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Open campaign <ExternalLink className="size-3" />
                </Link>
              }
            />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Campaign', value: ad.campaign.title, span: 2 },
                  { label: 'Campaign status', value: <StatusBadge status={ad.campaign.status} /> },
                  { label: 'Action type', value: humanize(ad.campaign.targetActionType) },
                  { label: 'Cost / action', value: formatEtb(ad.campaign.costPerActionEtb) },
                  { label: 'Budget', value: formatEtb(ad.campaign.budgetEtb) },
                  {
                    label: 'Advertiser',
                    span: 2,
                    value: (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <Link to={`/advertisers/${ad.advertiser.id}`} className="hover:text-primary hover:underline">
                          {ad.advertiser.businessName}
                        </Link>
                        {ad.advertiser.verificationStatus === 'verified' ? (
                          <Badge tone="success" size="sm" className="gap-1">
                            <BadgeCheck className="size-3" /> verified
                          </Badge>
                        ) : (
                          <Badge tone="warning" size="sm" className="gap-1">
                            <AlertTriangle className="size-3" /> {humanize(ad.advertiser.verificationStatus)}
                          </Badge>
                        )}
                      </span>
                    ),
                  },
                ]}
              />
              {ad.advertiser.verificationStatus !== 'verified' ? (
                <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-fg">
                  This advertiser is not verified yet. Approved creatives cannot go live until the business is verified.
                </p>
              ) : null}
            </CardBody>
          </Card>

          {pending ? (
            <BannedTopicsChecklist checks={checks} onChange={onChecksChange} notes={notes} onNotesChange={onNotesChange} flagged={flagged} onToggleFlagged={onToggleFlagged} disabled={!canDecide || approving} />
          ) : (
            <Card>
              <CardHeader title={mode === 'approved' ? 'Approval record' : 'Decision record'} />
              <CardBody className="space-y-3">
                <DescriptionList
                  items={[
                    { label: 'Decision', value: <StatusBadge status={ad.reviewStatus} /> },
                    { label: 'Reviewed at', value: formatDateTime(ad.reviewedAt) },
                    { label: 'Reviewed by', value: <IdChip id={ad.reviewedBy} />, span: 2 },
                    ...(ad.rejectionReason ? [{ label: 'Rejection reason', value: <span className="text-danger">{ad.rejectionReason}</span>, span: 2 as const }] : []),
                    ...(ad.reviewNote ? [{ label: 'Note', value: ad.reviewNote, span: 2 as const }] : []),
                  ]}
                />
                <div>
                  <div className="mb-1.5 text-2xs font-medium tracking-wider text-fg-subtle uppercase">Checklist at decision time</div>
                  <ChecklistSummary checks={ad.bannedTopicsChecklist?.checks} notes={ad.bannedTopicsChecklist?.notes} />
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Chip for `mediaStatus`; shown in the queue list and the pane header. */
export function MediaStatusBadge({ ad, size }: { ad: Pick<AdReview, 'mediaStatus' | 'mediaError' | 'mediaType'>; size?: 'sm' | 'md' }) {
  const label = ad.mediaStatus === 'duration_corrected' ? 'duration corrected' : ad.mediaStatus;
  const tip = ad.mediaStatus === 'processing' ? 'Probe / transcode / poster still running' : ad.mediaStatus === 'failed' ? (ad.mediaError ?? 'Media pipeline failed') : ad.mediaStatus === 'duration_corrected' ? 'Declared duration differed from the probed duration by more than 1 s; the probed value is used.' : 'Transcoded and ready for the feed';
  return (
    <Tooltip content={tip}>
      <span>
        <Badge tone={MEDIA_STATUS_TONE[ad.mediaStatus]} size={size} className={cn('gap-1', ad.mediaStatus === 'processing' && 'animate-pulse')} data-testid="media-status">
          <Clapperboard className={size === 'sm' ? 'size-2.5' : 'size-3'} /> {label}
        </Badge>
      </span>
    </Tooltip>
  );
}
