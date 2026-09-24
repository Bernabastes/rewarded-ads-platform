import type { MediaType } from '@rap/shared';
import { ImageOff, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { formatDuration } from '@/lib/utils/format';

export interface MediaPreviewProps {
  mediaUrl: string;
  mediaType: MediaType;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
  title: string;
  className?: string;
  /** Pause & reset when the ad changes. */
  resetKey?: string;
}

/** Video / image creative preview with native controls; keeps the aspect box stable while loading. */
export function MediaPreview({ mediaUrl, mediaType, thumbnailUrl, durationSeconds, title, className, resetKey }: MediaPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    setFailed(false);
    setStarted(false);
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  }, [resetKey, mediaUrl]);

  return (
    <div className={cn('relative overflow-hidden rounded-lg border bg-stone-950', className)}>
      <div className="aspect-video w-full">
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-stone-400">
            <ImageOff className="size-6" />
            <p className="text-xs">Media could not be loaded.</p>
            <a href={mediaUrl} target="_blank" rel="noreferrer" className="text-xs text-forest-300 underline">
              Open source URL
            </a>
          </div>
        ) : mediaType === 'video' ? (
          <video
            ref={videoRef}
            key={mediaUrl}
            className="h-full w-full object-contain"
            controls
            preload="metadata"
            poster={thumbnailUrl ?? undefined}
            playsInline
            onError={() => setFailed(true)}
            onPlay={() => setStarted(true)}
            aria-label={`Creative video: ${title}`}
          >
            <source src={mediaUrl} />
          </video>
        ) : (
          <img src={mediaUrl} alt={`Creative image: ${title}`} className="h-full w-full object-contain" onError={() => setFailed(true)} />
        )}
      </div>
      {!failed && mediaType === 'video' && !started ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-stone-950/80 to-transparent px-3 py-2 text-2xs text-stone-200">
          <span className="inline-flex items-center gap-1">
            <Play className="size-3" /> Press play to review the full creative
          </span>
          {durationSeconds ? <span className="tabular">{formatDuration(durationSeconds)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
