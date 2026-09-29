import type { AdminKycDetail } from '@rap/shared';
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, RefreshCw, TimerReset, ZoomIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { documentsExpireAt, formatRemaining } from '@/lib/domain/kyc-rules';
import { useNow } from '@/lib/hooks/use-misc';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/feedback';

export type DocKind = 'front' | 'back' | 'selfie';
const DOC_LABEL: Record<DocKind, string> = { front: 'Document front', back: 'Document back', selfie: 'Selfie' };

export interface KycDocumentsProps {
  detail: AdminKycDetail;
  /** `dataUpdatedAt` of the detail query: the presigned links were minted at this instant. */
  fetchedAt: number;
  onRefresh: () => void;
  refreshing?: boolean;
  /** Controlled zoom (so the page-level `Z` hotkey can open it). */
  zoom: DocKind | null;
  onZoomChange: (kind: DocKind | null) => void;
}

function docs(detail: AdminKycDetail): Array<{ kind: DocKind; url: string }> {
  const out: Array<{ kind: DocKind; url: string }> = [{ kind: 'front', url: detail.documents.front.url }];
  if (detail.documents.back) out.push({ kind: 'back', url: detail.documents.back.url });
  out.push({ kind: 'selfie', url: detail.documents.selfie.url });
  return out;
}

/** The three presigned images with a live "links expire in mm:ss" countdown, refetch and a zoom lightbox. */
export function KycDocuments({ detail, fetchedAt, onRefresh, refreshing, zoom, onZoomChange }: KycDocumentsProps) {
  const expiresAt = documentsExpireAt(detail, fetchedAt);
  const now = useNow(1000);
  const expired = now >= expiresAt;
  const soon = !expired && expiresAt - now < 60_000;
  const list = docs(detail);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  useEffect(() => setFailed({}), [fetchedAt]);

  const zoomIndex = zoom ? list.findIndex((d) => d.kind === zoom) : -1;
  const step = (delta: number) => {
    if (zoomIndex < 0) return;
    const next = list[(zoomIndex + delta + list.length) % list.length];
    if (next) onZoomChange(next.kind);
  };

  return (
    <div className="space-y-2" data-testid="kyc-documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <TimerReset className={cn('size-3.5', expired ? 'text-danger' : soon ? 'text-warning' : 'text-fg-subtle')} aria-hidden />
          {expired ? (
            <span className="font-medium text-danger">Document links expired - refresh to view.</span>
          ) : (
            <span>
              Links expire in{' '}
              <span className={cn('font-mono font-semibold tabular', soon && 'text-warning')} data-testid="kyc-doc-countdown">
                {formatRemaining(expiresAt, now)}
              </span>{' '}
              (presigned, private bucket)
            </span>
          )}
        </div>
        <Button variant="outline" size="xs" onClick={onRefresh} loading={refreshing}>
          <RefreshCw className="size-3" /> Refresh links
        </Button>
      </div>

      <div className={cn('grid gap-2', list.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {list.map((d) => (
          <figure key={d.kind} className="group relative overflow-hidden rounded-lg border bg-stone-950">
            <button
              type="button"
              className="block aspect-[4/3] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              onClick={() => onZoomChange(d.kind)}
              aria-label={`Zoom ${DOC_LABEL[d.kind]}`}
              disabled={expired}
            >
              {failed[d.kind] ? (
                <span className="flex h-full flex-col items-center justify-center gap-1 text-stone-400">
                  <ImageOff className="size-5" />
                  <span className="text-2xs">Could not load</span>
                </span>
              ) : (
                <img key={d.url} src={d.url} alt={DOC_LABEL[d.kind]} className={cn('h-full w-full object-contain transition-opacity', expired && 'opacity-30')} onError={() => setFailed((f) => ({ ...f, [d.kind]: true }))} />
              )}
              {!expired && !failed[d.kind] ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 opacity-0 transition-opacity group-hover:bg-stone-950/30 group-hover:opacity-100">
                  <ZoomIn className="size-6 text-white drop-shadow" />
                </span>
              ) : null}
            </button>
            <figcaption className="flex items-center justify-between gap-2 border-t bg-surface px-2 py-1 text-2xs text-fg-muted">
              <span className="font-medium">{DOC_LABEL[d.kind]}</span>
              <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-primary" aria-label={`Open ${DOC_LABEL[d.kind]} in a new tab`}>
                <ExternalLink className="size-3" />
              </a>
            </figcaption>
          </figure>
        ))}
        {!detail.documents.back ? (
          <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed text-2xs text-fg-subtle">No back side (passport / single-sided id)</div>
        ) : null}
      </div>

      <Dialog open={zoomIndex >= 0} onOpenChange={(o) => !o && onZoomChange(null)} title={zoom ? DOC_LABEL[zoom] : 'Document'} description={`${detail.fullName} · ${detail.user.phoneNumber}`} size="xl">
        {zoom && list[zoomIndex] ? (
          <div className="space-y-3">
            <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-stone-950">
              <img src={list[zoomIndex]!.url} alt={DOC_LABEL[zoom]} className="max-h-[70vh] w-auto max-w-full object-contain" />
            </div>
            <div className="flex items-center justify-between text-xs text-fg-muted">
              <Button variant="outline" size="sm" onClick={() => step(-1)} disabled={list.length < 2}>
                <ChevronLeft className="size-3.5" /> Previous
              </Button>
              <span className="flex items-center gap-1.5">
                <Badge tone="outline">
                  {zoomIndex + 1} / {list.length}
                </Badge>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd> switch · <Kbd>Esc</Kbd> close
              </span>
              <Button variant="outline" size="sm" onClick={() => step(1)} disabled={list.length < 2}>
                Next <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
      {zoomIndex >= 0 ? <ZoomKeys onStep={step} /> : null}
    </div>
  );
}

function ZoomKeys({ onStep }: { onStep: (delta: number) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') onStep(-1);
      else if (e.key === 'ArrowRight') onStep(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStep]);
  return null;
}
