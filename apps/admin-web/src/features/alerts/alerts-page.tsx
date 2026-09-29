import { type AlertRulesRunResult, type AlertSeverity, AlertType, type PlatformAlertItem } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { BellOff, BellRing, Check, CheckCheck, ChevronDown, ChevronRight, FlaskConical, Play, Radio } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { alertsApi } from '@/lib/api/endpoints';
import { describeError, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { AlertNotifierInfo } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/use-auth';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatInt, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, ALERT_SEVERITY_TONE } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DataTable, PaginationBar } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/feedback';
import { Input, Label, NativeSelect } from '@/components/ui/input';
import { JsonView } from '@/components/ui/json';
import { IdChip, PageHeader } from '@/components/ui/page';
import { Tooltip } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/stat';

const SEVERITIES: AlertSeverity[] = ['critical', 'warning', 'info'];
const TYPES = Object.values(AlertType);

const defaults = { type: '' as string, severity: '' as string, state: 'open' as string, from: '' as string, to: '' as string, run: '' as string, page: 1, limit: 50 };

export function AlertsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { params, set, reset } = useListParams(defaults);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<AlertRulesRunResult | null>(null);

  const queryParams = useMemo(
    () => ({
      type: params.type || undefined,
      severity: (params.severity || undefined) as AlertSeverity | undefined,
      acknowledged: params.state === 'open' ? false : params.state === 'acknowledged' ? true : undefined,
      from: params.from || undefined,
      to: params.to ? `${params.to}T23:59:59.999Z` : undefined,
      page: params.page,
      limit: params.limit,
    }),
    [params.type, params.severity, params.state, params.from, params.to, params.page, params.limit],
  );
  const list = useQuery({ queryKey: queryKeys.alerts(queryParams), queryFn: () => alertsApi.list(queryParams), refetchInterval: 30_000, placeholderData: (p) => p });
  const meta = list.data?.meta;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['alerts'] });

  const ack = useMutation({
    mutationFn: (id: string) => alertsApi.ack(id),
    onSuccess: (res) => {
      toast.success('Alert acknowledged', { description: res.title });
      invalidate();
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'ALERT_ALREADY_ACKNOWLEDGED') {
        toast.info('Already acknowledged', { description: 'Someone else got there first - the list has been refreshed.' });
        invalidate();
        return;
      }
      toast.error('Could not acknowledge', { description: describeError(err) });
    },
  });

  const run = useMutation({
    mutationFn: () => alertsApi.runRules(),
    onSuccess: (res) => {
      setRunResult(res);
      const raised = res.rules.reduce((a, r) => a + r.raised, 0);
      toast.success(raised ? `${raised} new alert${raised === 1 ? '' : 's'} raised` : 'Rules evaluated - nothing new', { description: `${res.rules.length} rules checked at ${formatDateTime(res.ranAt)}` });
      invalidate();
    },
    onError: (err) => toast.error('Could not run rules', { description: describeError(err) }),
  });

  // "Run alert rules now" from the command palette lands here with ?run=1.
  useEffect(() => {
    if (params.run === '1' && can('alertsRunRules') && !run.isPending) {
      set({ run: '' });
      run.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.run]);

  const columns = useMemo<ColumnDef<PlatformAlertItem, unknown>[]>(
    () => [
      { id: 'expand', header: '', cell: ({ row }) => (expanded === row.id ? <ChevronDown className="size-3.5 text-fg-subtle" /> : <ChevronRight className="size-3.5 text-fg-subtle" />), size: 28 },
      {
        id: 'severity',
        header: 'Severity',
        cell: ({ row }) => (
          <Badge tone={ALERT_SEVERITY_TONE[row.original.severity]} dot className="uppercase tracking-wide">
            {row.original.severity}
          </Badge>
        ),
        size: 110,
      },
      {
        id: 'alert',
        header: 'Alert',
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.title}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-fg-subtle">
              <span className="font-mono">{row.original.type}</span>
              {row.original.dedupeKey ? <span className="truncate">· dedupe {row.original.dedupeKey}</span> : null}
            </div>
          </div>
        ),
      },
      {
        id: 'raised',
        header: 'Raised',
        cell: ({ row }) => (
          <Tooltip content={formatDateTime(row.original.createdAt)}>
            <span className="whitespace-nowrap text-fg-muted">{formatRelative(row.original.createdAt)}</span>
          </Tooltip>
        ),
        size: 110,
      },
      {
        id: 'delivery',
        header: 'Delivered via',
        cell: ({ row }) => {
          const d = row.original.deliveries ?? [];
          if (!d.length) return <span className="text-2xs text-fg-subtle">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {d.map((x, i) => (
                <Tooltip key={i} content={x.ok ? `${x.notifier}: delivered` : `${x.notifier}: ${x.error ?? 'failed'}`}>
                  <span>
                    <Badge tone={x.ok ? 'success' : 'danger'} size="sm" className="font-mono">
                      {x.notifier}
                    </Badge>
                  </span>
                </Tooltip>
              ))}
            </div>
          );
        },
        size: 140,
      },
      {
        id: 'state',
        header: 'State',
        cell: ({ row }) =>
          row.original.acknowledgedAt ? (
            <div className="text-xs">
              <Badge tone="neutral" className="gap-1">
                <CheckCheck className="size-3" /> acknowledged
              </Badge>
              <div className="mt-0.5 text-2xs text-fg-subtle">{formatRelative(row.original.acknowledgedAt)}</div>
            </div>
          ) : (
            <Badge tone="accent" dot>
              open
            </Badge>
          ),
        size: 140,
      },
      {
        id: 'actions',
        header: '',
        meta: { align: 'right' },
        cell: ({ row }) =>
          !row.original.acknowledgedAt && can('alertsAck') ? (
            <Button
              variant="outline"
              size="xs"
              onClick={(e) => {
                e.stopPropagation();
                ack.mutate(row.original.id);
              }}
              loading={ack.isPending && ack.variables === row.original.id}
              aria-label={`Acknowledge ${row.original.title}`}
            >
              <Check className="size-3" /> Acknowledge
            </Button>
          ) : null,
        size: 130,
      },
    ],
    [expanded, ack, can],
  );

  const hasFilters = params.type || params.severity || params.state !== 'open' || params.from || params.to;
  const bySeverity = useMemo(() => {
    const out: Record<AlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
    for (const a of list.data?.data ?? []) if (!a.acknowledgedAt) out[a.severity] += 1;
    return out;
  }, [list.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Alerts"
        description="Money-day signals raised by the rules engine: ledger drift, payout failure rate, account minting, spend velocity and OTP spikes."
        actions={
          <>
            {meta ? <NotifierPills notifiers={meta.notifiers} /> : null}
            {can('alertsRunRules') ? (
              <Button onClick={() => run.mutate()} loading={run.isPending} data-testid="run-rules">
                <Play className="size-4" /> Run rules now
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open alerts" value={meta?.openCount} loading={!meta} icon={BellRing} tone={meta && meta.openCount > 0 ? 'danger' : 'success'} hint="Unacknowledged, all types" />
        <StatCard label="Critical on this page" value={meta ? bySeverity.critical : undefined} loading={!meta} tone={bySeverity.critical ? 'danger' : 'default'} hint="Open critical alerts in the current view" />
        <StatCard label="Warnings on this page" value={meta ? bySeverity.warning : undefined} loading={!meta} tone={bySeverity.warning ? 'warning' : 'default'} hint="Open warning alerts in the current view" />
        <StatCard label="Matching alerts" value={meta?.total} loading={!meta} icon={Radio} hint={hasFilters ? 'With the current filters' : 'Open alerts (default filter)'} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="al-state" className="mb-1">
            State
          </Label>
          <NativeSelect id="al-state" value={params.state} onChange={(e) => set({ state: e.target.value })} className="w-36">
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="all">All</option>
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="al-type" className="mb-1">
            Type
          </Label>
          <NativeSelect id="al-type" value={params.type} onChange={(e) => set({ type: e.target.value })} className="w-52">
            <option value="">Any type</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="al-sev" className="mb-1">
            Severity
          </Label>
          <NativeSelect id="al-sev" value={params.severity} onChange={(e) => set({ severity: e.target.value })} className="w-32">
            <option value="">Any</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="al-from" className="mb-1">
            From
          </Label>
          <Input id="al-from" type="date" value={params.from} onChange={(e) => set({ from: e.target.value })} className="w-38 tabular" />
        </div>
        <div>
          <Label htmlFor="al-to" className="mb-1">
            To
          </Label>
          <Input id="al-to" type="date" value={params.to} onChange={(e) => set({ to: e.target.value })} className="w-38 tabular" />
        </div>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            Clear
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={list.data?.data}
        getRowId={(r) => r.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setExpanded((e) => (e === r.id ? null : r.id))}
        expandedRowId={expanded}
        renderExpanded={(r) => <AlertDetail alert={r} />}
        rowClassName={(r) => cn(!r.acknowledgedAt && r.severity === 'critical' && 'bg-danger/5')}
        emptyState={
          <EmptyState compact icon={BellOff} title={params.state === 'open' ? 'No open alerts' : 'No alerts match'} description={params.state === 'open' ? 'Every alert has been acknowledged. Rules run on a schedule; super admins can run them now.' : 'Try widening the filters or the date range.'} />
        }
        aria-label="Platform alerts"
      />
      <PaginationBar page={params.page} limit={params.limit} total={meta?.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[25, 50, 100]} isFetching={list.isFetching} />

      <RunRulesResultDialog result={runResult} onClose={() => setRunResult(null)} />
    </div>
  );
}

function NotifierPills({ notifiers }: { notifiers: AlertNotifierInfo[] }) {
  if (!notifiers.length)
    return (
      <Badge tone="danger" className="gap-1">
        <BellOff className="size-3" /> no notifiers configured
      </Badge>
    );
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="notifier-pills">
      {notifiers.map((n) => (
        <Tooltip key={n.name} content={n.mock ? `${n.name}: mock notifier - alerts are only written to the API log, nobody is paged.` : `${n.name}: live delivery channel`}>
          <span>
            <Badge tone={n.mock ? 'warning' : 'success'} className="gap-1 font-mono">
              {n.mock ? <FlaskConical className="size-3" /> : <Radio className="size-3" />}
              {n.name}
              {n.mock ? ' · mock' : ''}
            </Badge>
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

function AlertDetail({ alert }: { alert: PlatformAlertItem }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <div className="mb-1.5 text-2xs font-semibold tracking-wider text-fg-subtle uppercase">Payload</div>
        <JsonView value={alert.payload} maxHeight={280} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-fg-subtle">Alert id</dt>
        <dd>
          <IdChip id={alert.id} length={36} />
        </dd>
        <dt className="text-fg-subtle">Type</dt>
        <dd className="font-mono">{alert.type}</dd>
        <dt className="text-fg-subtle">Raised</dt>
        <dd>{formatDateTime(alert.createdAt)}</dd>
        <dt className="text-fg-subtle">Dedupe key</dt>
        <dd className="font-mono break-all">{alert.dedupeKey ?? '—'}</dd>
        <dt className="text-fg-subtle">Acknowledged</dt>
        <dd>
          {alert.acknowledgedAt ? (
            <>
              {formatDateTime(alert.acknowledgedAt)} by <IdChip id={alert.acknowledgedBy} />
            </>
          ) : (
            'not yet'
          )}
        </dd>
        <dt className="text-fg-subtle">Deliveries</dt>
        <dd>
          {alert.deliveries?.length ? (
            <ul className="space-y-0.5">
              {alert.deliveries.map((d, i) => (
                <li key={i} className="font-mono">
                  {d.notifier}: {d.ok ? <span className="text-success">ok</span> : <span className="text-danger">{d.error ?? 'failed'}</span>}
                </li>
              ))}
            </ul>
          ) : (
            '—'
          )}
        </dd>
      </dl>
    </div>
  );
}

function RunRulesResultDialog({ result, onClose }: { result: AlertRulesRunResult | null; onClose: () => void }) {
  const raised = result?.rules.reduce((a, r) => a + r.raised, 0) ?? 0;
  return (
    <Dialog open={Boolean(result)} onOpenChange={(o) => !o && onClose()} title="Alert rules evaluated" description={result ? `Ran at ${formatDateTime(result.ranAt)} · ${raised} new alert${raised === 1 ? '' : 's'}` : undefined} size="md">
      {result ? (
        <Card className="shadow-none">
          <CardHeader title="Per rule" description="Checked = items the rule looked at; raised = new alerts (deduped)." />
          <table className="w-full text-sm" data-testid="run-rules-result">
            <tbody className="divide-y">
              {result.rules.map((r) => (
                <tr key={r.rule}>
                  <td className="px-4 py-2 font-mono text-xs">{r.rule}</td>
                  <td className="px-4 py-2 text-right tabular text-fg-muted">{formatInt(r.checked)} checked</td>
                  <td className="px-4 py-2 text-right">
                    <Badge tone={r.raised ? 'danger' : 'success'} className="tabular">
                      {r.raised ? `${r.raised} raised` : 'clear'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </Dialog>
  );
}
