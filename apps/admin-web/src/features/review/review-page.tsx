import { type BannedTopicKey, type ReviewStatus } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCheck, Flag, Video } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { reviewApi } from '@/lib/api/endpoints';
import { describeError, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { AdReview } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/use-auth';
import { allChecks, type Checks, emptyChecks, isChecklistComplete, toChecklist } from '@/lib/domain/review-rules';
import { useHotkeys } from '@/lib/hooks/use-hotkeys';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { formatDuration, formatRelative } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { PaginationBar } from '@/components/ui/data-table';
import { EmptyState, ErrorState, Kbd, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { RejectDialog } from './reject-dialog';
import { ReviewPane } from './review-pane';

const TABS: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const defaults = { status: 'pending' as string, page: 1, limit: 50 };

export function ReviewPage() {
  const { adId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canDecide = can('adDecide');
  const reduce = useReducedMotion();
  const { params, set } = useListParams(defaults);
  const status = (TABS.some((t) => t.value === params.status) ? params.status : 'pending') as ReviewStatus;

  const queryParams = useMemo(() => ({ status, page: params.page, limit: params.limit }), [status, params.page, params.limit]);
  const queue = useQuery({ queryKey: queryKeys.reviewQueue(queryParams), queryFn: () => reviewApi.queue(queryParams), refetchInterval: status === 'pending' ? 30_000 : false });
  const items = useMemo(() => queue.data?.data ?? [], [queue.data]);

  // Selected ad: URL param, else first in list.
  const selectedId = adId ?? items[0]?.id ?? null;
  const selectedFromList = items.find((a) => a.id === selectedId);
  const detail = useQuery({
    queryKey: queryKeys.ad(selectedId ?? ''),
    queryFn: () => reviewApi.ad(selectedId!),
    enabled: Boolean(selectedId) && !selectedFromList,
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

  const busy = approve.isPending || reject.isPending;
  const pending = selected?.reviewStatus === 'pending';

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
      if (selected && pending && canDecide && isChecklistComplete(checks) && !flagged.length && !busy) approve.mutate(selected);
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
        <Tabs value={status} onValueChange={(v) => set({ status: v, page: 1 })}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.value === 'pending' && queue.data && status === 'pending' ? <Badge tone="accent" size="sm" className="tabular">{queue.data.meta.total}</Badge> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
              <EmptyState
                compact
                icon={status === 'pending' ? CheckCheck : Video}
                title={status === 'pending' ? 'Queue is clear' : `No ${status} ads`}
                description={status === 'pending' ? 'Every submitted creative has been reviewed. New submissions appear here automatically.' : 'Decisions will show up here once made.'}
              />
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
