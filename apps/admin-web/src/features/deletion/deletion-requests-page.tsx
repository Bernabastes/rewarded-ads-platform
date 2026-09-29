import type { AdminDeletionRequestItem, DeletionRequestStatus } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Banknote, CalendarClock, ShieldCheck, Trash2, Undo2, UserRoundX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { deletionRequestsApi } from '@/lib/api/endpoints';
import { describeError, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { deletionExecuteBlock, deletionIsDue } from '@/lib/domain/data-rights-rules';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatDateTime, formatRelative } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/ui/confirm';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/feedback';
import { IdChip, PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';

const TABS: Array<{ value: DeletionRequestStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'executed', label: 'Executed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const defaults = { status: 'pending' as string, page: 1, limit: 50 };

export function DeletionRequestsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { params, set } = useListParams(defaults);
  const status = (TABS.some((t) => t.value === params.status) ? params.status : 'pending') as DeletionRequestStatus;
  const queryParams = useMemo(() => ({ status, page: params.page, limit: params.limit }), [status, params.page, params.limit]);
  const list = useQuery({ queryKey: queryKeys.deletionRequests(queryParams), queryFn: () => deletionRequestsApi.list(queryParams), refetchInterval: status === 'pending' ? 60_000 : false, placeholderData: (p) => p });
  const [target, setTarget] = useState<{ kind: 'execute' | 'cancel'; row: AdminDeletionRequestItem } | null>(null);
  const canDecide = can('deletionRequests');

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['deletion-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  };

  const decide = useMutation({
    mutationFn: ({ kind, id, note }: { kind: 'execute' | 'cancel'; id: string; note: string }) => (kind === 'execute' ? deletionRequestsApi.execute(id, note) : deletionRequestsApi.cancel(id, note)),
    onSuccess: (res, { kind }) => {
      toast.success(kind === 'execute' ? 'Account anonymised' : 'Deletion request cancelled', {
        description: kind === 'execute' ? `${res.user.phoneNumber} is now status “deleted”; ledger and audit rows were kept.` : 'The account stays active; the user was notified.',
      });
      setTarget(null);
      invalidate();
    },
    onError: (err) => {
      const already = isApiError(err) && err.code === 'DELETION_REQUEST_NOT_PENDING';
      toast.error(already ? 'Already decided' : 'Action failed', { description: describeError(err) });
      if (already) {
        setTarget(null);
        invalidate();
      }
    },
  });

  const columns = useMemo<ColumnDef<AdminDeletionRequestItem, unknown>[]>(
    () => [
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate font-medium">
              {can('users') ? (
                <Link to={`/users/${row.original.user.id}`} className="hover:text-primary hover:underline">
                  {row.original.user.fullName ?? <span className="text-fg-subtle">Unnamed</span>}
                </Link>
              ) : (
                (row.original.user.fullName ?? 'Unnamed')
              )}
              <StatusBadge status={row.original.user.status} size="sm" />
            </div>
            <div className="font-mono text-2xs text-fg-subtle">
              {row.original.user.phoneNumber} · {formatCoins(row.original.user.coinBalance)} coins
            </div>
          </div>
        ),
      },
      {
        id: 'requested',
        header: 'Requested',
        cell: ({ row }) => (
          <div className="text-xs">
            <div className="text-fg-muted">{formatDateTime(row.original.requestedAt)}</div>
            {row.original.reason ? <div className="max-w-56 truncate text-2xs text-fg-subtle">“{row.original.reason}”</div> : null}
          </div>
        ),
        size: 190,
      },
      {
        id: 'scheduled',
        header: 'Scheduled for',
        cell: ({ row }) => {
          const due = deletionIsDue(row.original);
          return (
            <div className="text-xs">
              <div className={cn('flex items-center gap-1 font-medium', due ? 'text-danger' : 'text-fg')}>
                <CalendarClock className="size-3" /> {formatDateTime(row.original.scheduledFor)}
              </div>
              <div className="text-2xs text-fg-subtle">
                {row.original.status === 'pending' ? (due ? 'due - the nightly job will execute it' : `${formatRelative(row.original.scheduledFor)} · ${row.original.graceDays}-day grace`) : `${row.original.graceDays}-day grace`}
              </div>
            </div>
          );
        },
        size: 190,
      },
      {
        id: 'withdrawals',
        header: 'In-flight payouts',
        meta: { align: 'center' },
        cell: ({ row }) =>
          row.original.pendingWithdrawals > 0 ? (
            <Tooltip content="Execution is blocked while withdrawals are pending / processing / held.">
              <span>
                <Badge tone="danger" className="gap-1 tabular">
                  <Banknote className="size-3" /> {row.original.pendingWithdrawals}
                </Badge>
              </span>
            </Tooltip>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
        size: 130,
      },
      ...(status !== 'pending'
        ? [
            {
              id: 'outcome',
              header: status === 'executed' ? 'Executed' : 'Cancelled',
              cell: ({ row }) => (
                <div className="text-xs">
                  <div className="text-fg-muted">{formatDateTime(status === 'executed' ? row.original.executedAt : row.original.cancelledAt)}</div>
                  <div className="text-2xs text-fg-subtle">
                    by <IdChip id={status === 'executed' ? row.original.executedBy : row.original.cancelledBy} /> {row.original.executedBy || row.original.cancelledBy ? '' : '(user / system)'}
                  </div>
                  {row.original.note ? <div className="max-w-56 truncate text-2xs text-fg-subtle">“{row.original.note}”</div> : null}
                </div>
              ),
              size: 220,
            } as ColumnDef<AdminDeletionRequestItem, unknown>,
          ]
        : [
            {
              id: 'actions',
              header: '',
              meta: { align: 'right' },
              cell: ({ row }) => {
                const block = deletionExecuteBlock(row.original);
                if (!canDecide) return null;
                return (
                  <div className="flex items-center justify-end gap-1.5">
                    <Button variant="outline" size="xs" onClick={() => setTarget({ kind: 'cancel', row: row.original })}>
                      <Undo2 className="size-3" /> Cancel request
                    </Button>
                    <Tooltip content={block} disabled={!block}>
                      <span className="inline-flex" tabIndex={block ? 0 : -1}>
                        <Button variant="danger" size="xs" disabled={Boolean(block)} onClick={() => setTarget({ kind: 'execute', row: row.original })} data-testid={`execute-${row.original.id}`}>
                          <Trash2 className="size-3" /> Execute now
                        </Button>
                      </span>
                    </Tooltip>
                  </div>
                );
              },
              size: 260,
            } as ColumnDef<AdminDeletionRequestItem, unknown>,
          ]),
    ],
    [status, canDecide, can],
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title="Deletion requests"
        description="Users can ask to delete their account; after the grace period the nightly job anonymises it. Support can execute early or cancel on the user's behalf."
      >
        <Tabs value={status} onValueChange={(v) => set({ status: v, page: 1 })}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.value === 'pending' && status === 'pending' && list.data ? (
                  <Badge tone="accent" size="sm" className="tabular">
                    {list.data.meta.total}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      <div className="flex items-start gap-2 rounded-md border bg-sunken/50 px-3 py-2 text-xs text-fg-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span>
          <span className="font-medium text-fg">What “execute” does:</span> phone, name, date of birth, device ids and push tokens are anonymised and the status becomes <span className="font-mono">deleted</span>; the coin
          ledger, withdrawals, completions and audit entries are <span className="font-medium text-fg">kept</span> for financial reconciliation. Tokens stop working immediately. It cannot be undone.
        </span>
      </div>

      <DataTable
        columns={columns}
        data={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyState={<EmptyState compact icon={UserRoundX} title={`No ${status} requests`} description={status === 'pending' ? 'Nobody is waiting to have their account deleted.' : 'Nothing here yet.'} />}
        aria-label="Deletion requests"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />

      {target ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          destructive={target.kind === 'execute'}
          title={target.kind === 'execute' ? `Anonymise ${target.row.user.fullName ?? target.row.user.phoneNumber} now?` : `Cancel the deletion request for ${target.row.user.fullName ?? target.row.user.phoneNumber}?`}
          description={
            target.kind === 'execute'
              ? `Scheduled for ${formatDateTime(target.row.scheduledFor)}. Executing now anonymises the profile immediately (status “deleted”, sessions revoked). The coin ledger (${formatCoins(target.row.user.coinBalance)} coins), withdrawals and audit log are retained. This cannot be undone.`
              : 'The account stays active and the user is notified. Use this for support tickets where the user changed their mind.'
          }
          confirmLabel={target.kind === 'execute' ? 'Execute deletion' : 'Cancel request'}
          confirmVariant={target.kind === 'execute' ? 'danger' : 'primary'}
          reasonLabel="Note"
          optional
          placeholder={target.kind === 'execute' ? 'Optional note for the audit log (ticket id, why early)' : 'Optional note for the audit log (ticket id)'}
          loading={decide.isPending}
          onConfirm={(note) => decide.mutate({ kind: target.kind, id: target.row.id, note })}
        />
      ) : null}
    </div>
  );
}
