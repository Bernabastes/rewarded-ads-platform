import type { AdminAppInstallCompletionItem, OfferCompletionStatus } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, Smartphone, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { appInstallsApi } from '@/lib/api/endpoints';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useListParams } from '@/lib/hooks/use-list-params';
import { formatCoins, formatDateTime, formatRelative } from '@/lib/utils/format';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReasonDialog } from '@/components/ui/confirm';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/feedback';
import { IdChip, PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/primitives';

const TABS: Array<{ value: OfferCompletionStatus; label: string }> = [
  { value: 'pending_verification', label: 'Awaiting verification' },
  { value: 'valid', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'flagged', label: 'Flagged' },
];

const defaults = { status: 'pending_verification' as string, page: 1, limit: 25 };

export function AppInstallsPage() {
  const queryClient = useQueryClient();
  const { params, set } = useListParams(defaults);
  const status = TABS.some((t) => t.value === params.status) ? (params.status as OfferCompletionStatus) : 'pending_verification';
  const queryParams = useMemo(() => ({ status, page: params.page, limit: params.limit }), [status, params.page, params.limit]);
  const list = useQuery({ queryKey: queryKeys.appInstalls(queryParams), queryFn: () => appInstallsApi.list(queryParams), placeholderData: (p) => p });
  const [pending, setPending] = useState<{ kind: 'verify' | 'reject'; item: AdminAppInstallCompletionItem } | null>(null);

  const decide = useMutation({
    mutationFn: ({ kind, item, text }: { kind: 'verify' | 'reject'; item: AdminAppInstallCompletionItem; text: string }) => (kind === 'verify' ? appInstallsApi.verify(item.id, text || undefined) : appInstallsApi.reject(item.id, text)),
    onSuccess: (_res, { kind, item }) => {
      toast.success(kind === 'verify' ? 'Install verified' : 'Install claim rejected', { description: kind === 'verify' ? `${formatCoins(item.coinReward)} coins credited to ${item.userPhone} via the ledger.` : 'Nothing was credited.' });
      void queryClient.invalidateQueries({ queryKey: ['app-installs'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      setPending(null);
    },
    onError: (err) => toast.error('Action failed', { description: describeError(err) }),
  });

  const columns = useMemo<ColumnDef<AdminAppInstallCompletionItem, unknown>[]>(
    () => [
      {
        id: 'created',
        header: 'Claimed',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
      { id: 'app', header: 'App', cell: ({ row }) => <span className="font-medium">{row.original.appName}</span>, size: 160 },
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <div className="font-mono text-xs">
            {row.original.userPhone} <IdChip id={row.original.userId} to={`/users/${row.original.userId}`} length={6} />
          </div>
        ),
        size: 220,
      },
      { id: 'fp', header: 'Device fingerprint', cell: ({ row }) => <span className="font-mono text-xs text-fg-muted">{row.original.deviceFingerprint}</span>, size: 170 },
      { id: 'proof', header: 'Proof', cell: ({ row }) => <span className="text-xs text-fg-muted">{row.original.proof ?? <span className="text-fg-subtle">none provided</span>}</span> },
      { id: 'reward', header: 'Reward', meta: { align: 'right', numeric: true }, cell: ({ row }) => `${formatCoins(row.original.coinReward)} coins`, size: 110 },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} />, size: 150 },
      ...(status === 'pending_verification'
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: AdminAppInstallCompletionItem } }) => (
                <div className="flex justify-end gap-1">
                  <Button size="xs" variant="outline" onClick={() => setPending({ kind: 'reject', item: row.original })}>
                    <X className="size-3 text-danger" /> Reject
                  </Button>
                  <Button size="xs" variant="success" onClick={() => setPending({ kind: 'verify', item: row.original })}>
                    <Check className="size-3" /> Verify
                  </Button>
                </div>
              ),
              size: 170,
            } satisfies ColumnDef<AdminAppInstallCompletionItem, unknown>,
          ]
        : []),
    ],
    [status],
  );

  return (
    <div className="space-y-3">
      <PageHeader title="App-install verification" description="Install offers pay out only after an admin confirms the claim. Verifying credits the user and charges the campaign.">
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
      <DataTable
        columns={columns}
        data={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyState={<EmptyState compact icon={Smartphone} title={status === 'pending_verification' ? 'No claims to verify' : 'No install completions'} description="Claims from the offers tab in the app appear here." />}
        aria-label="App install completions"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />

      <ReasonDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        destructive={pending?.kind === 'reject'}
        optional={pending?.kind === 'verify'}
        reasonLabel={pending?.kind === 'verify' ? 'Note' : 'Reason'}
        title={pending?.kind === 'verify' ? `Verify install of ${pending.item.appName}?` : `Reject claim for ${pending?.item.appName}?`}
        description={
          pending?.kind === 'verify'
            ? `${formatCoins(pending.item.coinReward)} coins will be credited to ${pending.item.userPhone} and the campaign charged. Fails if the campaign budget is exhausted.`
            : 'The user is not credited. Provide the reason recorded in the audit log.'
        }
        confirmLabel={pending?.kind === 'verify' ? 'Verify & credit' : 'Reject claim'}
        confirmVariant={pending?.kind === 'verify' ? 'success' : undefined}
        minLength={pending?.kind === 'verify' ? 0 : 1}
        loading={decide.isPending}
        onConfirm={(text) => { if (pending) decide.mutate({ kind: pending.kind, item: pending.item, text }); }}
      />
    </div>
  );
}
