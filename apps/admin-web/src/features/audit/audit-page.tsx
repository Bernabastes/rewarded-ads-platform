import type { ActorType, AuditLogItem } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Download, Loader2, ScrollText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { auditApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { useDebouncedValue } from '@/lib/hooks/use-misc';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { downloadCsv, toCsv } from '@/lib/utils/csv';
import { formatDateTime, humanize } from '@/lib/utils/format';
import { countChanges, diffJson } from '@/lib/utils/json-diff';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/feedback';
import { Input, Label, NativeSelect, SearchInput } from '@/components/ui/input';
import { DiffView, JsonView } from '@/components/ui/json';
import { IdChip, PageHeader } from '@/components/ui/page';

const defaults = { q: '' as string, action: '' as string, actorType: '' as string, actorId: '' as string, actor: '' as string, targetType: '' as string, targetId: '' as string, from: '' as string, to: '' as string, page: 1, limit: 100 };

const ACTION_TONE = (action: string): BadgeTone => {
  if (/reject|ban|suspend|fail/.test(action)) return 'danger';
  if (/approv|verif|reinstat|releas|complet|execut/.test(action)) return 'success';
  if (/pause|escalat|flag/.test(action)) return 'warning';
  if (/request|creat|submit/.test(action)) return 'info';
  return 'neutral';
};

const TARGET_ROUTE: Record<string, (id: string) => string> = {
  user: (id) => `/users/${id}`,
  withdrawal: (id) => `/withdrawals/${id}?status=all`,
  ad: (id) => `/review/${id}?status=approved`,
  campaign: (id) => `/campaigns/${id}`,
  advertiser: (id) => `/advertisers/${id}`,
  coin_adjustment_request: (id) => `/adjustments/${id}?status=all`,
  fraud_flag: (id) => `/fraud/${id}?resolved=all`,
  kyc_submission: (id) => `/kyc/${id}?status=approved`,
  platform_alert: () => `/alerts?state=all`,
  deletion_request: () => `/deletion-requests?status=executed`,
};

export function AuditPage() {
  const { params, set, reset } = useListParams(defaults);
  const { can } = useAuth();
  const [search, setSearch] = useState(params.q);
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => {
    if (debounced !== params.q) set({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const [expanded, setExpanded] = useState<string | null>(null);

  // P4-F4: the Actor box accepts an admin email, an advertiser email, a user phone (any Ethiopian format) or an id and
  // is sent verbatim as `actor=`; the API resolves it and answers with `meta.actorResolved` + `meta.actor`. An unknown
  // actor yields an empty page (the filter is never silently dropped). `actorId=` stays supported for old deep links.
  const [actorInput, setActorInput] = useState(params.actor);
  const debouncedActor = useDebouncedValue(actorInput, 350);
  useEffect(() => {
    if (debouncedActor.trim() !== params.actor) set({ actor: debouncedActor.trim(), actorId: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedActor]);
  const actorFilterActive = Boolean(params.actor || params.actorId);

  const queryParams = useMemo(
    () => ({
      q: params.q || undefined,
      action: params.action || undefined,
      actorType: (params.actorType || undefined) as ActorType | undefined,
      actorId: params.actorId || undefined,
      actor: params.actor || undefined,
      targetType: params.targetType || undefined,
      targetId: params.targetId || undefined,
      from: params.from ? `${params.from}T00:00:00.000Z` : undefined,
      to: params.to ? `${params.to}T23:59:59.999Z` : undefined,
      page: params.page,
      limit: params.limit,
    }),
    [params],
  );
  const list = useQuery({ queryKey: queryKeys.audit(queryParams), queryFn: () => auditApi.list(queryParams), placeholderData: (p) => p });

  // Actor filter status, derived from the response of the *current* query (placeholder data belongs to the previous filter).
  const actorStatus: 'idle' | 'resolving' | 'resolved' | 'not_found' = !actorFilterActive
    ? 'idle'
    : list.isPending || list.isPlaceholderData
      ? 'resolving'
      : list.data?.meta.actorResolved === false
        ? 'not_found'
        : 'resolved';
  const resolvedActor = actorStatus === 'resolved' ? list.data?.meta.actor ?? null : null;
  const actorLabelOf = (r: AuditLogItem) => (r.actorLabel && r.actorLabel !== r.actorId ? r.actorLabel : r.actorEmail ?? null);

  const columns = useMemo<ColumnDef<AuditLogItem, unknown>[]>(
    () => [
      {
        id: 'expand',
        header: '',
        cell: ({ row }) => (expanded === row.id ? <ChevronDown className="size-3.5 text-fg-subtle" /> : <ChevronRight className="size-3.5 text-fg-subtle" />),
        size: 28,
      },
      { id: 'when', header: 'When', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs text-fg-muted">{formatDateTime(row.original.createdAt)}</span>, size: 150 },
      { id: 'action', header: 'Action', cell: ({ row }) => <Badge tone={ACTION_TONE(row.original.action)}>{row.original.action}</Badge>, size: 220 },
      {
        id: 'actor',
        header: 'Actor',
        cell: ({ row }) => {
          const r = row.original;
          // Phase 4C: the API resolves the actor label server-side (admin email / user phone / advertiser email).
          const label = actorLabelOf(r);
          return (
            <div className="min-w-0 text-xs">
              <div className="truncate">
                {label ? (
                  <span className={cn(r.actorType === 'user' && 'font-mono')} data-testid={r.actorType === 'user' ? 'actor-phone' : undefined}>
                    {label}
                  </span>
                ) : r.actorType === 'system' ? (
                  'system'
                ) : r.actorId ? (
                  <span className="font-mono">{r.actorId.slice(0, 8)}…</span>
                ) : (
                  '—'
                )}
              </div>
              <div className="text-2xs text-fg-subtle">{humanize(r.actorType)}</div>
            </div>
          );
        },
        size: 200,
      },
      {
        id: 'target',
        header: 'Target',
        cell: ({ row }) => {
          const r = row.original;
          const route = r.targetId ? TARGET_ROUTE[r.targetType]?.(r.targetId) : undefined;
          return (
            <div className="text-xs">
              <span className="text-fg-muted">{humanize(r.targetType)}</span> {route ? <IdChip id={r.targetId} to={route} /> : <IdChip id={r.targetId} />}
            </div>
          );
        },
        size: 220,
      },
      {
        id: 'changes',
        header: 'Changes',
        cell: ({ row }) => {
          const n = countChanges(diffJson(row.original.beforeState, row.original.afterState));
          return n ? (
            <Badge tone="accent" size="sm" className="tabular">
              {n} key{n === 1 ? '' : 's'}
            </Badge>
          ) : (
            <span className="text-2xs text-fg-subtle">—</span>
          );
        },
        size: 90,
      },
      { id: 'ip', header: 'IP', cell: ({ row }) => <span className="font-mono text-2xs text-fg-subtle">{row.original.ipAddress ?? '—'}</span>, size: 110 },
    ],
    [expanded],
  );

  const hasFilters = Object.entries(params).some(([k, v]) => !['page', 'limit'].includes(k) && v !== '' && v !== undefined);

  const exportCsv = () => {
    if (!list.data) return;
    downloadCsv(
      `gize-audit-log-page${params.page}.csv`,
      toCsv(list.data.data, [
        { header: 'created_at', value: (r) => r.createdAt },
        { header: 'action', value: (r) => r.action },
        { header: 'actor_type', value: (r) => r.actorType },
        { header: 'actor_id', value: (r) => r.actorId },
        { header: 'actor_email', value: (r) => r.actorEmail },
        { header: 'actor_label', value: (r) => actorLabelOf(r) },
        { header: 'target_type', value: (r) => r.targetType },
        { header: 'target_id', value: (r) => r.targetId },
        { header: 'before_state', value: (r) => r.beforeState },
        { header: 'after_state', value: (r) => r.afterState },
        { header: 'ip', value: (r) => r.ipAddress },
      ]),
    );
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Audit log"
        description="Every admin decision and system action, with before/after state. Append-only."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!list.data}>
            <Download className="size-3.5" /> Export page
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Label htmlFor="audit-q" className="mb-1">
              Action or target type
            </Label>
            <SearchInput id="audit-q" value={search} onValueChange={setSearch} placeholder="e.g. withdrawal, kyc.approved" />
          </div>
          <div className="w-64">
            <Label htmlFor="audit-actor" className="mb-1">
              Actor
            </Label>
            <div className="relative">
              <Input id="audit-actor" value={actorInput} onChange={(e) => setActorInput(e.target.value)} placeholder="admin / advertiser email, user phone or id" className="pr-7 font-mono text-xs" aria-describedby="audit-actor-status" />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
                {actorStatus === 'resolving' ? (
                  <Loader2 className="size-3.5 animate-spin text-fg-subtle" aria-hidden />
                ) : actorStatus === 'resolved' ? (
                  <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                ) : actorStatus === 'not_found' ? (
                  <CircleAlert className="size-3.5 text-danger" aria-hidden />
                ) : null}
              </span>
            </div>
          </div>
          <div>
            <Label htmlFor="audit-action" className="mb-1">
              Action prefix
            </Label>
            <Input id="audit-action" list="audit-actions" value={params.action} onChange={(e) => set({ action: e.target.value })} placeholder="withdrawal." className="w-44 font-mono text-xs" />
            <datalist id="audit-actions">
              {['ad.', 'campaign.', 'user.', 'advertiser.', 'withdrawal.', 'coin_adjustment.', 'fraud_flag.', 'completion.', 'ad_report.', 'kyc.', 'alert.', 'deletion_request.', 'impersonation.', 'referral.'].map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <div>
            <Label htmlFor="audit-actor-type" className="mb-1">
              Actor type
            </Label>
            <NativeSelect id="audit-actor-type" value={params.actorType} onChange={(e) => set({ actorType: e.target.value })} className="w-32">
              <option value="">Any</option>
              <option value="admin">Admin</option>
              <option value="system">System</option>
              <option value="user">User</option>
              <option value="advertiser">Advertiser</option>
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="audit-target-type" className="mb-1">
              Target type
            </Label>
            <Input id="audit-target-type" list="audit-targets" value={params.targetType} onChange={(e) => set({ targetType: e.target.value })} placeholder="withdrawal" className="w-40 font-mono text-xs" />
            <datalist id="audit-targets">
            {Object.keys(TARGET_ROUTE)
              .concat(['ad_completion', 'ad_report', 'app_install_completion', 'legal_document', 'referral', 'data_export'])
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
          </div>
          <div>
            <Label htmlFor="audit-from" className="mb-1">
              From
            </Label>
            <Input id="audit-from" type="date" value={params.from} onChange={(e) => set({ from: e.target.value })} className="w-38 tabular" />
          </div>
          <div>
            <Label htmlFor="audit-to" className="mb-1">
              To
            </Label>
            <Input id="audit-to" type="date" value={params.to} onChange={(e) => set({ to: e.target.value })} className="w-38 tabular" />
          </div>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setActorInput('');
                reset();
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
        {actorFilterActive || params.targetId ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-fg-muted" id="audit-actor-status" data-testid="audit-actor-status">
            {actorStatus === 'resolved' ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-success" /> Actor{' '}
                <span className={cn('font-medium text-fg', resolvedActor?.actorType === 'user' && 'font-mono')}>{resolvedActor?.label ?? params.actor ?? params.actorId}</span>
                {resolvedActor?.actorType ? (
                  <Badge tone={resolvedActor.actorType === 'admin' ? 'primary' : resolvedActor.actorType === 'advertiser' ? 'accent' : 'info'} size="sm">
                    {resolvedActor.actorType}
                  </Badge>
                ) : null}
                {resolvedActor ? <IdChip id={resolvedActor.id} to={resolvedActor.actorType === 'user' && can('users') ? `/users/${resolvedActor.id}` : resolvedActor.actorType === 'advertiser' ? `/advertisers/${resolvedActor.id}` : undefined} /> : null}
                {list.data && list.data.meta.total === 0 ? <span className="text-fg-subtle">· no entries match the other filters</span> : null}
              </span>
            ) : actorStatus === 'resolving' ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Looking up <span className="font-mono">{params.actor || params.actorId}</span>…
              </span>
            ) : actorStatus === 'not_found' ? (
              <span className="inline-flex items-center gap-1.5 text-danger" role="alert">
                <CircleAlert className="size-3.5" /> No admin, advertiser or user matches <span className="font-mono">{params.actor || params.actorId}</span>. Enter an email, an Ethiopian phone number (+2519… / 09…) or an id.
              </span>
            ) : null}
            {params.targetId ? (
              <span>
                Target <IdChip id={params.targetId} />
              </span>
            ) : null}
          </div>
        ) : null}
      </PageHeader>

      <DataTable
        columns={columns}
        data={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setExpanded((e) => (e === r.id ? null : r.id))}
        expandedRowId={expanded}
        renderExpanded={(r) => <AuditRowDetail row={r} canOpenUsers={can('users')} />}
        virtualized
        rowHeight={44}
        maxHeight="calc(100vh - 21rem)"
        emptyState={
          <EmptyState
            compact
            icon={ScrollText}
            title={actorStatus === 'not_found' ? 'Actor not found' : 'No audit entries'}
            description={actorStatus === 'not_found' ? 'Nobody matches the Actor filter. Check the email / phone number, or clear it to search the whole log.' : 'Try widening the date range or clearing filters.'}
          />
        }
        aria-label="Audit log"
      />
      <PaginationBar page={params.page} limit={params.limit} total={list.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[50, 100]} isFetching={list.isFetching} />
    </div>
  );
}

function AuditRowDetail({ row, canOpenUsers }: { row: AuditLogItem; canOpenUsers: boolean }) {
  const label = row.actorLabel && row.actorLabel !== row.actorId ? row.actorLabel : row.actorEmail;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <div className="mb-1.5 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">State diff</div>
        <DiffView before={row.beforeState} after={row.afterState} />
      </div>
      <div className="space-y-3 text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-fg-subtle">Entry id</dt>
          <dd>
            <IdChip id={row.id} length={36} />
          </dd>
          <dt className="text-fg-subtle">Actor</dt>
          <dd>
            {label ?? '—'} <IdChip id={row.actorId} />
            {row.actorType === 'user' && row.actorId && canOpenUsers ? (
              <Link to={`/users/${row.actorId}`} className="ml-1 text-primary hover:underline">
                open user
              </Link>
            ) : null}
          </dd>
          <dt className="text-fg-subtle">Target</dt>
          <dd>
            {humanize(row.targetType)} <IdChip id={row.targetId} length={36} />
          </dd>
          <dt className="text-fg-subtle">IP</dt>
          <dd className="font-mono">{row.ipAddress ?? '—'}</dd>
        </dl>
        {row.metadata ? (
          <div>
            <div className="mb-1 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">Metadata</div>
            <JsonView value={row.metadata} maxHeight={160} />
          </div>
        ) : null}
        <details className="text-2xs text-fg-subtle">
          <summary className="cursor-pointer">Raw before / after JSON</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <JsonView value={row.beforeState} maxHeight={200} />
            <JsonView value={row.afterState} maxHeight={200} />
          </div>
        </details>
      </div>
    </div>
  );
}
