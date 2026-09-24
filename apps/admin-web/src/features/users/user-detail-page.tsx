import type { AuditLogItem } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Fingerprint, ShieldAlert, ShieldCheck, UserRoundX, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { auditApi, fraudApi, usersApi } from '@/lib/api/endpoints';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { useAuth } from '@/lib/auth/use-auth';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatDate, formatDateTime, formatEtb, formatInt, formatPercent, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { ReasonDialog } from '@/components/ui/confirm';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { DiffView } from '@/components/ui/json';
import { IdChip, Initials, PageHeader } from '@/components/ui/page';
import { Tabs, TabsContent, TabsUnderline, TabsUnderlineTrigger } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/stat';
import { FlagsTable, LedgerTable, UserWithdrawalsTable } from './user-tables';

type Action = 'suspend' | 'ban' | 'reinstate';

export function UserDetailPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') ?? 'overview';
  const highlight = searchParams.get('highlight');
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const user = useQuery({ queryKey: queryKeys.user(userId), queryFn: () => usersApi.detail(userId), enabled: Boolean(userId) });
  const [action, setAction] = useState<Action | null>(null);

  const moderate = useMutation({
    mutationFn: ({ kind, reason }: { kind: Action; reason: string }) =>
      kind === 'suspend' ? usersApi.suspend(userId, reason) : kind === 'ban' ? usersApi.ban(userId, reason) : usersApi.reinstate(userId, reason),
    onSuccess: (_res, { kind }) => {
      toast.success(kind === 'reinstate' ? 'User reinstated' : kind === 'suspend' ? 'User suspended' : 'User banned', {
        description: kind === 'reinstate' ? 'The user was notified and can sign in again.' : 'Active sessions were revoked and the reason recorded in the audit log.',
      });
      setAction(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.user(userId) });
      void queryClient.invalidateQueries({ queryKey: ['users', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
    onError: (err) => toast.error('Action failed', { description: describeError(err) }),
  });

  const u = user.data;
  const canModerate = can('usersModerate');

  if (user.isError) return <ErrorState error={user.error} onRetry={() => void user.refetch()} title="Could not load this user" />;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: 'Users', to: '/users' }, { label: u?.phoneNumber ?? 'â€¦' }]}
        title={
          u ? (
            <span className="flex items-center gap-3">
              <Initials name={u.fullName} className="size-9 text-sm" />
              <span>
                {u.fullName ?? <span className="text-fg-subtle">Profile incomplete</span>}
                <span className="ml-2 font-mono text-sm font-normal text-fg-muted">{u.phoneNumber}</span>
              </span>
              <StatusBadge status={u.status} />
            </span>
          ) : (
            <Skeleton className="h-7 w-72" />
          )
        }
        description={u?.statusReason ? <span className="text-danger">Status reason: {u.statusReason}</span> : u ? `Joined ${formatDate(u.createdAt)} Â· last login ${formatDateTime(u.lastLoginAt)}` : undefined}
        actions={
          u && canModerate ? (
            <>
              {u.status !== 'active' ? (
                <Button variant="success" onClick={() => setAction('reinstate')}>
                  <ShieldCheck className="size-4" /> Reinstate
                </Button>
              ) : null}
              {u.status !== 'suspended' && u.status !== 'banned' ? (
                <Button variant="outline" onClick={() => setAction('suspend')}>
                  <UserRoundX className="size-4 text-warning" /> Suspend
                </Button>
              ) : null}
              {u.status !== 'banned' ? (
                <Button variant="danger" onClick={() => setAction('ban')}>
                  <Ban className="size-4" /> Ban
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Trust score" value={u?.trustScore} loading={!u} icon={ShieldAlert} tone={u && u.trustScore < 40 ? 'danger' : u && u.trustScore < 60 ? 'warning' : 'success'} hint={u ? (u.trustScore < 20 ? 'Below feed threshold - sees no ads' : 'Recomputed from flags & history') : undefined} />
        <StatCard label="Coin balance" value={u?.coinBalance} loading={!u} icon={Wallet} tone="primary" hint={u ? `${formatEtb(u.coinBalance / 100)} Â· derived from ledger` : undefined} />
        <StatCard label="Valid completions" value={u?.stats.validCompletions} loading={!u} hint={u ? `${formatInt(u.stats.totalCompletions)} total Â· ${formatPercent(u.stats.totalCompletions ? (u.stats.flaggedCompletions + u.stats.rejectedCompletions) / u.stats.totalCompletions : 0)} filtered` : undefined} />
        <StatCard label="Total withdrawn" value={u ? Number(u.stats.totalWithdrawnEtb) : undefined} format={(v) => formatEtb(v)} loading={!u} hint={u ? `${formatCoins(u.stats.totalEarnedCoins)} coins earned lifetime` : undefined} />
        <StatCard label="Open flags" value={u?.openFlags} loading={!u} tone={u && u.openFlags > 0 ? 'danger' : 'default'} hint={u ? `${u.stats.distinctDevices} device${u.stats.distinctDevices === 1 ? '' : 's'} Â· ${u.stats.distinctIps} IP${u.stats.distinctIps === 1 ? '' : 's'}` : undefined} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('tab', v); return n; }, { replace: true })}>
        <TabsUnderline>
          <TabsUnderlineTrigger value="overview">Overview</TabsUnderlineTrigger>
          <TabsUnderlineTrigger value="ledger">Ledger {u ? <Badge tone="neutral" size="sm">{u.recentLedger.length}</Badge> : null}</TabsUnderlineTrigger>
          <TabsUnderlineTrigger value="withdrawals">Withdrawals {u ? <Badge tone="neutral" size="sm">{u.withdrawals.length}</Badge> : null}</TabsUnderlineTrigger>
          <TabsUnderlineTrigger value="flags">Fraud flags {u ? <Badge tone={u.openFlags ? 'danger' : 'neutral'} size="sm">{u.flags.length}</Badge> : null}</TabsUnderlineTrigger>
          <TabsUnderlineTrigger value="devices">Devices</TabsUnderlineTrigger>
          {can('audit') ? <TabsUnderlineTrigger value="audit">Audit trail</TabsUnderlineTrigger> : null}
        </TabsUnderline>

        <TabsContent value="overview" className="mt-4">
          {u ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Profile" />
                <CardBody>
                  <DescriptionList
                    items={[
                      { label: 'Full name', value: u.fullName ?? 'â€”' },
                      { label: 'Phone', value: u.phoneNumber, mono: true },
                      { label: 'Date of birth', value: u.dateOfBirth ? formatDate(u.dateOfBirth) : 'â€”' },
                      { label: 'Age verification', value: <StatusBadge status={u.ageVerificationStatus === 'verified_adult' ? 'verified' : u.ageVerificationStatus} /> },
                      { label: 'Language', value: humanize(u.languagePreference) },
                      { label: 'Profile complete', value: u.profileComplete ? 'Yes' : 'No' },
                      { label: 'Notifications', value: Object.entries(u.notificationPrefs).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none' },
                      { label: 'User id', value: <IdChip id={u.id} length={36} />, span: 2 },
                    ]}
                  />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Completions" description="Server-verified outcomes of watch sessions." />
                <CardBody>
                  <DescriptionList
                    columns={3}
                    items={[
                      { label: 'Total', value: <span className="tabular text-lg font-semibold">{formatInt(u.stats.totalCompletions)}</span> },
                      { label: 'Valid', value: <span className="tabular text-lg font-semibold text-success">{formatInt(u.stats.validCompletions)}</span> },
                      { label: 'Flagged', value: <span className="tabular text-lg font-semibold text-warning">{formatInt(u.stats.flaggedCompletions)}</span> },
                      { label: 'Rejected', value: <span className="tabular text-lg font-semibold text-danger">{formatInt(u.stats.rejectedCompletions)}</span> },
                      { label: 'Earned (coins)', value: <span className="tabular">{formatCoins(u.stats.totalEarnedCoins)}</span> },
                      { label: 'Withdrawn', value: <span className="tabular">{formatEtb(u.stats.totalWithdrawnEtb)}</span> },
                    ]}
                  />
                  <p className="mt-3 text-xs text-fg-subtle">Per-completion detail is not exposed by the admin API; flagged completions are visible through their fraud flags.</p>
                </CardBody>
              </Card>
            </div>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          {u ? <LedgerTable entries={u.recentLedger} highlightId={highlight} /> : <Skeleton className="h-64 w-full" />}
          <p className="mt-2 text-xs text-fg-subtle">Most recent 20 entries. The cached balance ({u ? formatCoins(u.coinBalance) : 'â€¦'}) is derived from this append-only ledger.</p>
        </TabsContent>

        <TabsContent value="withdrawals" className="mt-4">
          {u ? <UserWithdrawalsTable rows={u.withdrawals} /> : <Skeleton className="h-64 w-full" />}
          {u && can('withdrawals') ? (
            <Link to={`/withdrawals?status=all&userId=${u.id}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
              Open in withdrawal queue â†’
            </Link>
          ) : null}
        </TabsContent>

        <TabsContent value="flags" className="mt-4">
          {u ? <FlagsTable rows={u.flags} onSelect={can('fraud') ? (f) => navigate(`/fraud/${f.id}`) : undefined} /> : <Skeleton className="h-64 w-full" />}
          {u && can('fraud') ? (
            <Link to={`/fraud?userId=${u.id}&resolved=all`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
              Open in fraud dashboard â†’
            </Link>
          ) : null}
        </TabsContent>

        <TabsContent value="devices" className="mt-4">
          {u ? <DevicesPanel userId={u.id} deviceId={u.deviceId} lastIp={u.lastIp ?? null} distinctDevices={u.stats.distinctDevices} distinctIps={u.stats.distinctIps} /> : <Skeleton className="h-64 w-full" />}
        </TabsContent>

        {can('audit') ? (
          <TabsContent value="audit" className="mt-4">
            <UserAuditTrail userId={userId} />
          </TabsContent>
        ) : null}
      </Tabs>

      {u ? (
        <ReasonDialog
          open={action !== null}
          onOpenChange={(o) => !o && setAction(null)}
          destructive={action !== 'reinstate'}
          title={action === 'suspend' ? `Suspend ${u.fullName ?? u.phoneNumber}?` : action === 'ban' ? `Ban ${u.fullName ?? u.phoneNumber}?` : `Reinstate ${u.fullName ?? u.phoneNumber}?`}
          description={
            action === 'suspend'
              ? 'The user is signed out everywhere, active watch sessions are abandoned and the feed is blocked until reinstated.'
              : action === 'ban'
                ? 'Permanent block: the account cannot sign in or earn. Pending withdrawals should be decided separately in the finance queue.'
                : 'The account returns to active, the status reason is cleared and the user gets a notification.'
          }
          confirmLabel={action === 'suspend' ? 'Suspend user' : action === 'ban' ? 'Ban user' : 'Reinstate user'}
          confirmVariant={action === 'reinstate' ? 'success' : undefined}
          loading={moderate.isPending}
          onConfirm={(reason) => { if (action) moderate.mutate({ kind: action, reason }); }}
        />
      ) : null}
    </div>
  );
}

function DevicesPanel({ userId, deviceId, lastIp, distinctDevices, distinctIps }: { userId: string; deviceId: string | null; lastIp: string | null; distinctDevices: number; distinctIps: number }) {
  // Shared-device evidence comes from fraud flags of the device-ring rules for this user.
  const flags = useQuery({ queryKey: queryKeys.fraudFlags({ userId, ring: true }), queryFn: () => fraudApi.flags({ userId, limit: 100 }) });
  const ring = useMemo(() => (flags.data?.data ?? []).filter((f) => /DEVICE|MULTI_ACCOUNT|RING/i.test(f.flagType)), [flags.data]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Devices & network" description="Fingerprints and IPs seen on watch sessions." />
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Registered device id', value: deviceId ?? 'â€”', mono: true },
              { label: 'Last IP', value: lastIp ?? 'â€”', mono: true },
              { label: 'Distinct fingerprints', value: <span className={cn('tabular font-medium', distinctDevices > 2 && 'text-warning')}>{distinctDevices}</span> },
              { label: 'Distinct IPs', value: <span className="tabular font-medium">{distinctIps}</span> },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Shared with other accounts" description="Device-ring rules fire when one fingerprint is used by several accounts." actions={<Fingerprint className="size-4 text-fg-subtle" />} />
        {flags.isPending ? (
          <CardBody>
            <Skeleton className="h-16 w-full" />
          </CardBody>
        ) : ring.length === 0 ? (
          <EmptyState compact title="No shared-device signals" description="No device-sharing or multi-account flags have been raised for this user." />
        ) : (
          <ul className="divide-y">
            {ring.map((f) => {
              const meta = (f.metadata ?? {}) as Record<string, unknown>;
              const others = Array.isArray(meta.accounts) ? (meta.accounts as string[]) : Array.isArray(meta.userIds) ? (meta.userIds as string[]) : [];
              return (
                <li key={f.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{humanize(f.flagType)}</span>
                    <Badge tone={f.resolved ? 'neutral' : 'danger'} size="sm">
                      {f.resolved ? humanize(f.resolution) : 'open'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-muted">{f.description}</p>
                  {typeof meta.fingerprint === 'string' ? <p className="mt-1 font-mono text-2xs text-fg-subtle">fingerprint {meta.fingerprint}</p> : null}
                  {others.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {others
                        .filter((id) => id !== userId)
                        .map((id) => (
                          <Link key={id} to={`/users/${id}`} className="rounded border px-1.5 py-0.5 font-mono text-2xs hover:bg-sunken">
                            {id.slice(0, 8)}â€¦
                          </Link>
                        ))}
                    </div>
                  ) : null}
                  <Link to={`/fraud/${f.id}`} className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline">
                    Open flag â†’
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UserAuditTrail({ userId }: { userId: string }) {
  const asTarget = useQuery({ queryKey: queryKeys.audit({ targetId: userId, limit: 50 }), queryFn: () => auditApi.list({ targetId: userId, limit: 50 }) });
  const asActor = useQuery({ queryKey: queryKeys.audit({ actorId: userId, limit: 50 }), queryFn: () => auditApi.list({ actorId: userId, actorType: 'user', limit: 50 }) });
  const rows = useMemo(() => {
    const map = new Map<string, AuditLogItem>();
    for (const r of [...(asTarget.data?.data ?? []), ...(asActor.data?.data ?? [])]) map.set(r.id, r);
    return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [asTarget.data, asActor.data]);
  const [open, setOpen] = useState<string | null>(null);

  if (asTarget.isPending || asActor.isPending) return <Skeleton className="h-48 w-full" />;
  if (asTarget.isError) return <ErrorState error={asTarget.error} compact onRetry={() => void asTarget.refetch()} />;
  if (!rows.length) return <EmptyState compact title="No audit entries" description="Moderation and withdrawal decisions for this user will be listed here." />;

  return (
    <Card>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen((o) => (o === r.id ? null : r.id))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-sunken/60" aria-expanded={open === r.id}>
              <Badge tone={r.action.includes('ban') || r.action.includes('reject') ? 'danger' : r.action.includes('suspend') ? 'warning' : 'primary'}>{r.action}</Badge>
              <span className="flex-1 truncate text-xs text-fg-muted">
                {humanize(r.actorType)} {r.actorEmail ?? (r.actorId === userId ? 'this user' : r.actorId?.slice(0, 8) ?? 'system')} â†’ {humanize(r.targetType)} {r.targetId?.slice(0, 8)}
              </span>
              <span className="whitespace-nowrap text-xs text-fg-subtle">{formatDateTime(r.createdAt)}</span>
            </button>
            {open === r.id ? (
              <div className="border-t bg-sunken/40 px-4 py-3">
                <DiffView before={r.beforeState} after={r.afterState} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="border-t px-4 py-2 text-xs">
        <Link to={`/audit?targetId=${userId}`} className="font-medium text-primary hover:underline">
          Open in audit log viewer â†’
        </Link>
      </div>
    </Card>
  );
}
