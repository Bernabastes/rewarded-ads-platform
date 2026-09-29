import type { AdSummary, CampaignDetail, MediaStatus } from '@rap/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Timer } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/primitives';
import { campaignsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatDuration } from '@/lib/utils/format';

/* ---------------------------------- status meta --------------------------------- */

export const MEDIA_STATUS_META: Record<
  MediaStatus,
  { label: string; tone: BadgeTone; description: string; icon: typeof Loader2 }
> = {
  processing: {
    label: 'Processing media',
    tone: 'info',
    description:
      'We are checking the true duration, transcoding a 720p copy for phones and generating a poster. Usually under a minute.',
    icon: Loader2,
  },
  ready: {
    label: 'Media ready',
    tone: 'success',
    description: 'Duration verified, 720p transcode and poster generated.',
    icon: CheckCircle2,
  },
  duration_corrected: {
    label: 'Duration corrected',
    tone: 'warning',
    description: 'The measured duration differed from the declared one; the measured value is used.',
    icon: Timer,
  },
  failed: {
    label: 'Processing failed',
    tone: 'danger',
    description: 'The file could not be processed. Reviewers cannot approve it — re-upload a new file.',
    icon: AlertTriangle,
  },
};

export function isMediaProcessing(ad: Pick<AdSummary, 'mediaStatus'>): boolean {
  return ad.mediaStatus === 'processing';
}

export function isMediaFailed(ad: Pick<AdSummary, 'mediaStatus'>): boolean {
  return ad.mediaStatus === 'failed';
}

export function countMedia(ads: ReadonlyArray<Pick<AdSummary, 'mediaStatus'>>) {
  return {
    processing: ads.filter(isMediaProcessing).length,
    failed: ads.filter(isMediaFailed).length,
    corrected: ads.filter((ad) => ad.mediaStatus === 'duration_corrected').length,
  };
}

/** Bits per second → "1.2 Mbps" / "640 kbps". */
export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

/* ------------------------------------ badge ------------------------------------- */

export function MediaStatusBadge({
  status,
  size = 'md',
  className,
}: {
  status: MediaStatus;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const meta = MEDIA_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Tooltip content={meta.description}>
      <Badge
        tone={meta.tone}
        size={size}
        className={cn('cursor-help', className)}
        data-media-status={status}
        aria-label={`${meta.label}: ${meta.description}`}
      >
        <Icon
          className={cn(size === 'sm' ? 'size-3' : 'size-3.5', status === 'processing' && 'animate-spin')}
          aria-hidden="true"
        />
        {meta.label}
      </Badge>
    </Tooltip>
  );
}

/* ------------------------------- probe & notes --------------------------------- */

/** Technical facts from ffprobe plus the duration-correction / failure notes. */
export function MediaProbeDetails({
  ad,
  onReupload,
  compact,
  className,
}: {
  ad: AdSummary;
  /** Shown on failed creatives (e.g. jump to the uploader). */
  onReupload?: () => void;
  compact?: boolean;
  className?: string;
}) {
  if (ad.mediaType !== 'video' && !ad.mediaProbe && ad.mediaStatus !== 'failed') return null;
  const probe = ad.mediaProbe;
  const facts: string[] = [];
  if (probe?.width && probe?.height) facts.push(`${probe.width}×${probe.height}`);
  if (probe?.codec) facts.push(probe.codec.toUpperCase());
  if (probe?.bitrate) facts.push(formatBitrate(probe.bitrate));
  if (probe?.container) facts.push(probe.container.split(',')[0]);

  return (
    <div className={cn('flex flex-col gap-2', className)} data-testid="media-probe">
      {ad.mediaStatus === 'processing' && (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <p className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Loader2 className="size-3.5 animate-spin text-info" aria-hidden="true" />
            Checking duration, transcoding to 720p and generating a poster… refreshing every 5 seconds.
          </p>
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-label="Media processing"
            aria-valuetext="Processing"
          >
            <div className="h-full w-1/3 animate-[shimmer_1.4s_linear_infinite] rounded-full bg-info/70 [background:linear-gradient(90deg,transparent,var(--color-info),transparent)] [background-size:200%_100%]" />
          </div>
        </div>
      )}
      {facts.length > 0 && (
        <p className="text-xs text-fg-subtle" data-testid="media-facts">
          {facts.join(' · ')}
          {ad.mediaProcessedAt && !compact ? ` · processed ${formatDateTime(ad.mediaProcessedAt)}` : ''}
        </p>
      )}
      {ad.mediaStatus === 'duration_corrected' && (
        <Note tone="warning">
          You declared <strong>{formatDuration(ad.durationDeclaredSeconds ?? ad.durationSeconds)}</strong>{' '}
          ({ad.durationDeclaredSeconds ?? ad.durationSeconds}s) → we measured{' '}
          <strong>{formatDuration(ad.durationProbedSeconds ?? ad.durationSeconds)}</strong> (
          {ad.durationProbedSeconds ?? ad.durationSeconds}s). The measured value is used for the watch check
          and the viewer reward.
        </Note>
      )}
      {ad.mediaStatus === 'failed' && (
        <Alert tone="danger" className="py-2.5" title="This file could not be processed">
          <p className="break-words">{ad.mediaError ?? 'The media pipeline did not report a reason.'}</p>
          <p className="mt-1">
            Reviewers cannot approve it. Remove this creative and upload a new file (MP4 H.264 is the safest
            choice).
          </p>
          {onReupload && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={onReupload}
              leadingIcon={<RefreshCw className="size-3.5" />}
            >
              Re-upload
            </Button>
          )}
        </Alert>
      )}
    </div>
  );
}

