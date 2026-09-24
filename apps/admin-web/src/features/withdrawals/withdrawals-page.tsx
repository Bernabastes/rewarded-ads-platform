import { type WithdrawalStatus } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Check, Eye, EyeOff, RotateCcw, Sparkles, UserRound, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { homeApi, withdrawalsApi } from '@/lib/api/endpoints';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { AdminWithdrawal } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/use-auth';
import { getWithdrawalApprovalState, MAX_PAYOUT_ATTEMPTS_DEFAULT } from '@/lib/domain/finance-rules';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatDateTime, formatEtb, formatEtbBare, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { ReasonDialog } from '@/components/ui/confirm';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { IdChip, PageHeader, Progress } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';

const TABS: Array<{ value: WithdrawalStatus | 'all'; label: string }> = [
  { value: 'flagged_for_review', label: 'Held for review' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

const defaults = { status: 'flagged_for_review' as string, page: 1, limit: 20, userId: '' as string };

export function WithdrawalsPage() {
  const { withdrawalId } = useParams();
  const navigate = useNavigate();
  const { params, set } = useListParams(defaults);
  const status = TABS.some((t) => t.value === params.status) ? params.status : 'flagged_for_review';
  const queryParams = useMemo(
    () => ({ status: status === 'all' ? undefined : (status as WithdrawalStatus), page: params.page, limit: params.limit, userId: params.userId || undefined }),
    [status, params.page, params.limit, params.userId],
  );
  const list = useQuery({ queryKey: queryKeys.withdrawals(queryParams), queryFn: () => withdrawalsApi.list(queryParams), refetchInterval: 20_000 });
  const config = useQuery({ queryKey: queryKeys.config, queryFn: homeApi.config, staleTime: 5 * 60_000 });
  const { admin } = useAuth();

  const columns = useMemo<ColumnDef<AdminWithdrawal, unknown>[]>(
    () => [
      {
        id: 'requested',
        header: 'Requested',
        accessorFn: (r) => r.requestedAt,
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.requestedAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.requestedAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-medium">
              {row.original.user.fullName ?? <span className="text-fg-subtle">Unnamed</span>}
              {row.original.isFirstWithdrawal ? (
                <Tooltip content="First-ever withdrawal for this account - manual review required">
                  <span>
                    <Badge tone="info" size="sm" className="gap-0.5">
                      <Sparkles className="size-2.5" /> 1st
                    </Badge>
                  </span>
                </Tooltip>
              ) : null}
            </div>
            <div className="font-mono text-2xs text-fg-subtle">
              {row.original.user.phoneNumber} · trust {row.original.user.trustScore}
            </div>
          </div>
        ),
      },
      {
        id: 'amount',
        header: 'Amount',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <div>
            <div className="font-medium">ETB {formatEtbBare(row.original.amountEtb)}</div>
            <div className="text-2xs text-fg-subtle">{formatCoins(row.original.coinAmount)} coins</div>
          </div>
        ),
        size: 120,
      },
      {
        id: 'method',
        header: 'Method',
        cell: ({ row }) => (
          <div>
            <div>{humanize(row.original.payoutMethod)}</div>
            <div className="font-mono text-2xs text-fg-subtle">{row.original.payoutDestination}</div>
          </div>
        ),
        size: 150,
      },
      {
        id: 'review',
        header: 'Review',
        cell: ({ row }) => {
          const w = row.original;
          const st = getWithdrawalApprovalState(w, admin?.id);
          return (
            <div className="flex flex-wrap items-center gap-1">
              {w.requiresDualApproval ? (
                <Badge tone={st.count >= 2 ? 'success' : 'accent'} className="gap-1 tabular">
                  {st.count}/2 approvals
                </Badge>
              ) : null}
              {w.reviewReasons
                .filter((r) => !(r === 'large_amount' && w.requiresDualApproval))
                .map((r) => (
                  <Badge key={r} tone="neutral" size="sm">
                    {humanize(r)}
                  </Badge>
                ))}
              {st.alreadyApprovedByMe && w.status === 'flagged_for_review' ? (
                <Badge tone="primary" size="sm">
                  you approved
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} />, size: 140 },
    ],
    [admin?.id],
  );

  const selectedFromList = list.data?.data.find((w) => w.id === withdrawalId);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Withdrawal queue"
        description={`Held requests need finance approval; amounts ≥ ${config.data ? formatEtb(config.data.largeWithdrawalThresholdEtb) : '…'} need two distinct approvers.`}
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
        onRowClick={(w) => navigate({ pathname: `/withdrawals/${w.id}`, search: window.location.search })}
        selectedRowId={withdrawalId ?? null}
        emptyState={
          <EmptyState
            compact
            title="No withdrawals here"
            description={
              status === 'flagged_for_review'
                ? 'Nothing is waiting for a decision. Requests that trip the first-withdrawal, large-amount or low-trust rules will appear here.'
                : 'No requests with this status.'
            }
          />
        }
        aria-label="Withdrawals"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} isFetching={list.isFetching} />

      <WithdrawalSheet id={withdrawalId ?? null} initial={selectedFromList} onClose={() => navigate({ pathname: '/withdrawals', search: window.location.search })} />
    </div>
  );
}

/* --------------------------------- detail -------------------------------- */

export function WithdrawalSheet({ id, initial, onClose }: { id: string | null; initial?: AdminWithdrawal; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { admin } = useAuth();
  const detail = useQuery({ queryKey: queryKeys.withdrawal(id ?? ''), queryFn: () => withdrawalsApi.detail(id!), enabled: Boolean(id), initialData: initial, staleTime: 0 });
  const w = detail.data;
  const [reveal, setReveal] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const maxAttempts = MAX_PAYOUT_ATTEMPTS_DEFAULT;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const approve = useMutation({
    mutationFn: (note: string) => withdrawalsApi.approve(id!, note || undefined),
    onSuccess: (res) => {
      const st = getWithdrawalApprovalState(res, admin?.id);
      toast.success(res.status === 'pending' ? 'Withdrawal approved - payout queued' : `Approval recorded (${st.count}/${st.required})`, {
        description:
          res.status === 'pending'
            ? `ETB ${formatEtbBare(res.amountEtb)} is being sent via ${humanize(res.payoutMethod)}.`
            : 'A different finance or super admin must provide the second approval.',
      });
      queryClient.setQueryData(queryKeys.withdrawal(id!), res);
      setApproveOpen(false);
      invalidate();
    },
    onError: (err) => toast.error('Could not approve', { description: describeError(err) }),
  });
  const reject = useMutation({
    mutationFn: (reason: string) => withdrawalsApi.reject(id!, reason),
    onSuccess: (res) => {
      toast.success('Withdrawal rejected', { description: 'The held coins were returned to the user’s balance.' });
      queryClient.setQueryData(queryKeys.withdrawal(id!), res);
      setRejectOpen(false);
      invalidate();
    },
    onError: (err) => toast.error('Could not reject', { description: describeError(err) }),
  });
  const retry = useMutation({
    mutationFn: () => withdrawalsApi.retry(id!),
    onSuccess: (res) => {
      toast.success('Payout re-queued', { description: 'A fresh hold was taken and the payout will be retried.' });
      queryClient.setQueryData(queryKeys.withdrawal(id!), res);
      invalidate();
    },
    onError: (err) => toast.error('Could not retry', { description: describeError(err) }),
  });

  const st = w ? getWithdrawalApprovalState(w, admin?.id, maxAttempts) : null;
  const busy = approve.isPending || reject.isPending || retry.isPending;

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      title={w ? `Withdrawal · ETB ${formatEtbBare(w.amountEtb)}` : 'Withdrawal'}
      description={w ? `${formatCoins(w.coinAmount)} coins · requested ${formatDateTime(w.requestedAt)}` : undefined}
      footer={
        w && st ? (
          <>
            {st.canRetry ? (
              <Button variant="outline" onClick={() => retry.mutate()} loading={retry.isPending} disabled={busy}>
                <RotateCcw className="size-4" /> Retry payout
              </Button>
            ) : null}
            {st.canReject ? (
              <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
                <X className="size-4 text-danger" /> Reject
              </Button>
            ) : null}
            {w.status === 'flagged_for_review' ? (
              <Tooltip content={st.approveBlockedReason} disabled={!st.approveBlockedReason}>
                <span className="inline-flex" tabIndex={st.canApprove ? -1 : 0}>
                  <Button variant="success" onClick={() => setApproveOpen(true)} disabled={!st.canApprove || busy} data-testid="approve-withdrawal">
                    <Check className="size-4" /> {w.requiresDualApproval ? `Approve (${Math.min(st.count + 1, 2)} of 2)` : 'Approve'}
                  </Button>
                </span>
              </Tooltip>
            ) : null}
          </>
        ) : null
      }
    >
      {!w ? (
        detail.isError ? (
          <EmptyState compact title="Could not load withdrawal" description={describeError(detail.error)} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={w.status} />
            {w.isFirstWithdrawal ? (
              <Badge tone="info" className="gap-1">
                <Sparkles className="size-3" /> First withdrawal
              </Badge>
            ) : null}
            {w.reviewReasons.map((r) => (
              <Badge key={r} tone="neutral">
                {humanize(r)}
              </Badge>
            ))}
          </div>

          {w.requiresDualApproval && st ? (
            <Card className={cn(st.count >= 2 ? 'border-success/40' : 'border-accent/40')}>
              <CardBody className="space-y-2 p-3.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-fg">Dual approval · {st.count} of 2</span>
                  <span className="text-xs text-fg-muted">large amount ≥ threshold</span>
                </div>
                <Progress value={st.count} max={2} tone={st.count >= 2 ? 'primary' : 'accent'} />
                <p className="text-xs text-fg-muted" data-testid="dual-approval-hint">
                  {st.count >= 2
                    ? 'Both approvals recorded; the payout was released.'
                    : st.alreadyApprovedByMe
                      ? 'You already gave one approval. A different finance or super admin must give the second - you cannot approve twice.'
                      : st.count === 1
                        ? 'One approval is in. Yours would release the payout.'
                        : 'Two distinct finance or super admins must approve before the payout is queued.'}
                </p>
              </CardBody>
            </Card>
          ) : null}

          {w.status === 'failed' && w.failureReason ? (
            <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-fg">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" />
              <div>
                <span className="font-medium">Payout failed:</span> {w.failureReason}
                <div className="mt-0.5 text-fg-muted">
                  Attempts: {w.attempts ?? 0}/{maxAttempts} · coins were refunded to the user.
                </div>
              </div>
            </div>
          ) : null}

          <Card>
            <CardHeader
              title="User"
              actions={
                <Link to={`/users/${w.userId}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <UserRound className="size-3" /> Open profile
                </Link>
              }
            />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Name', value: w.user.fullName ?? '—' },
                  { label: 'Phone', value: w.user.phoneNumber, mono: true },
                  {
                    label: 'Trust score',
                    value: <span className={cn('tabular font-medium', w.user.trustScore < 40 ? 'text-danger' : w.user.trustScore < 60 ? 'text-warning' : 'text-success')}>{w.user.trustScore}</span>,
                  },
                  { label: 'Account status', value: <StatusBadge status={w.user.status} /> },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payout" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Amount', value: `${formatEtb(w.amountEtb)} (${formatCoins(w.coinAmount)} coins)` },
                  { label: 'Method', value: humanize(w.payoutMethod) },
                  {
                    label: 'Destination',
                    span: 2,
                    mono: true,
                    value: (
                      <span className="inline-flex items-center gap-2">
                        <span>{reveal ? w.payoutDestinationFull : w.payoutDestination}</span>
                        <Button variant="ghost" size="xs" onClick={() => setReveal((r) => !r)} aria-pressed={reveal}>
                          {reveal ? <EyeOff className="size-3" /> : <Eye className="size-3" />} {reveal ? 'Mask' : 'Reveal'}
                        </Button>
                      </span>
                    ),
                  },
                  ...(w.destinationName ? [{ label: 'Account holder', value: w.destinationName }] : []),
                  ...(w.bankCode ? [{ label: 'Bank code', value: w.bankCode, mono: true }] : []),
                  { label: 'Provider', value: w.providerName ?? '—' },
                  { label: 'Provider payout id', value: w.providerPayoutId ?? '—', mono: true },
                  { label: 'Processed at', value: formatDateTime(w.processedAt) },
                  { label: 'Processed by', value: <IdChip id={w.processedBy} /> },
                  ...(w.reviewNote ? [{ label: 'Review note', value: w.reviewNote, span: 2 as const }] : []),
                  { label: 'Withdrawal id', value: <IdChip id={w.id} length={36} />, span: 2 },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Approvals (${w.approvals.length})`} description="Every decision is also written to the audit log." />
            {w.approvals.length ? (
              <ul className="divide-y">
                {w.approvals.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', a.decision === 'approved' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger')}>
                      {a.decision === 'approved' ? <Check className="size-3" /> : <X className="size-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{a.adminEmail ?? a.adminId}</span>
                        {a.adminId === admin?.id ? (
                          <Badge tone="primary" size="sm">
                            you
                          </Badge>
                        ) : null}
                        <span className="text-xs text-fg-subtle">{humanize(a.decision)}</span>
                      </div>
                      {a.note ? <p className="text-xs text-fg-muted">“{a.note}”</p> : null}
                      <p className="text-2xs text-fg-subtle">{formatDateTime(a.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-xs text-fg-subtle">No approvals recorded yet.</CardBody>
            )}
          </Card>
        </div>
      )}

      {w ? (
        <>
          <ReasonDialog
            open={approveOpen}
            onOpenChange={setApproveOpen}
            title={w.requiresDualApproval ? `Record approval ${Math.min((st?.count ?? 0) + 1, 2)} of 2` : 'Approve withdrawal'}
            description={
              w.requiresDualApproval && (st?.count ?? 0) === 0
                ? `ETB ${formatEtbBare(w.amountEtb)} to ${w.payoutDestination}. Nothing is paid out until a second, different admin also approves.`
                : `ETB ${formatEtbBare(w.amountEtb)} will be queued for payout to ${w.payoutDestination} via ${humanize(w.payoutMethod)}.`
            }
            confirmLabel={w.requiresDualApproval && (st?.count ?? 0) === 0 ? 'Record my approval' : 'Approve & queue payout'}
            confirmVariant="success"
            reasonLabel="Note"
            optional
            placeholder="e.g. Identity and destination verified against the KYC record."
            loading={approve.isPending}
            onConfirm={(note) => approve.mutate(note)}
          />
          <ReasonDialog
            open={rejectOpen}
            onOpenChange={setRejectOpen}
            destructive
            title="Reject withdrawal"
            description={`The request for ETB ${formatEtbBare(w.amountEtb)} will be rejected and ${formatCoins(w.coinAmount)} coins returned to the user via a reversing ledger entry.`}
            confirmLabel="Reject & refund coins"
            loading={reject.isPending}
            onConfirm={(reason) => reject.mutate(reason)}
          />
        </>
      ) : null}
    </Sheet>
  );
}
