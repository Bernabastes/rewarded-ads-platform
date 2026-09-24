import type { CampaignSummary } from '@rap/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import type { AdminCampaign } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatEtbBare, formatInt, formatPercent, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/feedback';
import { Progress } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/primitives';

type Row = CampaignSummary & { advertiser?: { id: string; businessName: string } };

export function CampaignsTable({
  rows,
  isLoading,
  error,
  onRetry,
  showAdvertiser = true,
  emptyTitle = 'No campaigns',
  emptyDescription,
}: {
  rows: Row[] | AdminCampaign[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  showAdvertiser?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const navigate = useNavigate();
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: 'title',
        header: 'Campaign',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.title}</div>
            {showAdvertiser && row.original.advertiser ? <div className="truncate text-2xs text-fg-subtle">{row.original.advertiser.businessName}</div> : null}
          </div>
        ),
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} />, size: 130 },
      { id: 'type', header: 'Type', cell: ({ row }) => <Badge tone="outline">{humanize(row.original.targetActionType)}</Badge>, size: 110 },
      {
        id: 'budget',
        header: 'Spend / budget',
        meta: { numeric: true },
        cell: ({ row }) => {
          const c = row.original;
          const spent = Number(c.spentEtb);
          const budget = Number(c.budgetEtb);
          return (
            <div className="min-w-32">
              <div className="flex justify-between text-xs">
                <span className="font-medium">ETB {formatEtbBare(spent)}</span>
                <span className="text-fg-subtle">/ {formatEtbBare(budget)}</span>
              </div>
              <Progress value={spent} max={budget || 1} className="mt-1" tone={budget && spent / budget > 0.9 ? 'accent' : 'primary'} />
            </div>
          );
        },
        size: 170,
      },
      {
        id: 'cpa',
        header: 'Cost / reward',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <span className="text-xs">
            {formatEtbBare(row.original.costPerActionEtb)} / <span className="text-fg-muted">{formatEtbBare(row.original.rewardPerActionEtb)}</span>
          </span>
        ),
        size: 120,
      },
      {
        id: 'ads',
        header: 'Ads',
        meta: { align: 'center' },
        cell: ({ row }) => (
          <span className={cn('tabular text-xs', row.original.approvedAdsCount < row.original.adsCount && 'text-warning')}>
            {row.original.approvedAdsCount}/{row.original.adsCount}
          </span>
        ),
        size: 70,
      },
      {
        id: 'completions',
        header: 'Valid / raw',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => (
          <Tooltip content={`${formatPercent(row.original.rawCompletions ? 1 - row.original.validCompletions / row.original.rawCompletions : 0)} filtered by fraud rules`}>
            <span className="text-xs">
              {formatInt(row.original.validCompletions)} <span className="text-fg-subtle">/ {formatInt(row.original.rawCompletions)}</span>
            </span>
          </Tooltip>
        ),
        size: 110,
      },
      {
        id: 'created',
        header: 'Created',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
    ],
    [showAdvertiser],
  );

  return (
    <DataTable
      columns={columns}
      data={rows as Row[] | undefined}
      getRowId={(r) => r.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      onRowClick={(c) => navigate(`/campaigns/${c.id}`)}
      emptyState={<EmptyState compact title={emptyTitle} description={emptyDescription} />}
      aria-label="Campaigns"
    />
  );
}
