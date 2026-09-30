import type { AuditLogItem } from '@rap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, Eye, Fingerprint, Gift, IdCard, ShieldAlert, ShieldCheck, UserRoundX, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { auditApi, fraudApi, usersApi } from '@/lib/api/endpoints';
import { describeError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { AdminUser } from '@/lib/api/types';
import { impersonationStore, useImpersonation } from '@/lib/auth/impersonation-store';
import { useAuth } from '@/lib/auth/use-auth';
import { deletionExecuteBlock } from '@/lib/domain/data-rights-rules';
import { parseProviderResult, preCheckVerdict } from '@/lib/domain/kyc-rules';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatDate, formatDateTime, formatEtb, formatInt, formatPercent, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { ReasonDialog } from '@/components/ui/confirm';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { DiffView } from '@/components/ui/json';
import { IdChip, Initials, PageHeader } from '@/components/ui/page';
import { Tabs, TabsContent, TabsUnderline, TabsUnderlineTrigger, Tooltip } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/stat';
import { FlagsTable, LedgerTable, UserWithdrawalsTable } from './user-tables';

type Action = 'suspend' | 'ban' | 'reinstate' | 'impersonate';

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
  const impersonation = useImpersonation();
  const viewingThisUser = impersonation.status === 'active' && impersonation.session.user.id === userId;

  const moderate = useMutation({
    mutationFn: ({ kind, reason }: { kind: Exclude<Action, 'impersonate'>; reason: string }) =>
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

  const impersonate = useMutation({
    mutationFn: (reason: string) => usersApi.impersonate(userId, reason),
    onSuccess: (res, reason) => {
      // Token stays in memory only (impersonationStore); nothing is persisted.
      impersonationStore.start(res, reason);
      void queryClient.removeQueries({ queryKey: ['view-as', userId] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      toast.success('Read-only session started', { description: `Viewing as ${res.user.phoneNumber} for ${Math.round(res.expiresIn / 60)} minutes. Every request is audited.` });
      setAction(null);
      navigate(`/users/${userId}/view-as`);
    },
    onError: (err) => toast.error('Could not start impersonation', { description: describeError(err) }),
  });

  const u = user.data;
  const canModerate = can('usersModerate');
  const canImpersonate = can('impersonate');

  if (user.isError) return <ErrorState error={user.error} onRetry={() => void user.refetch()} title="Could not load this user" />;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: 'Users', to: '/users' }, { label: u?.phoneNumber ?? '…' }]}
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
        description={u?.statusReason ? <span className="text-danger">Status reason: {u.statusReason}</span> : u ? `Joined ${formatDate(u.createdAt)} · last login ${formatDateTime(u.lastLoginAt)}` : undefined}
        actions={
          u ? (
            <>
              {canImpersonate && u.status !== 'deleted' ? (
                viewingThisUser ? (
                  <Button variant="secondary" onClick={() => navigate(`/users/${userId}/view-as`)} data-testid="open-view-as">
                    <Eye className="size-4" /> Open “view as user”
                  </Button>
                ) : (
                  <Tooltip content="Issues a 10-minute read-only user token (audited). You will see the app exactly as the user does; nothing can be changed.">
                    <Button variant="outline" onClick={() => setAction('impersonate')} data-testid="impersonate">
                      <Eye className="size-4" /> Impersonate (read-only)
                    </Button>
                  </Tooltip>
                )
              ) : null}
              {canModerate ? (
                <>
                  {u.status !== 'active' && u.status !== 'deleted' ? (
                    <Button variant="success" onClick={() => setAction('reinstate')}>
                      <ShieldCheck className="size-4" /> Reinstate
                    </Button>
                  ) : null}
                  {u.status === 'active' ? (
                    <Button variant="outline" onClick={() => setAction('suspend')}>
                      <UserRoundX className="size-4 text-warning" /> Suspend
                    </Button>
                  ) : null}
                  {u.status !== 'banned' && u.status !== 'deleted' ? (
                    <Button variant="danger" onClick={() => setAction('ban')}>
                      <Ban className="size-4" /> Ban
                    </Button>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Trust score" value={u?.trustScore} loading={!u} icon={ShieldAlert} tone={u && u.trustScore < 40 ? 'danger' : u && u.trustScore < 60 ? 'warning' : 'success'} hint={u ? (u.trustScore < 20 ? 'Below feed threshold - sees no ads' : 'Recomputed from flags & history') : undefined} />
        <StatCard label="Coin balance" value={u?.coinBalance} loading={!u} icon={Wallet} tone="primary" hint={u ? `${formatEtb(u.coinBalance / 100)} · derived from ledger` : undefined} />
        <StatCard label="Valid completions" value={u?.stats.validCompletions} loading={!u} hint={u ? `${formatInt(u.stats.totalCompletions)} total · ${formatPercent(u.stats.totalCompletions ? (u.stats.flaggedCompletions + u.stats.rejectedCompletions) / u.stats.totalCompletions : 0)} filtered` : undefined} />
        <StatCard label="Total withdrawn" value={u ? Number(u.stats.totalWithdrawnEtb) : undefined} format={(v) => formatEtb(v)} loading={!u} hint={u ? `${formatCoins(u.stats.totalEarnedCoins)} coins earned lifetime` : undefined} />
        <StatCard label="Open flags" value={u?.openFlags} loading={!u} tone={u && u.openFlags > 0 ? 'danger' : 'default'} hint={u ? `${u.stats.distinctDevices} device${u.stats.distinctDevices === 1 ? '' : 's'} · ${u.stats.distinctIps} IP${u.stats.distinctIps === 1 ? '' : 's'}` : undefined} />
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
                      { label: 'Full name', value: u.fullName ?? '—' },
                      { label: 'Phone', value: u.phoneNumber, mono: true },
                      { label: 'Date of birth', value: u.dateOfBirth ? formatDate(u.dateOfBirth) : '—' },
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

              <KycCard user={u} canOpenKyc={can('kyc')} />
              <DeletionRequestCard user={u} canOpenQueue={can('deletionRequests')} />
              <ReferralStatsCard user={u} canOpenReferrals={can('referrals')} />
            </div>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          {u ? <LedgerTable entries={u.recentLedger} highlightId={highlight} /> : <Skeleton className="h-64 w-full" />}
          <p className="mt-2 text-xs text-fg-subtle">Most recent 20 entries. The cached balance ({u ? formatCoins(u.coinBalance) : '…'}) is derived from this append-only ledger.</p>
        </TabsContent>

        <TabsContent value="withdrawals" className="mt-4">
          {u ? <UserWithdrawalsTable rows={u.withdrawals} /> : <Skeleton className="h-64 w-full" />}
          {u && can('withdrawals') ? (
            <Link to={`/withdrawals?status=all&userId=${u.id}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
              Open in withdrawal queue →
            </Link>
          ) : null}
        </TabsContent>

        <TabsContent value="flags" className="mt-4">
          {u ? <FlagsTable rows={u.flags} onSelect={can('fraud') ? (f) => navigate(`/fraud/${f.id}`) : undefined} /> : <Skeleton className="h-64 w-full" />}
          {u && can('fraud') ? (
            <Link to={`/fraud?userId=${u.id}&resolved=all`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
              Open in fraud dashboard →
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
        <>
          <ReasonDialog
            open={action !== null && action !== 'impersonate'}
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
            onConfirm={(reason) => {
              if (action && action !== 'impersonate') moderate.mutate({ kind: action, reason });
            }}
          />
          <ReasonDialog
            open={action === 'impersonate'}
            onOpenChange={(o) => !o && setAction(null)}
            title={`View the app as ${u.fullName ?? u.phoneNumber}?`}
            description="A 10-minute READ-ONLY user token is issued and every request made with it is audited under your admin id. Give the support-ticket reference so the audit log explains why."
            confirmLabel="Start read-only session"
            reasonLabel="Reason / ticket reference"
            placeholder="e.g. TICKET-1042 - user reports missing reward"
            loading={impersonate.isPending}
            onConfirm={(reason) => impersonate.mutate(reason)}
          >
            <ul className="space-y-1 rounded-md border bg-sunken/50 px-3 py-2 text-xs text-fg-muted">
              <li>• The token never leaves this browser tab’s memory and expires on its own.</li>
              <li>• Only GET endpoints work: balance, ledger, feed, withdrawals, notifications. Any write returns 403.</li>
              <li>• A banner shows who you are viewing and the time left; end it any time.</li>
            </ul>
          </ReasonDialog>
        </>
      ) : null}
    </div>
  );
}

/* ----------------------------- Phase 4A cards ----------------------------- */

type UserDetail = AdminUser;

function KycCard({ user: u, canOpenKyc }: { user: UserDetail; canOpenKyc: boolean }) {
  const k = u.kyc;
  const provider = k ? parseProviderResult(k.providerResult) : null;
  const verdict = preCheckVerdict(provider);
  return (
    <Card data-testid="user-kyc-card">
      <CardHeader
        title="Identity (KYC)"
        description={u.kycTier === 'id_verified' ? 'Verified - no monthly payout cap.' : 'Phone-only accounts are capped per rolling 30 days until an id is approved.'}
        actions={
          <span className="flex items-center gap-1.5">
            <Badge tone={u.kycTier === 'id_verified' ? 'success' : 'outline'} className="gap-1">
              <IdCard className="size-3" /> {humanize(u.kycTier)}
            </Badge>
            {k && canOpenKyc ? (
              <Link to={`/kyc/${k.id}?status=${k.status}`} className="text-xs font-medium text-primary hover:underline">
                Open submission →
              </Link>
            ) : null}
          </span>
        }
      />
      <CardBody>
        {k ? (
          <DescriptionList
            items={[
              { label: 'Latest submission', value: <StatusBadge status={k.status} /> },
              { label: 'Submitted', value: <Tooltip content={formatDateTime(k.createdAt)}><span>{formatRelative(k.createdAt)}</span></Tooltip> },
              { label: 'Document', value: `${humanize(k.idType)} · •••• ${k.idNumberLast4}` },
              { label: 'Name on document', value: k.fullName },
              {
                label: 'Registry pre-check',
                value: provider ? (
                  <span className="inline-flex items-center gap-1">
                    <Badge tone={verdict === 'strong' ? 'success' : verdict === 'weak' ? 'warning' : 'danger'} size="sm">
                      {verdict === 'not_found' ? 'not found' : verdict === 'error' ? 'error' : formatPercent(provider.score, 0)}
                    </Badge>
                    {provider.mock ? (
                      <Badge tone="warning" size="sm">
                        MOCK
                      </Badge>
                    ) : null}
                  </span>
                ) : (
                  '—'
                ),
              },
              { label: k.status === 'rejected' ? 'Rejection reason' : 'Reviewed', value: k.status === 'rejected' ? <span className="text-danger">{k.reason ?? '—'}</span> : formatDateTime(k.reviewedAt) },
            ]}
          />
        ) : (
          <p className="text-xs text-fg-muted">No identity documents submitted yet.</p>
        )}
      </CardBody>
    </Card>
  );
}

function DeletionRequestCard({ user: u, canOpenQueue }: { user: UserDetail; canOpenQueue: boolean }) {
  const d = u.deletionRequest;
  return (
    <Card data-testid="user-deletion-card">
      <CardHeader
        title="Account deletion"
        description={d ? `Requested ${formatRelative(d.requestedAt)} · ${d.graceDays}-day grace period.` : u.status === 'deleted' ? 'This account was anonymised.' : 'No pending deletion request.'}
        actions={
          d && canOpenQueue ? (
            <Link to="/deletion-requests?status=pending" className="text-xs font-medium text-primary hover:underline">
              Open queue →
            </Link>
          ) : null
        }
      />
      {d ? (
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Status', value: <StatusBadge status={d.status} /> },
              {
                label: 'Scheduled for',
                value: (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="size-3 text-fg-subtle" /> {formatDateTime(d.scheduledFor)}
                  </span>
                ),
              },
              { label: 'Reason given', value: d.reason ?? '—', span: 2 },
              {
                label: 'Execution',
                span: 2,
                value: (() => {
                  const pendingWithdrawals = u.withdrawals.filter((w) => w.status === 'pending' || w.status === 'processing' || w.status === 'flagged_for_review').length;
                  const block = deletionExecuteBlock({ status: d.status, pendingWithdrawals });
                  return block ? <span className="text-xs text-warning">{block}</span> : <span className="text-xs text-fg-muted">Can be executed early from the deletion queue; the ledger and audit trail are kept.</span>;
                })(),
              },
            ]}
          />
        </CardBody>
      ) : null}
    </Card>
  );
}

function ReferralStatsCard({ user: u, canOpenReferrals }: { user: UserDetail; canOpenReferrals: boolean }) {
  const r = u.referralStats;
  return (
    <Card data-testid="user-referrals-card">
      <CardHeader
        title="Referrals"
        description={u.referralCode ? <>Invite code <span className="font-mono text-fg">{u.referralCode}</span></> : 'No invite code yet.'}
        actions={
          canOpenReferrals ? (
            <Link to={`/referrals?referrerId=${u.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Gift className="size-3" /> Referrals →
            </Link>
          ) : null
        }
      />
      <CardBody>
        <DescriptionList
          columns={3}
          items={[
            { label: 'Invited', value: <span className="tabular text-lg font-semibold">{formatInt(r.referred)}</span> },
            { label: 'Paid', value: <span className="tabular text-lg font-semibold text-success">{formatInt(r.paid)}</span> },
            { label: 'Bonus earned', value: <span className="tabular text-lg font-semibold">{formatCoins(r.bonusCoinsEarned)}</span> },
          ]}
        />
      </CardBody>
    </Card>
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
              { label: 'Registered device id', value: deviceId ?? '—', mono: true },
              { label: 'Last IP', value: lastIp ?? '—', mono: true },
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
                            {id.slice(0, 8)}…
                          </Link>
                        ))}
                    </div>
                  ) : null}
                  <Link to={`/fraud/${f.id}`} className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline">
                    Open flag →
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
                {humanize(r.actorType)} {r.actorEmail ?? (r.actorId === userId ? 'this user' : r.actorId?.slice(0, 8) ?? 'system')} → {humanize(r.targetType)} {r.targetId?.slice(0, 8)}
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
          Open in audit log viewer →
        </Link>
      </div>
    </Card>
  );
}
