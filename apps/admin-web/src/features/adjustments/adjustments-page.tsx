import { type CoinAdjustmentItem, type CoinAdjustmentStatus, coinsToEtb } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, Check, Coins, ExternalLink, Plus, ScrollText, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { adjustmentsApi, homeApi } from '@/lib/api/endpoints';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { getAdjustmentActionState } from '@/lib/domain/finance-rules';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatDateTime, formatEtb, formatRelative } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { ConfirmDialog, ReasonDialog } from '@/components/ui/confirm';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { IdChip, PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';
import { CreateAdjustmentDialog } from './create-adjustment-dialog';

const TABS: Array<{ value: CoinAdjustmentStatus | 'all'; label: string }> = [
  { value: 'pending_approval', label: 'Awaiting approval' },
  { value: 'executed', label: 'Executed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

const defaults = { status: 'pending_approval' as string, page: 1, limit: 20, userId: '' as string };

function SignedCoins({ amount, coinsPerEtb, className }: { amount: number; coinsPerEtb: number; className?: string }) {
  return (
    <span className={cn('tabular', amount < 0 ? 'text-danger' : 'text-success', className)}>
      {amount > 0 ? '+' : '−'}
      {formatCoins(Math.abs(amount))} <span className="text-fg-subtle">({formatEtb(coinsToEtb(Math.abs(amount), coinsPerEtb))})</span>
    </span>
  );
}

export function AdjustmentsPage() {
  const { adjustmentId } = useParams();
  const navigate = useNavigate();
  const { admin } = useAuth();
  const { params, set } = useListParams(defaults);
  const status = TABS.some((t) => t.value === params.status) ? params.status : 'pending_approval';
  const queryParams = useMemo(
    () => ({ status: status === 'all' ? undefined : (status as CoinAdjustmentStatus), page: params.page, limit: params.limit, userId: params.userId || undefined }),
    [status, params.page, params.limit, params.userId],
  );
  const list = useQuery({ queryKey: queryKeys.adjustments(queryParams), queryFn: () => adjustmentsApi.list(queryParams), refetchInterval: 30_000 });
  const config = useQuery({ queryKey: queryKeys.config, queryFn: homeApi.config, staleTime: 5 * 60_000 });
  const coinsPerEtb = config.data?.coinsPerEtb ?? 100;
  const [createOpen, setCreateOpen] = useState(false);

  const columns = useMemo<ColumnDef<CoinAdjustmentItem, unknown>[]>(
    () => [
      {
        id: 'created',
        header: 'Requested',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <div className="font-mono text-xs">
            {row.original.userPhone ?? <IdChip id={row.original.userId} />}
          </div>
        ),
        size: 150,
      },
      { id: 'amount', header: 'Amount', meta: { align: 'right' }, cell: ({ row }) => <SignedCoins amount={row.original.amount} coinsPerEtb={coinsPerEtb} className="font-medium" />, size: 190 },
      {
        id: 'reason',
        header: 'Reason',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate">{row.original.reason}</div>
            {row.original.reference ? <div className="font-mono text-2xs text-fg-subtle">{row.original.reference}</div> : null}
          </div>
        ),
      },
      {
        id: 'requestedBy',
        header: 'Requested by',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 text-xs">
            {row.original.requestedByEmail ?? row.original.requestedBy}
            {row.original.requestedBy === admin?.id ? (
              <Badge tone="primary" size="sm">
                you
              </Badge>
            ) : null}
          </span>
        ),
        size: 170,
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const st = getAdjustmentActionState(row.original, admin?.id);
          return (
            <div className="flex items-center gap-1.5">
              <StatusBadge status={row.original.status} />
              {st.isPending && st.isMine ? (
                <Tooltip content="You requested this - another admin must approve it">
                  <span className="text-2xs text-fg-subtle">needs other admin</span>
                </Tooltip>
              ) : null}
            </div>
          );
        },
        size: 190,
      },
    ],
    [admin?.id, coinsPerEtb],
  );

  const selectedFromList = list.data?.data.find((a) => a.id === adjustmentId);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Manual coin adjustments"
        description="Two-step workflow: one admin requests, a different admin approves. Only then is the ledger written - exactly once."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New adjustment
          </Button>
        }
      >
        <Tabs value={status} onValueChange={(v) => set({ status: v, page: 1 })}>
          <TabsList className="h-auto flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      {params.userId ? (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          Filtered to user <IdChip id={params.userId} to={`/users/${params.userId}`} />
          <Button variant="link" size="xs" onClick={() => set({ userId: '' })}>
            Clear
          </Button>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(a) => navigate({ pathname: `/adjustments/${a.id}`, search: window.location.search })}
        selectedRowId={adjustmentId ?? null}
        emptyState={
          <EmptyState
            compact
            icon={Coins}
            title={status === 'pending_approval' ? 'Nothing awaiting approval' : 'No adjustments'}
            description={status === 'pending_approval' ? 'Requests created by any finance or super admin will appear here for a second admin to approve.' : 'No requests with this status.'}
            action={
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="size-3.5" /> New adjustment
              </Button>
            }
          />
        }
        aria-label="Coin adjustment requests"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} isFetching={list.isFetching} />

      <CreateAdjustmentDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => navigate({ pathname: `/adjustments/${id}`, search: window.location.search })} />
      <AdjustmentSheet id={adjustmentId ?? null} initial={selectedFromList} coinsPerEtb={coinsPerEtb} onClose={() => navigate({ pathname: '/adjustments', search: window.location.search })} />
    </div>
  );
}

