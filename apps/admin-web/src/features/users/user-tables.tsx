import type { FraudFlagItem, LedgerEntry, WithdrawalItem } from '@rap/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatDateTime, formatEtbBare, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, SeverityBadge, StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/feedback';
import { IdChip } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/primitives';

/* ------------------------------- ledger ------------------------------- */

const SOURCE_TONE: Record<string, 'success' | 'danger' | 'info' | 'warning' | 'neutral' | 'primary'> = {
  ad_view: 'success',
  survey: 'success',
  app_install: 'success',
  withdrawal: 'danger',
  withdrawal_reversal: 'info',
  admin_adjustment: 'warning',
  reconciliation: 'neutral',
};

export function LedgerTable({ entries, highlightId, className }: { entries: LedgerEntry[]; highlightId?: string | null; className?: string }) {
  const columns = useMemo<ColumnDef<LedgerEntry, unknown>[]>(
    () => [
      {
        id: 'when',
        header: 'When',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
      { id: 'source', header: 'Source', cell: ({ row }) => <Badge tone={SOURCE_TONE[row.original.sourceType] ?? 'neutral'}>{humanize(row.original.sourceType)}</Badge>, size: 150 },
      { id: 'description', header: 'Description', cell: ({ row }) => <span className="text-fg-muted">{row.original.description ?? '—'}</span> },
      {
        id: 'amount',
        header: 'Coins',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className={cn('font-medium', row.original.amount < 0 ? 'text-danger' : 'text-success')}>
            {row.original.amount > 0 ? '+' : ''}
            {formatCoins(row.original.amount)}
          </span>
        ),
        size: 100,
      },
      { id: 'balance', header: 'Balance after', meta: { align: 'right', numeric: true }, cell: ({ row }) => formatCoins(row.original.balanceAfter), size: 120 },
      { id: 'id', header: 'Entry', cell: ({ row }) => <IdChip id={row.original.id} />, size: 120 },
    ],
    [],
  );
  return (
    <DataTable
      columns={columns}
      data={entries}
      getRowId={(r) => r.id}
      className={className}
      rowClassName={(r) => (highlightId && r.id === highlightId ? 'bg-warning/15' : undefined)}
      emptyState={<EmptyState compact title="No ledger entries" description="Rewards, withdrawals and adjustments will appear here." />}
      aria-label="Coin ledger"
    />
  );
}

/* -------------------------- withdrawals (mini) ------------------------ */

export function UserWithdrawalsTable({ rows, className }: { rows: WithdrawalItem[]; className?: string }) {
  const columns = useMemo<ColumnDef<WithdrawalItem, unknown>[]>(
    () => [
      { id: 'when', header: 'Requested', cell: ({ row }) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(row.original.requestedAt)}</span>, size: 150 },
      { id: 'amount', header: 'Amount', meta: { align: 'right', numeric: true }, cell: ({ row }) => `ETB ${formatEtbBare(row.original.amountEtb)}`, size: 120 },
      { id: 'method', header: 'Method', cell: ({ row }) => `${humanize(row.original.payoutMethod)} · ${row.original.payoutDestination}`, size: 220 },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge status={row.original.status} />
            {row.original.requiresDualApproval ? <Badge tone="accent" size="sm">{row.original.approvalsCount}/2</Badge> : null}
          </div>
        ),
      },
      {
        id: 'open',
        header: '',
        cell: ({ row }) => (
          <Link to={`/withdrawals/${row.original.id}?status=all`} className="text-xs font-medium text-primary hover:underline">
            Open
          </Link>
        ),
        size: 60,
      },
    ],
    [],
  );
  return <DataTable columns={columns} data={rows} getRowId={(r) => r.id} className={className} emptyState={<EmptyState compact title="No withdrawals yet" />} aria-label="Withdrawals" />;
}

/* ------------------------------- flags -------------------------------- */

export function FlagsTable({
  rows,
  className,
  onSelect,
  selectedId,
  showUser = false,
  isLoading,
  error,
  onRetry,
  maxHeight,
  virtualized,
}: {
  rows: FraudFlagItem[] | undefined;
  className?: string;
  onSelect?: (flag: FraudFlagItem) => void;
  selectedId?: string | null;
  showUser?: boolean;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  maxHeight?: string;
  virtualized?: boolean;
}) {
  const columns = useMemo<ColumnDef<FraudFlagItem, unknown>[]>(
    () => [
      { id: 'severity', header: 'Severity', cell: ({ row }) => <SeverityBadge severity={row.original.severity} />, size: 100 },
      {
        id: 'type',
        header: 'Flag',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{humanize(row.original.flagType)}</div>
            <div className="truncate text-xs text-fg-muted">{row.original.description}</div>
          </div>
        ),
      },
      ...(showUser
        ? [
            {
              id: 'user',
              header: 'User',
              cell: ({ row }: { row: { original: FraudFlagItem } }) =>
                row.original.userId ? (
                  <Link to={`/users/${row.original.userId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs hover:text-primary hover:underline">
                    {row.original.userPhone ?? row.original.userId.slice(0, 8)}
                  </Link>
                ) : (
                  <span className="text-fg-subtle">—</span>
                ),
              size: 140,
            } satisfies ColumnDef<FraudFlagItem, unknown>,
          ]
        : []),
      {
        id: 'entity',
        header: 'Related',
        cell: ({ row }) => (
          <span className="text-xs text-fg-muted">
            {humanize(row.original.relatedEntityType)} <IdChip id={row.original.relatedEntityId} length={6} />
          </span>
        ),
        size: 170,
      },
      {
        id: 'delta',
        header: 'Trust Δ',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className={cn(row.original.trustScoreDelta < 0 ? 'text-danger' : 'text-fg-muted')}>{row.original.trustScoreDelta > 0 ? '+' : ''}{row.original.trustScoreDelta}</span>,
        size: 80,
      },
      {
        id: 'state',
        header: 'State',
        cell: ({ row }) => (row.original.resolved ? <StatusBadge status={row.original.resolution ?? 'resolved'} size="sm" /> : <Badge tone="warning" dot size="sm">Open</Badge>),
        size: 110,
      },
      {
        id: 'when',
        header: 'Raised',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
    ],
    [showUser],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      className={className}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      onRowClick={onSelect}
      selectedRowId={selectedId}
      maxHeight={maxHeight}
      virtualized={virtualized}
      rowHeight={52}
      emptyState={<EmptyState compact title="No fraud flags" description="Nothing has been flagged for this selection." />}
      aria-label="Fraud flags"
    />
  );
}
