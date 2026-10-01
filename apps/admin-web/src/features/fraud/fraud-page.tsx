import { ErrorCode, type FraudFlagItem, type FraudSeverity } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Ban, CheckCircle2, ExternalLink, ShieldAlert, ShieldCheck, TrendingUp, UserRoundX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { fraudApi } from '@/lib/api/endpoints';
import { describeError, isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useListParams } from '@/lib/hooks/use-list-params';
import { cn } from '@/lib/utils/cn';
import { formatDateTime, formatInt, humanize } from '@/lib/utils/format';
import { Badge, SEVERITY_ORDER, SeverityBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { ReasonDialog } from '@/components/ui/confirm';
import { PaginationBar } from '@/components/ui/data-table';
import { Sheet } from '@/components/ui/dialog';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { Label, NativeSelect } from '@/components/ui/input';
import { JsonView } from '@/components/ui/json';
import { IdChip, PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat';
import { FlagsTable } from '@/features/users/user-tables';
import { FlagTypeBars, FraudTrendChart, SeverityDonut } from './fraud-charts';

const defaults = { resolved: 'open' as string, severity: '' as string, flagType: '' as string, userId: '' as string, page: 1, limit: 50 };

export function FraudPage() {
  const { flagId } = useParams();
  const navigate = useNavigate();
  const { params, set, reset } = useListParams(defaults);
  const metrics = useQuery({ queryKey: queryKeys.fraudMetrics, queryFn: fraudApi.metrics, refetchInterval: 60_000 });

  const queryParams = useMemo(
    () => ({
      resolved: params.resolved === 'open' ? false : params.resolved === 'resolved' ? true : undefined,
      severity: (params.severity || undefined) as FraudSeverity | undefined,
      flagType: params.flagType || undefined,
      userId: params.userId || undefined,
      page: params.page,
      limit: params.limit,
    }),
    [params.resolved, params.severity, params.flagType, params.userId, params.page, params.limit],
  );
  const flags = useQuery({ queryKey: queryKeys.fraudFlags(queryParams), queryFn: () => fraudApi.flags(queryParams), refetchInterval: 30_000, placeholderData: (p) => p });
  const m = metrics.data;
  const openTotal = m ? Object.values(m.openFlagsBySeverity).reduce((a, b) => a + b, 0) : undefined;
  const flagTypes = useMemo(() => {
    const set = new Set<string>(m?.flagsByType.map((t) => t.flagType) ?? []);
    for (const f of flags.data?.data ?? []) set.add(f.flagType);
    return [...set].sort();
  }, [m, flags.data]);
  const hasFilters = params.resolved !== 'open' || params.severity || params.flagType || params.userId;

  return (
    <div className="space-y-4">
      <PageHeader title="Fraud dashboard" description="Live view of flagged activity. Dismiss false positives, escalate suspicious patterns, or suspend confirmed abusers." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Flagged this week" value={m ? m.weekly.flaggedRate * 100 : undefined} format={(v) => `${v.toFixed(1)}%`} loading={!m} icon={TrendingUp} tone="accent" hint={m ? `${formatInt(m.weekly.flaggedCompletions + m.weekly.rejectedCompletions)} of ${formatInt(m.weekly.rawCompletions)} completions (7 UTC days)` : undefined} />
        <StatCard label="Open flags" value={openTotal} loading={!m} icon={ShieldAlert} tone="danger" hint={m ? SEVERITY_ORDER.map((s) => `${m.openFlagsBySeverity[s]} ${s}`).join(' · ') : undefined} />
        <StatCard label="Suspended users" value={m?.suspendedUsers} loading={!m} icon={UserRoundX} tone="warning" hint={m ? `${formatInt(m.bannedUsers)} banned` : undefined} to="/users?status=suspended" />
        <StatCard label="Low-trust active users" value={m?.lowTrustUsers} loading={!m} tone="info" hint="Trust score below 30" to="/users?maxTrustScore=29&status=active" />
        <StatCard label="Ledger drifts" value={m?.ledgerDriftsDetected} loading={!m} icon={ShieldCheck} tone={m && m.ledgerDriftsDetected > 0 ? 'danger' : 'success'} hint="Cached balance vs ledger sum (hourly job)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Completions vs. fraud filter" description="Daily valid / flagged / rejected completions, last 7 days." />
          <CardBody className="h-56 p-2 pr-4">{m ? <FraudTrendChart data={m.daily} /> : <Skeleton className="h-full w-full" />}</CardBody>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Card>
            <CardHeader title="Open flags by severity" />
            <CardBody className="h-40 p-2">{m ? <SeverityDonut data={m.openFlagsBySeverity} /> : <Skeleton className="h-full w-full" />}</CardBody>
          </Card>
          <Card>
            <CardHeader title="By rule (7 days)" />
            <CardBody className="h-40 p-1">{m ? <FlagTypeBars data={m.flagsByType} /> : <Skeleton className="h-full w-full" />}</CardBody>
          </Card>
        </div>
      </div>

      <section aria-labelledby="flags-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="flags-heading" className="text-sm font-semibold text-fg">
            Flags {flags.data ? <span className="text-fg-subtle">({formatInt(flags.data.meta.total)})</span> : null}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="f-state" className="mb-1">
                State
              </Label>
              <NativeSelect id="f-state" value={params.resolved} onChange={(e) => set({ resolved: e.target.value })} className="w-32">
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="all">All</option>
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="f-sev" className="mb-1">
                Severity
              </Label>
              <NativeSelect id="f-sev" value={params.severity} onChange={(e) => set({ severity: e.target.value })} className="w-32">
                <option value="">Any</option>
                {SEVERITY_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="f-type" className="mb-1">
                Rule
              </Label>
              <NativeSelect id="f-type" value={params.flagType} onChange={(e) => set({ flagType: e.target.value })} className="w-56">
                <option value="">Any rule</option>
                {flagTypes.map((t) => (
                  <option key={t} value={t}>
                    {humanize(t)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {params.userId ? (
              <div className="pb-1 text-xs text-fg-muted">
                User <IdChip id={params.userId} to={`/users/${params.userId}`} />
              </div>
            ) : null}
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={reset}>
                Reset
              </Button>
            ) : null}
          </div>
        </div>

        <FlagsTable rows={flags.data?.data} isLoading={flags.isPending} error={flags.error} onRetry={() => void flags.refetch()} showUser onSelect={(f) => navigate({ pathname: `/fraud/${f.id}`, search: window.location.search })} selectedId={flagId ?? null} maxHeight="60vh" virtualized />
        <PaginationBar page={params.page} limit={params.limit} total={flags.data?.meta.total} onPageChange={(p) => set({ page: p })} onLimitChange={(l) => set({ limit: l, page: 1 })} limits={[50, 100]} isFetching={flags.isFetching} />
      </section>

      <FlagSheet id={flagId ?? null} initial={flags.data?.data.find((f) => f.id === flagId)} onClose={() => navigate({ pathname: '/fraud', search: window.location.search })} />
    </div>
  );
}

/* --------------------------------- drawer -------------------------------- */

type FlagAction = 'dismiss' | 'escalate' | 'suspend';

export function FlagSheet({ id, initial, onClose }: { id: string | null; initial?: FraudFlagItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: queryKeys.fraudFlag(id ?? ''), queryFn: () => fraudApi.flag(id!), enabled: Boolean(id), initialData: initial, staleTime: 0 });
  const f = detail.data;
  const [action, setAction] = useState<FlagAction | null>(null);

  // Sibling flags on the same completion decide whether dismissing releases the reward.
  const siblings = useQuery({
    queryKey: queryKeys.fraudFlags({ related: f?.relatedEntityId ?? '', type: f?.relatedEntityType ?? '' }),
    queryFn: () => fraudApi.flags({ relatedEntityType: f!.relatedEntityType, limit: 50 }),
    enabled: Boolean(f && f.relatedEntityType === 'ad_completion' && f.relatedEntityId),
    select: (res) => res.data.filter((x) => x.relatedEntityId === f?.relatedEntityId && x.id !== f?.id && !x.resolved),
  });
  const otherOpen = siblings.data?.length ?? 0;

  const done = (res: FraudFlagItem, msg: string, description?: string) => {
    toast.success(msg, { description });
    queryClient.setQueryData(queryKeys.fraudFlag(id!), res);
    void queryClient.invalidateQueries({ queryKey: ['fraud'] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    setAction(null);
  };

  const mutation = useMutation({
    mutationFn: ({ kind, text }: { kind: FlagAction; text: string }) =>
      kind === 'dismiss' ? fraudApi.dismiss(id!, text || undefined) : kind === 'escalate' ? fraudApi.escalate(id!, text || undefined) : fraudApi.suspendUser(id!, text),
    onSuccess: (res, { kind }) =>
      done(
        res,
        kind === 'dismiss' ? 'Flag dismissed' : kind === 'escalate' ? 'Flag escalated' : 'User suspended',
        kind === 'dismiss' && f?.relatedEntityType === 'ad_completion' && otherOpen === 0
          ? 'This was the last open flag on the completion - the reward has been credited to the user via the ledger.'
          : kind === 'escalate'
            ? 'Trust score reduced by 10 and the flag marked for deeper investigation.'
            : kind === 'suspend'
              ? 'Flag confirmed, sessions revoked and trust score recomputed.'
              : undefined,
      ),
    onError: (err, { kind }) =>
      toast.error(kind === 'dismiss' && isApiError(err) && err.code === ErrorCode.CAMPAIGN_NOT_CHARGEABLE ? 'Reward cannot be released' : 'Action failed', {
        description: describeError(err),
      }),
  });

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      title={f ? humanize(f.flagType) : 'Fraud flag'}
      description={f ? `Raised ${formatDateTime(f.createdAt)}` : undefined}
      footer={
        f && !f.resolved ? (
          <>
            <Button variant="outline" onClick={() => setAction('dismiss')} disabled={mutation.isPending}>
              <CheckCircle2 className="size-4 text-success" /> Dismiss
            </Button>
            <Button variant="outline" onClick={() => setAction('escalate')} disabled={mutation.isPending}>
              <ArrowUpRight className="size-4 text-accent" /> Escalate
            </Button>
            <Button variant="danger" onClick={() => setAction('suspend')} disabled={mutation.isPending || !f.userId}>
              <Ban className="size-4" /> Suspend user
            </Button>
          </>
        ) : null
      }
    >
      {!f ? (
        detail.isError ? (
          <EmptyState compact title="Could not load flag" description={describeError(detail.error)} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-32 w-full" />
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={f.severity} />
            {f.resolved ? <StatusBadge status={f.resolution ?? 'resolved'} /> : <Badge tone="warning" dot>Open</Badge>}
            <Badge tone="neutral" className="tabular">
              trust Δ {f.trustScoreDelta > 0 ? '+' : ''}
              {f.trustScoreDelta}
            </Badge>
          </div>
          <p className="text-sm text-fg">{f.description}</p>

          <Card>
            <CardHeader title="Context" />
            <CardBody>
              <DescriptionList
                items={[
                  {
                    label: 'User',
                    value: f.userId ? (
                      <Link to={`/users/${f.userId}`} className="inline-flex items-center gap-1 font-mono text-xs hover:text-primary hover:underline">
                        {f.userPhone ?? f.userId} <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'Related entity', value: `${humanize(f.relatedEntityType)}` },
                  { label: 'Entity id', value: <IdChip id={f.relatedEntityId} length={36} />, span: 2 },
                  { label: 'Flag id', value: <IdChip id={f.id} length={36} />, span: 2 },
                  ...(f.resolved
                    ? [
                        { label: 'Resolved by', value: <IdChip id={f.resolvedBy} /> },
                        { label: 'Resolved at', value: formatDateTime(f.resolvedAt) },
                        { label: 'Resolution note', value: f.resolutionNote ?? '—', span: 2 as const },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          {f.relatedEntityType === 'ad_completion' && !f.resolved ? (
            <div className={cn('rounded-md border px-3 py-2 text-xs', otherOpen === 0 ? 'border-warning/40 bg-warning/10' : 'border-info/40 bg-info/10')}>
              {siblings.isPending ? (
                'Checking other flags on this completion…'
              ) : otherOpen === 0 ? (
                <>
                  <span className="font-medium">This is the only open flag on the completion.</span> Dismissing it marks the view genuine and <span className="font-medium">credits the user’s reward</span> through the ledger (charging the campaign).
                </>
              ) : (
                <>
                  {otherOpen} other open flag{otherOpen === 1 ? '' : 's'} on this completion. The reward is only released once <span className="font-medium">all</span> of them are dismissed.
                </>
              )}
            </div>
          ) : null}

          <Card>
            <CardHeader title="Rule metadata" description="Raw signal captured by the fraud engine." />
            <CardBody className="p-2">
              <JsonView value={f.metadata} />
            </CardBody>
          </Card>
        </div>
      )}

      {f ? (
        <ReasonDialog
          open={action !== null}
          onOpenChange={(o) => !o && setAction(null)}
          destructive={action === 'suspend'}
          optional={action !== 'suspend'}
          reasonLabel={action === 'suspend' ? 'Reason' : 'Note'}
          title={action === 'dismiss' ? 'Dismiss this flag?' : action === 'escalate' ? 'Escalate this flag?' : `Suspend ${f.userPhone ?? 'this user'}?`}
          description={
            action === 'dismiss'
              ? f.relatedEntityType === 'ad_completion'
                ? otherOpen === 0
                  ? 'Marks the flag a false positive. Because no other flags remain on this completion, the user is credited the reward immediately and the campaign is charged.'
                  : `Marks the flag a false positive. ${otherOpen} other flag${otherOpen === 1 ? '' : 's'} remain, so nothing is credited yet.`
                : 'Marks the flag a false positive. No balance changes.'
              : action === 'escalate'
                ? 'Marks the flag for investigation and lowers the user’s trust score by 10. Nothing is credited.'
                : 'Confirms the flag, suspends the account (sessions revoked), and recomputes the trust score. Provide the reason shown in the audit log.'
          }
          confirmLabel={action === 'dismiss' ? (f.relatedEntityType === 'ad_completion' && otherOpen === 0 ? 'Dismiss & credit reward' : 'Dismiss flag') : action === 'escalate' ? 'Escalate' : 'Suspend user'}
          confirmVariant={action === 'dismiss' ? 'success' : action === 'escalate' ? 'primary' : undefined}
          loading={mutation.isPending}
          onConfirm={(text) => { if (action) mutation.mutate({ kind: action, text }); }}
        />
      ) : null}
    </Sheet>
  );
}
