import type { AdSummary, MediaType } from '@rap/shared';
import { ImageIcon, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { formatDuration } from '@/lib/utils/format';

export interface CreativePreviewProps {
  src: string;
  mediaType: MediaType;
  title: string;
  poster?: string | null;
  durationSeconds?: number;
  className?: string;
  /** Render a compact 16:9 thumbnail rather than a full player. */
  compact?: boolean;
}

/** Inline preview for a creative: HTML5 video (poster + controls) or responsive image with alt text. */
export function CreativePreview({
  src,
  mediaType,
  title,
  poster,
  durationSeconds,
  className,
  compact,
}: CreativePreviewProps) {
  const [failed, setFailed] = useState(false);
  const Icon = mediaType === 'video' ? PlayCircle : ImageIcon;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-stone-900 text-stone-50',
        compact ? 'aspect-video w-full' : 'aspect-video w-full',
        className,
      )}
    >
      {failed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-stone-300">
          <Icon className="size-8" />
          Preview unavailable
        </div>
      ) : mediaType === 'video' ? (
        <video
          className="h-full w-full object-contain"
          src={src}
          poster={poster ?? undefined}
          controls={!compact}
          preload={compact ? 'auto' : 'metadata'}
          playsInline
          muted={compact}
          onError={() => setFailed(true)}
          aria-label={`Video creative: ${title}`}
        >
          <track kind="captions" />
        </video>
      ) : (
        <img className="h-full w-full object-contain" src={src} alt={title} onError={() => setFailed(true)} />
      )}
      {compact && !failed && (
        <span className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-sm bg-stone-950/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
          <Icon className="size-3" />{' '}
          {durationSeconds !== undefined ? formatDuration(durationSeconds) : mediaType}
        </span>
      )}
    </div>
  );
}

export function AdPreview({ ad, compact }: { ad: AdSummary; compact?: boolean }) {
  return (
    <CreativePreview
      src={ad.mediaUrl}
      poster={ad.thumbnailUrl}
      mediaType={ad.mediaType}
      title={ad.title}
      durationSeconds={ad.durationSeconds}
      compact={compact}
    />
  );
}
