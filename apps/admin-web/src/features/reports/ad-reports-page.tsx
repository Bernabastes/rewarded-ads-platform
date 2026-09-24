import type { AdminAdReportItem, AdReportStatus } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Flag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { adReportsApi } from '@/lib/api/endpoints';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { useListParams } from '@/lib/hooks/use-list-params';
import { formatDateTime, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/feedback';
import { Field, NativeSelect, Textarea } from '@/components/ui/input';
import { IdChip, PageHeader } from '@/components/ui/page';
import { Checkbox, Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';

const TABS: Array<{ value: AdReportStatus | 'all'; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'dismissed', label: 'Dismissed' },
];

const defaults = { status: 'open' as string, page: 1, limit: 25 };

const REASON_TONE: Record<string, 'danger' | 'warning' | 'accent' | 'neutral' | 'info'> = {
  banned_topic: 'danger',
  offensive: 'danger',
  misleading: 'warning',
  inappropriate: 'accent',
  broken_media: 'info',
  other: 'neutral',
};

export function AdReportsPage() {
  const { params, set } = useListParams(defaults);
  const status = TABS.some((t) => t.value === params.status) ? (params.status as AdReportStatus) : 'open';
  const queryParams = useMemo(() => ({ status, page: params.page, limit: params.limit }), [status, params.page, params.limit]);
  const list = useQuery({ queryKey: queryKeys.adReports(queryParams), queryFn: () => adReportsApi.list(queryParams), placeholderData: (p) => p });
  const [active, setActive] = useState<AdminAdReportItem | null>(null);
  const { can } = useAuth();

  const columns = useMemo<ColumnDef<AdminAdReportItem, unknown>[]>(
    () => [
      {
        id: 'created',
        header: 'Reported',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
      {
        id: 'ad',
        header: 'Ad',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.adTitle}</div>
            {can('adDetail') ? (
              <Link to={`/review/${row.original.adId}?status=approved`} onClick={(e) => e.stopPropagation()} className="text-2xs text-primary hover:underline">
                Open creative
              </Link>
            ) : (
              <IdChip id={row.original.adId} />
            )}
          </div>
        ),
      },
      { id: 'reason', header: 'Reason', cell: ({ row }) => <Badge tone={REASON_TONE[row.original.reason] ?? 'neutral'}>{humanize(row.original.reason)}</Badge>, size: 130 },
      { id: 'details', header: 'Details', cell: ({ row }) => <span className="text-xs text-fg-muted">{row.original.details ?? '—'}</span> },
      { id: 'user', header: 'Reporter', cell: ({ row }) => <IdChip id={row.original.userId} to={can('users') ? `/users/${row.original.userId}` : undefined} />, size: 120 },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} />, size: 110 },
    ],
    [can],
  );

  return (
    <div className="space-y-3">
      <PageHeader title="Ad reports" description="Reports submitted by users from the app. Close them as reviewed or dismissed - optionally pulling the ad.">
        <Tabs value={status} onValueChange={(v) => set({ status: v, page: 1 })}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>
      <DataTable
        columns={columns}
        data={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={status === 'open' ? (r) => setActive(r) : undefined}
        emptyState={<EmptyState compact icon={Flag} title={status === 'open' ? 'No open reports' : `No ${status} reports`} description="Users can report an ad from the player; reports land here." />}
        aria-label="Ad reports"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />
      <ReviewReportDialog report={active} onClose={() => setActive(null)} />
    </div>
  );
}

function ReviewReportDialog({ report, onClose }: { report: AdminAdReportItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<'reviewed' | 'dismissed'>('reviewed');
  const [note, setNote] = useState('');
  const [rejectAd, setRejectAd] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [touched, setTouched] = useState(false);

  const reset = () => {
    setOutcome('reviewed');
    setNote('');
    setRejectAd(false);
    setRejectionReason('');
    setTouched(false);
  };

  const review = useMutation({
    mutationFn: () => adReportsApi.review(report!.id, { outcome, note: note.trim() || undefined, rejectAd: rejectAd || undefined, rejectionReason: rejectAd ? rejectionReason.trim() : undefined }),
    onSuccess: () => {
      toast.success(rejectAd ? 'Report closed and ad pulled' : outcome === 'reviewed' ? 'Report marked reviewed' : 'Report dismissed');
      void queryClient.invalidateQueries({ queryKey: ['ad-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      reset();
      onClose();
    },
    onError: (err) => toast.error('Could not close report', { description: describeError(err) }),
  });

  const reasonInvalid = rejectAd && rejectionReason.trim().length < 5;

  return (
    <Dialog
      open={Boolean(report)}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
      locked={review.isPending}
      title="Close report"
      description={report ? `“${report.adTitle}” · reported as ${humanize(report.reason)}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={review.isPending}>
            Cancel
          </Button>
          <Button
            variant={rejectAd ? 'danger' : 'primary'}
            loading={review.isPending}
            onClick={() => {
              setTouched(true);
              if (!reasonInvalid) review.mutate();
            }}
          >
            {rejectAd ? 'Close & pull ad' : 'Close report'}
          </Button>
        </>
      }
    >
      {report ? (
        <div className="space-y-4">
          {report.details ? <blockquote className="rounded-md border-l-2 border-accent bg-sunken/50 px-3 py-2 text-sm text-fg-muted">“{report.details}”</blockquote> : null}
          <Field label="Outcome" required>
            {(id) => (
              <NativeSelect id={id} value={outcome} onChange={(e) => setOutcome(e.target.value as 'reviewed' | 'dismissed')}>
                <option value="reviewed">Reviewed - report was valid / actioned</option>
                <option value="dismissed">Dismissed - not actionable</option>
              </NativeSelect>
            )}
          </Field>
          <Field label="Note" hint="Optional, stored with the report and the audit row.">
            {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
          </Field>
          <div className="rounded-md border p-3">
            <Checkbox id="reject-ad" checked={rejectAd} onCheckedChange={(v) => setRejectAd(v === true)} label="Pull the ad from the feed" description="Sets the creative’s review status to rejected with the reason below." />
            {rejectAd ? (
              <Field className="mt-3" label="Rejection reason" required error={touched && reasonInvalid ? 'At least 5 characters.' : null}>
                {(id) => <Textarea id={id} rows={2} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} maxLength={1000} invalid={touched && reasonInvalid} placeholder="e.g. Claims zero fees but the app charges a transfer fee (misleading)." />}
              </Field>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