/* --------------------------------- detail -------------------------------- */

export function AdjustmentSheet({ id, initial, coinsPerEtb, onClose }: { id: string | null; initial?: CoinAdjustmentItem; coinsPerEtb: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { admin } = useAuth();
  const detail = useQuery({ queryKey: queryKeys.adjustment(id ?? ''), queryFn: () => adjustmentsApi.detail(id!), enabled: Boolean(id), initialData: initial, staleTime: 0 });
  const a = detail.data;
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const done = (res: CoinAdjustmentItem) => {
    queryClient.setQueryData(queryKeys.adjustment(id!), res);
    void queryClient.invalidateQueries({ queryKey: ['adjustments'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const approve = useMutation({
    mutationFn: (note: string) => adjustmentsApi.approve(id!, note || undefined),
    onSuccess: (res) => {
      toast.success('Adjustment executed', { description: `${res.amount > 0 ? '+' : ''}${formatCoins(res.amount)} coins written to the ledger for ${res.userPhone ?? 'the user'}.` });
      setApproveOpen(false);
      done(res);
    },
    onError: (err) => toast.error('Could not approve', { description: describeError(err) }),
  });
  const reject = useMutation({
    mutationFn: (reason: string) => adjustmentsApi.reject(id!, reason),
    onSuccess: (res) => {
      toast.success('Request rejected');
      setRejectOpen(false);
      done(res);
    },
    onError: (err) => toast.error('Could not reject', { description: describeError(err) }),
  });
  const cancel = useMutation({
    mutationFn: () => adjustmentsApi.cancel(id!),
    onSuccess: (res) => {
      toast.success('Request cancelled');
      setCancelOpen(false);
      done(res);
    },
    onError: (err) => toast.error('Could not cancel', { description: describeError(err) }),
  });

  const st = a ? getAdjustmentActionState(a, admin?.id) : null;
  const busy = approve.isPending || reject.isPending || cancel.isPending;

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      title={a ? (a.amount > 0 ? 'Credit request' : 'Deduction request') : 'Adjustment'}
      description={a ? `Requested ${formatDateTime(a.createdAt)} by ${a.requestedByEmail ?? a.requestedBy}` : undefined}
      footer={
        a && st && st.isPending ? (
          <>
            {st.canCancel ? (
              <Button variant="outline" onClick={() => setCancelOpen(true)} disabled={busy}>
                <Ban className="size-4" /> Cancel my request
              </Button>
            ) : null}
            {st.canReject ? (
              <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
                <X className="size-4 text-danger" /> Reject
              </Button>
            ) : null}
            <Tooltip content={st.approveBlockedReason} disabled={!st.approveBlockedReason}>
              <span className="inline-flex" tabIndex={st.canApprove ? -1 : 0}>
                <Button variant="success" onClick={() => setApproveOpen(true)} disabled={!st.canApprove || busy} data-testid="approve-adjustment">
                  <Check className="size-4" /> Approve & execute
                </Button>
              </span>
            </Tooltip>
          </>
        ) : null
      }
    >
      {!a ? (
        detail.isError ? (
          <EmptyState compact title="Could not load request" description={describeError(detail.error)} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-24 w-full" />
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            <SignedCoins amount={a.amount} coinsPerEtb={coinsPerEtb} className="text-lg font-semibold" />
          </div>

          {st?.isPending ? (
            <div className={cn('rounded-md border px-3 py-2 text-xs', st.isMine ? 'border-warning/40 bg-warning/10' : 'border-info/40 bg-info/10')} data-testid="self-approval-hint">
              {st.isMine
                ? 'You created this request. A different finance or super admin must approve it - the API rejects self-approval (ADJUSTMENT_SELF_APPROVAL_FORBIDDEN).'
                : `Requested by ${a.requestedByEmail ?? a.requestedBy}. Approving writes ${formatCoins(Math.abs(a.amount))} coins to the ledger exactly once and notifies the user.`}
            </div>
          ) : null}

          <Card>
            <CardHeader
              title="Request"
              actions={
                <Link to={`/users/${a.userId}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Open user <ExternalLink className="size-3" />
                </Link>
              }
            />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'User', value: a.userPhone ?? '—', mono: true },
                  { label: 'User id', value: <IdChip id={a.userId} to={`/users/${a.userId}`} /> },
                  { label: 'Reason', value: a.reason, span: 2 },
                  { label: 'Reference', value: a.reference ?? '—', mono: true },
                  { label: 'Request id', value: <IdChip id={a.id} /> },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Decision trail" />
            <CardBody>
              <ol className="relative space-y-4 border-l pl-4">
                <li>
                  <span className="absolute -left-1.5 mt-1 size-3 rounded-full border-2 border-surface bg-primary" aria-hidden />
                  <div className="text-sm font-medium">Requested</div>
                  <div className="text-xs text-fg-muted">
                    {a.requestedByEmail ?? a.requestedBy}
                    {a.requestedBy === admin?.id ? ' (you)' : ''} · {formatDateTime(a.createdAt)}
                  </div>
                </li>
                {a.status === 'executed' ? (
                  <li>
                    <span className="absolute -left-1.5 mt-1 size-3 rounded-full border-2 border-surface bg-success" aria-hidden />
                    <div className="text-sm font-medium">Approved & executed</div>
                    <div className="text-xs text-fg-muted">
                      {a.approvedByEmail ?? a.approvedBy}
                      {a.approvedBy === admin?.id ? ' (you)' : ''} · {formatDateTime(a.executedAt)}
                    </div>
                    {a.decisionNote ? <p className="mt-1 text-xs text-fg-muted">“{a.decisionNote}”</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link to={`/users/${a.userId}?tab=ledger&highlight=${a.ledgerEntryId ?? ''}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-sunken">
                        <Coins className="size-3" /> Ledger entry <span className="font-mono text-fg-subtle">{a.ledgerEntryId?.slice(0, 8)}</span>
                      </Link>
                      <Link to={`/audit?targetId=${a.id}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-sunken">
                        <ScrollText className="size-3" /> Audit rows
                      </Link>
                    </div>
                  </li>
                ) : a.status === 'rejected' ? (
                  <li>
                    <span className="absolute -left-1.5 mt-1 size-3 rounded-full border-2 border-surface bg-danger" aria-hidden />
                    <div className="text-sm font-medium">Rejected</div>
                    <div className="text-xs text-fg-muted">
                      <IdChip id={a.rejectedBy} /> · {formatDateTime(a.updatedAt)}
                    </div>
                    {a.decisionNote ? <p className="mt-1 text-xs text-danger">“{a.decisionNote}”</p> : null}
                  </li>
                ) : a.status === 'cancelled' ? (
                  <li>
                    <span className="absolute -left-1.5 mt-1 size-3 rounded-full border-2 border-surface bg-stone-400" aria-hidden />
                    <div className="text-sm font-medium">Cancelled by requester</div>
                    <div className="text-xs text-fg-muted">{formatDateTime(a.updatedAt)}</div>
                  </li>
                ) : (
                  <li>
                    <span className="absolute -left-1.5 mt-1 size-3 animate-pulse rounded-full border-2 border-surface bg-warning" aria-hidden />
                    <div className="text-sm font-medium">Awaiting a second admin</div>
                    <div className="text-xs text-fg-muted">Nothing has been credited or deducted yet.</div>
                  </li>
                )}
              </ol>
              {a.status !== 'executed' ? (
                <div className="mt-3">
                  <Link to={`/audit?targetId=${a.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    <ScrollText className="size-3" /> View audit rows
                  </Link>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      )}

      {a ? (
        <>
          <ReasonDialog
            open={approveOpen}
            onOpenChange={setApproveOpen}
            title="Approve and execute"
            description={`${a.amount > 0 ? 'Credit' : 'Deduct'} ${formatCoins(Math.abs(a.amount))} coins (${formatEtb(coinsToEtb(Math.abs(a.amount), coinsPerEtb))}) ${a.amount > 0 ? 'to' : 'from'} ${a.userPhone ?? 'the user'}. The ledger entry is written immediately and cannot be undone - only reversed with a new adjustment.`}
            confirmLabel="Approve & write ledger"
            confirmVariant="success"
            reasonLabel="Note"
            optional
            loading={approve.isPending}
            onConfirm={(note) => approve.mutate(note)}
          />
          <ReasonDialog open={rejectOpen} onOpenChange={setRejectOpen} destructive title="Reject request" description="The requester will see your reason. Nothing is credited." confirmLabel="Reject" loading={reject.isPending} onConfirm={(reason) => reject.mutate(reason)} />
          <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title="Cancel your request?" description="Only the requesting admin can cancel. The request is closed without any ledger change." confirmLabel="Cancel request" loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
        </>
      ) : null}
    </Sheet>
  );
}