function Note({ tone, children }: { tone: 'warning' | 'info'; children: ReactNode }) {
  return (
    <p
      className={cn(
        'rounded-sm border px-2.5 py-1.5 text-xs leading-relaxed',
        tone === 'warning' ? 'border-warning/35 bg-warning/10 text-fg' : 'border-info/25 bg-info/8 text-fg',
      )}
    >
      {children}
    </p>
  );
}

/* ----------------------------------- polling ------------------------------------ */

export const MEDIA_POLL_INTERVAL_MS = 5_000;
/** Give up polling after this long; the UI then says processing is taking longer than usual. */
export const MEDIA_POLL_TIMEOUT_MS = 10 * 60_000;

/**
 * Polls `GET /campaigns/:id/ads` every 5 s while at least one creative is `processing` and writes the fresh
 * list into the campaign-detail cache, so every consumer of `campaign.ads` (detail page, wizard steps, review)
 * updates without re-fetching the whole campaign. Stops when no creative is processing, on error, or after
 * `MEDIA_POLL_TIMEOUT_MS` (`maxPolls` x interval).
 */
export function useMediaProcessingPoll(
  campaign: Pick<CampaignDetail, 'id' | 'ads'> | undefined,
  options: { intervalMs?: number; maxPolls?: number } = {},
) {
  const queryClient = useQueryClient();
  const intervalMs = options.intervalMs ?? MEDIA_POLL_INTERVAL_MS;
  const maxPolls = options.maxPolls ?? Math.ceil(MEDIA_POLL_TIMEOUT_MS / intervalMs);
  const campaignId = campaign?.id;
  const processing = !!campaign && campaign.ads.some(isMediaProcessing);
  // Touched only inside the query lifecycle (never during render).
  const polls = useRef(0);
  const [timedOut, setTimedOut] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.campaigns.ads(campaignId ?? ''),
    queryFn: async () => {
      const id = campaignId!;
      const ads = await campaignsApi.ads(id);
      polls.current += 1;
      queryClient.setQueryData<CampaignDetail>(queryKeys.campaigns.detail(id), (prev) =>
        prev ? { ...prev, ads, adsCount: ads.length } : prev,
      );
      if (!ads.some(isMediaProcessing)) {
        polls.current = 0;
        setTimedOut(false);
        // The pipeline finished: summary counts (approved ads, durations) may have changed too.
        void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.detail(id) });
      } else if (polls.current >= maxPolls) {
        setTimedOut(true);
      }
      return ads;
    },
    enabled: processing && !!campaignId,
    // Only meaningful while polling; the detail query owns the data otherwise.
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (q) => {
      if (q.state.status === 'error') return false;
      const ads = q.state.data;
      if (ads && !ads.some(isMediaProcessing)) return false;
      if (polls.current >= maxPolls) return false;
      return intervalMs;
    },
    refetchIntervalInBackground: false,
  });

  return {
    /** True while the 5-second poll is running. */
    polling: processing && !timedOut && !query.isError,
    timedOut: processing && timedOut,
    error: query.error,
  };
}