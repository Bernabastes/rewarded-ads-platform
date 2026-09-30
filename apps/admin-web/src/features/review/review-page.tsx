import { type BannedTopicKey, type MediaStatus, type ReviewStatus } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCheck, Clapperboard, Flag, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { reviewApi } from '@/lib/api/endpoints';
import { describeError, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { AdReview } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/use-auth';
import { allChecks, type Checks, emptyChecks, isChecklistComplete, mediaApproveBlock, toChecklist } from '@/lib/domain/review-rules';
import { useHotkeys } from '@/lib/hooks/use-hotkeys';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { formatDuration, formatRelative } from '@/lib/utils/format';
import { Badge, MEDIA_STATUS_TONE, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PaginationBar } from '@/components/ui/data-table';
import { EmptyState, ErrorState, Kbd, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';
import { RejectDialog } from './reject-dialog';
import { MediaStatusBadge, ReviewPane } from './review-pane';

const TABS: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** Media pipeline filter (`?mediaStatus=`); "All" keeps the parameter out of the URL and the request. */
const MEDIA_FILTERS: Array<{ value: MediaStatus; label: string; hint: string; empty: string }> = [
  { value: 'processing', label: 'Processing', hint: 'Probe / transcode / poster still running (approval is blocked)', empty: 'still being processed' },
  { value: 'ready', label: 'Ready', hint: 'Transcoded and ready for the feed', empty: 'transcoded and ready' },
  { value: 'duration_corrected', label: 'Duration corrected', hint: 'Declared duration differed from the probed one by more than 1 s', empty: 'duration-corrected' },
  { value: 'failed', label: 'Failed', hint: 'Media pipeline failed - reprocess or ask for a re-upload (approval is blocked)', empty: 'failed media processing' },
];

const MEDIA_FILTER_VALUES = MEDIA_FILTERS.map((f) => f.value) as string[];

const defaults = { status: 'pending' as string, mediaStatus: '' as string, page: 1, limit: 50 };

export function ReviewPage() {
  const { adId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canDecide = can('adDecide');
  const reduce = useReducedMotion();
  const { params, set } = useListParams(defaults);
  const status = (TABS.some((t) => t.value === params.status) ? params.status : 'pending') as ReviewStatus;
  const mediaFilter = (MEDIA_FILTER_VALUES.includes(params.mediaStatus) ? params.mediaStatus : '') as MediaStatus | '';
  const mediaFilterMeta = MEDIA_FILTERS.find((f) => f.value === mediaFilter);

  const queryParams = useMemo(
    () => ({ status, page: params.page, limit: params.limit, ...(mediaFilter ? { mediaStatus: mediaFilter } : {}) }),
    [status, params.page, params.limit, mediaFilter],
  );
  const queue = useQuery({ queryKey: queryKeys.reviewQueue(queryParams), queryFn: () => reviewApi.queue(queryParams), refetchInterval: (q) => (q.state.data?.data.some((a) => a.mediaStatus === 'processing') ? 10_000 : status === 'pending' ? 30_000 : false) });
  const items = useMemo(() => queue.data?.data ?? [], [queue.data]);

  // Unfiltered total for the current tab, so the tab count and the empty state stay meaningful while a media filter is active.
  const unfilteredParams = useMemo(() => ({ status, page: 1, limit: 1 }), [status]);
  const unfiltered = useQuery({ queryKey: queryKeys.reviewQueue(unfilteredParams), queryFn: () => reviewApi.queue(unfilteredParams), enabled: Boolean(mediaFilter) });
  const tabTotal = mediaFilter ? unfiltered.data?.meta.total : queue.data?.meta.total;

  // Selected ad: URL param, else first in list.
  const selectedId = adId ?? items[0]?.id ?? null;
  const selectedFromList = items.find((a) => a.id === selectedId);
  const detail = useQuery({
    queryKey: queryKeys.ad(selectedId ?? ''),
    queryFn: () => reviewApi.ad(selectedId!),
    enabled: Boolean(selectedId) && !selectedFromList,
    refetchInterval: (q) => (q.state.data?.mediaStatus === 'processing' ? 10_000 : false),
  });
  const selected: AdReview | undefined = selectedFromList ?? detail.data;

  useEffect(() => {
    if (!adId && items[0]) navigate(`/review/${items[0].id}?${new URLSearchParams(window.location.search)}`.replace(/\?$/, ''), { replace: true });
  }, [adId, items, navigate]);

  // Per-ad checklist state (reset when switching ads).
  const [checks, setChecks] = useState<Checks>(emptyChecks);
  const [notes, setNotes] = useState('');
  const [flagged, setFlagged] = useState<BannedTopicKey[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => {
    setChecks(emptyChecks());
    setNotes('');
    setFlagged([]);
    setRejectOpen(false);
    setServerError(null);
  }, [selectedId]);

  const select = useCallback(
    (id: string) => navigate({ pathname: `/review/${id}`, search: window.location.search }),
    [navigate],
  );

  const removeFromQueue = (id: string) => {
    const index = items.findIndex((a) => a.id === id);
    const next = items[index + 1] ?? items[index - 1];
    queryClient.setQueryData(queryKeys.reviewQueue(queryParams), (old: typeof queue.data) =>
      old ? { ...old, data: old.data.filter((a) => a.id !== id), meta: { ...old.meta, total: Math.max(0, old.meta.total - 1) } } : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['review'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    navigate({ pathname: next ? `/review/${next.id}` : '/review', search: window.location.search }, { replace: true });
  };

  const approve = useMutation({
    mutationFn: (ad: AdReview) => reviewApi.approve(ad.id, { bannedTopicsChecklist: toChecklist(checks, notes), note: notes.trim() || undefined }),
    onSuccess: (_res, ad) => {
      toast.success('Ad approved', { description: ad.title });
      removeFromQueue(ad.id);
    },
    onError: (err) => toast.error('Could not approve', { description: describeError(err) }),
  });

  const reject = useMutation({
    mutationFn: ({ ad, reason }: { ad: AdReview; reason: string }) => reviewApi.reject(ad.id, reason, isChecklistComplete(checks) || flagged.length ? toChecklist(checks, notes) : undefined),
    onSuccess: (_res, { ad }) => {
      toast.success('Ad rejected', { description: ad.title });
      setRejectOpen(false);
      removeFromQueue(ad.id);
    },
    onError: (err) => {
      if (isApiError(err) && (err.code === 'REJECTION_REASON_REQUIRED' || err.code === 'VALIDATION_ERROR')) setServerError(describeError(err));
      else toast.error('Could not reject', { description: describeError(err) });
    },
  });

  const reprocess = useMutation({
    mutationFn: (ad: AdReview) => reviewApi.reprocessMedia(ad.id),
    onSuccess: (res, ad) => {
      toast.success('Media re-queued', { description: `${ad.title}: probe, transcode and poster will run again. The status updates automatically.` });
      // Patch the list + detail caches with the fresh row (status is back to `processing`), then poll.
      queryClient.setQueryData(queryKeys.reviewQueue(queryParams), (old: typeof queue.data) => (old ? { ...old, data: old.data.map((a) => (a.id === ad.id ? { ...a, ...res } : a)) } : old));
      queryClient.setQueryData(queryKeys.ad(ad.id), (old: AdReview | undefined) => (old ? { ...old, ...res } : res));
      void queryClient.invalidateQueries({ queryKey: ['review'] });
    },
    onError: (err) => toast.error('Could not reprocess media', { description: describeError(err) }),
  });

  const busy = approve.isPending || reject.isPending;
  const pending = selected?.reviewStatus === 'pending';
  const mediaReady = selected ? mediaApproveBlock(selected) === null : false;

  const move = (delta: number) => {
    if (!items.length) return;
    const idx = Math.max(0, items.findIndex((a) => a.id === selectedId));
    const next = items[Math.min(items.length - 1, Math.max(0, idx + delta))];
    if (next && next.id !== selectedId) select(next.id);
  };

  const hotkeys: Record<string, (e: KeyboardEvent) => void> = {
    j: () => move(1),
    k: () => move(-1),
    arrowdown: (e) => {
      e.preventDefault();
      move(1);
    },
    arrowup: (e) => {
      e.preventDefault();
      move(-1);
    },
    a: () => {
      if (selected && pending && canDecide && mediaReady && isChecklistComplete(checks) && !flagged.length && !busy) approve.mutate(selected);
    },
    r: () => {
      if (selected && pending && canDecide && !busy) setRejectOpen(true);
    },
    'shift+a': () => {
      if (pending && canDecide) setChecks((c) => allChecks(!isChecklistComplete(c)));
    },
  };
  for (let i = 1; i <= 8; i++) {
    hotkeys[String(i)] = () => {
      if (!pending || !canDecide) return;
      const key = Object.keys(checks)[i - 1] as BannedTopicKey | undefined;
      if (key && !flagged.includes(key)) setChecks((c) => ({ ...c, [key]: !c[key] }));
    };
  }
  useHotkeys(hotkeys, { enabled: !rejectOpen });

  const toggleFlagged = (key: BannedTopicKey) =>
    setFlagged((f) => {
      const next = f.includes(key) ? f.filter((k) => k !== key) : [...f, key];
      // A topic marked present cannot simultaneously be "confirmed absent".
      if (!f.includes(key)) setChecks((c) => ({ ...c, [key]: false }));
      return next;
    });

  return (
    <div className="space-y-3">
      <PageHeader
        title="Ad review"
        description="Approve creatives only after confirming every banned topic is absent. Rejections need a reason."
        actions={
          <div className="hidden items-center gap-1.5 text-xs text-fg-subtle md:flex">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> navigate · <Kbd>A</Kbd> approve · <Kbd>R</Kbd> reject · <Kbd>1</Kbd>–<Kbd>8</Kbd> tick
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={status} onValueChange={(v) => set({ status: v, page: 1 })}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                  {t.value === 'pending' && status === 'pending' && tabTotal !== undefined ? <Badge tone="accent" size="sm" className="tabular">{tabTotal}</Badge> : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div role="group" aria-label="Media status filter" data-testid="media-filter" className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 inline-flex items-center gap-1 text-xs text-fg-subtle">
              <Clapperboard className="size-3" aria-hidden /> Media
            </span>
            <Button variant={mediaFilter === '' ? 'secondary' : 'ghost'} size="xs" aria-pressed={mediaFilter === ''} onClick={() => set({ mediaStatus: '' })}>
              All
            </Button>
            {MEDIA_FILTERS.map((f) => {
              const active = mediaFilter === f.value;
              return (
                <Tooltip key={f.value} content={f.hint}>
                  <Button variant={active ? 'secondary' : 'ghost'} size="xs" aria-pressed={active} onClick={() => set({ mediaStatus: active ? '' : f.value })} className={cn(active && 'ring-1 ring-border-strong')}>
                    <span className={cn('size-1.5 rounded-full', MEDIA_STATUS_TONE[f.value] === 'info' && 'bg-info', MEDIA_STATUS_TONE[f.value] === 'success' && 'bg-success', MEDIA_STATUS_TONE[f.value] === 'warning' && 'bg-warning', MEDIA_STATUS_TONE[f.value] === 'danger' && 'bg-danger')} aria-hidden />
                    {f.label}
                    {active && queue.data ? <span className="tabular text-fg-subtle">{queue.data.meta.total}</span> : null}
                  </Button>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
        <aside className="flex max-h-[calc(100vh-13rem)] flex-col overflow-hidden rounded-lg border bg-surface shadow-card" aria-label="Review queue">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {queue.isPending ? (
              <div className="space-y-px p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex gap-3 p-2">
                    <Skeleton className="h-12 w-20 shrink-0" />
                    <div className="flex-1 space-y-2 py-1">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : queue.isError ? (
              <ErrorState error={queue.error} onRetry={() => void queue.refetch()} compact />
            ) : items.length === 0 ? (
              mediaFilterMeta ? (
                <EmptyState
                  compact
                  icon={Clapperboard}
                  title={`No ${mediaFilterMeta.label.toLowerCase()} creatives`}
                  description={
                    unfiltered.data
                      ? unfiltered.data.meta.total === 0
                        ? `There are no ${status} ads at all right now.`
                        : `None of the ${unfiltered.data.meta.total} ${status} ${unfiltered.data.meta.total === 1 ? 'ad is' : 'ads are'} ${mediaFilterMeta.empty}.`
                      : `No ${status} ads match this media filter.`
                  }
                  action={
                    <Button variant="outline" size="sm" onClick={() => set({ mediaStatus: '' })} data-testid="media-filter-clear">
                      Show all media
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  compact
                  icon={status === 'pending' ? CheckCheck : Video}
                  title={status === 'pending' ? 'Queue is clear' : `No ${status} ads`}
                  description={status === 'pending' ? 'Every submitted creative has been reviewed. New submissions appear here automatically.' : 'Decisions will show up here once made.'}
                />
              )
            ) : (
              <ul role="listbox" aria-label={`${status} ads`} className="divide-y">
                <AnimatePresence initial={false}>
                  {items.map((ad) => {
                    const active = ad.id === selectedId;
                    return (
                      <motion.li
                        key={ad.id}
                        layout={!reduce}
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={reduce ? undefined : { opacity: 0, x: -12, height: 0 }}
                        transition={{ duration: 0.18 }}
                        role="option"
                        aria-selected={active}
                      >
                        <button
                          type="button"
                          onClick={() => select(ad.id)}
                          className={cn(
                            'flex w-full items-start gap-3 p-2 text-left transition-colors hover:bg-sunken/70 focus-visible:bg-sunken focus-visible:outline-none',
                            active && 'bg-primary-soft hover:bg-primary-soft',
                          )}
                        >
                          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-stone-900">
                            {ad.thumbnailUrl ? <img src={ad.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Video className="absolute inset-0 m-auto size-4 text-stone-500" />}
                            <span className="absolute right-1 bottom-1 rounded bg-stone-950/80 px-1 font-mono text-2xs text-stone-100 tabular">{formatDuration(ad.durationSeconds)}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={cn('truncate text-sm font-medium', active ? 'text-primary' : 'text-fg')}>{ad.title}</span>
                              {ad.openReports > 0 ? <Flag className="size-3 shrink-0 text-danger" aria-label={`${ad.openReports} reports`} /> : null}
                            </div>
                            <div className="truncate text-xs text-fg-muted">{ad.campaign.title}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-fg-subtle">
                              <span className="truncate">{ad.advertiser.businessName}</span>
                              <span>·</span>
                              <span className="shrink-0">{formatRelative(ad.createdAt)}</span>
                              {status !== 'pending' ? <StatusBadge status={ad.reviewStatus} size="sm" /> : null}
                              {ad.mediaStatus !== 'ready' ? <MediaStatusBadge ad={ad} size="sm" /> : null}
                            </div>
                          </div>
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </div>
          {queue.data && queue.data.meta.total > params.limit ? (
            <PaginationBar page={params.page} limit={params.limit} total={queue.data.meta.total} onPageChange={(p) => set({ page: p })} className="border-t" isFetching={queue.isFetching} />
          ) : null}
        </aside>

        <section aria-label="Review pane" className="min-w-0">
          {selected ? (
            <ReviewPane
              key={selected.id}
              ad={selected}
              mode={status}
              checks={checks}
              onChecksChange={setChecks}
              notes={notes}
              onNotesChange={setNotes}
              flagged={flagged}
              onToggleFlagged={toggleFlagged}
              onApprove={() => approve.mutate(selected)}
              onReject={() => setRejectOpen(true)}
              approving={approve.isPending}
              canDecide={canDecide}
              onReprocessMedia={can('mediaReprocess') ? () => reprocess.mutate(selected) : undefined}
              reprocessing={reprocess.isPending}
            />
          ) : detail.isError ? (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          ) : queue.isPending || detail.isPending && selectedId ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="aspect-video w-full max-w-3xl" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <EmptyState icon={Video} title="Select an ad" description="Pick a creative from the queue to start reviewing." />
          )}
        </section>
      </div>

      {selected ? (
        <RejectDialog
          open={rejectOpen}
          onOpenChange={setRejectOpen}
          adTitle={selected.title}
          flaggedTopics={flagged}
          loading={reject.isPending}
          serverError={serverError}
          onConfirm={(reason) => reject.mutate({ ad: selected, reason })}
        />
      ) : null}
    </div>
  );
}
