import type { AdFeedItem, LedgerEntry, NotificationItem, WithdrawalItem } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, Bell, Eye, EyeOff, Lock, Play, Wallet } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { viewAsUserApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import { formatCountdown, impersonationStore, useImpersonation, useImpersonationCountdown } from '@/lib/auth/impersonation-store';
import { cn } from '@/lib/utils/cn';
import { formatCoins, formatDate, formatDateTime, formatDuration, formatEtb, formatInt, formatRelative, humanize } from '@/lib/utils/format';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { JsonView } from '@/components/ui/json';
import { IdChip, Initials, PageHeader } from '@/components/ui/page';
import { Tabs, TabsContent, TabsUnderline, TabsUnderlineTrigger } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/stat';

const TABS = [
  { value: 'profile', label: 'Profile' },
  { value: 'balance', label: 'Balance & ledger' },
  { value: 'feed', label: 'Ad feed' },
  { value: 'withdrawals', label: 'Withdrawals' },
  { value: 'notifications', label: 'Notifications' },
] as const;

/**
 * "View as user": the admin sees what the user's app sees, through a short-lived READ-ONLY token that is kept in
 * memory only. Every request here is a GET; there are deliberately no buttons that could mutate anything, and a
 * 403 IMPERSONATION_READ_ONLY (should one slip through) is rendered as a friendly message.
 */
export function ViewAsUserPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === searchParams.get('tab')) ? (searchParams.get('tab') as (typeof TABS)[number]['value']) : 'profile';
  const state = useImpersonation();
  const remaining = useImpersonationCountdown();
  const session = state.status === 'active' && state.session.user.id === userId ? state.session : null;

  // The banner navigates away on expiry; this covers a direct reload of the URL with no session in memory.
  useEffect(() => {
    if (state.status === 'expired' && state.session?.user.id === userId) navigate(`/users/${userId}`, { replace: true });
  }, [state, userId, navigate]);

  if (!session) {
    return (
      <div className="space-y-4">
        <PageHeader crumbs={[{ label: 'Users', to: '/users' }, { label: 'View as user' }]} title="View as user" />
        <EmptyState
          icon={EyeOff}
          title="No active impersonation session"
          description="Impersonation tokens live only in this tab's memory and last 10 minutes. Start a new read-only session from the user's page (support and super admins)."
          action={
            <Button variant="outline" onClick={() => navigate(`/users/${userId}`)}>
              <ArrowLeft className="size-4" /> Back to the user
            </Button>
          }
        />
      </div>
    );
  }

  const { user, token } = session;
  return (
    <div className="space-y-4" data-testid="view-as-panel">
      <PageHeader
        crumbs={[{ label: 'Users', to: '/users' }, { label: user.phoneNumber, to: `/users/${user.id}` }, { label: 'View as user' }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Initials name={user.fullName} className="size-9 text-sm" />
            <span>
              {user.fullName ?? <span className="text-fg-subtle">Unnamed user</span>}
              <span className="ml-2 font-mono text-sm font-normal text-fg-muted">{user.phoneNumber}</span>
            </span>
            <Badge tone="warning" className="gap-1">
              <Lock className="size-3" /> read-only · {formatCountdown(remaining)}
            </Badge>
          </span>
        }
        description={`What this user's app shows right now, fetched with a read-only token issued for “${session.reason}”. Nothing here can change the account.`}
        actions={
          <>
            <Link to={`/users/${user.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
              <ArrowLeft className="size-4" /> Admin view
            </Link>
            <Button variant="outline" onClick={() => impersonationStore.end()}>
              <EyeOff className="size-4" /> End session
            </Button>
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) =>
          setSearchParams(
            (p) => {
              const n = new URLSearchParams(p);
              n.set('tab', v);
              return n;
            },
            { replace: true },
          )
        }
      >
        <TabsUnderline>
          {TABS.map((t) => (
            <TabsUnderlineTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsUnderlineTrigger>
          ))}
        </TabsUnderline>
        <TabsContent value="profile" className="mt-4">
          <ProfileTab userId={user.id} token={token} />
        </TabsContent>
        <TabsContent value="balance" className="mt-4">
          <BalanceTab userId={user.id} token={token} />
        </TabsContent>
        <TabsContent value="feed" className="mt-4">
          <FeedTab userId={user.id} token={token} />
        </TabsContent>
        <TabsContent value="withdrawals" className="mt-4">
          <WithdrawalsTab userId={user.id} token={token} />
        </TabsContent>
        <TabsContent value="notifications" className="mt-4">
          <NotificationsTab userId={user.id} token={token} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------ data hook ------------------------------ */

function useViewAs<T>(userId: string, resource: string, fn: () => Promise<T>, params: object = {}) {
  const query = useQuery({
    queryKey: queryKeys.viewAs(userId, resource, params),
    queryFn: fn,
    retry: false,
    gcTime: 0,
    staleTime: 15_000,
  });
  // The token is not refreshable: any 401 means the 10 minutes are up.
  useEffect(() => {
    if (query.error && isApiError(query.error) && query.error.status === 401) impersonationStore.markExpired();
  }, [query.error]);
  return query;
}

function ReadOnlyError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const readOnly = isApiError(error) && error.code === 'IMPERSONATION_READ_ONLY';
  return <ErrorState compact error={error} title={readOnly ? 'Blocked: read-only session' : 'Could not load this view'} onRetry={readOnly ? undefined : onRetry} />;
}

/* -------------------------------- tabs -------------------------------- */

function ProfileTab({ userId, token }: { userId: string; token: string }) {
  const q = useViewAs(userId, 'profile', () => viewAsUserApi.profile(token));
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <ReadOnlyError error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Profile as the app sees it" description="GET /users/me with the impersonation token." actions={<Eye className="size-4 text-fg-subtle" />} />
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Full name', value: p.fullName ?? '—' },
              { label: 'Phone', value: p.phoneNumber, mono: true },
              { label: 'Status', value: <StatusBadge status={p.status} /> },
              { label: 'KYC tier', value: <Badge tone={p.kycTier === 'id_verified' ? 'success' : 'neutral'}>{humanize(p.kycTier)}</Badge> },
              { label: 'Date of birth', value: p.dateOfBirth ? formatDate(p.dateOfBirth) : '—' },
              { label: 'Ethiopian DOB', value: p.dateOfBirthEthiopian ? `${p.dateOfBirthEthiopian.day}/${p.dateOfBirthEthiopian.month}/${p.dateOfBirthEthiopian.year} (EC)` : '—' },
              { label: 'Language', value: humanize(p.languagePreference) },
              { label: 'Trust score', value: <span className="tabular font-medium">{p.trustScore}</span> },
              { label: 'Referral code', value: p.referralCode ?? '—', mono: true },
              { label: 'Profile complete', value: p.profileComplete ? 'Yes' : 'No' },
              { label: 'Joined', value: formatDateTime(p.createdAt) },
              { label: 'User id', value: <IdChip id={p.id} length={36} />, span: 2 },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Consent state" description={p.requiresConsent.length ? `App is blocked until ${p.requiresConsent.join(', ')} are accepted.` : 'All current legal documents are accepted.'} />
        {p.consents.length ? (
          <ul className="divide-y">
            {p.consents.map((c) => (
              <li key={c.kind} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div>
                  <div className="font-medium">{humanize(c.kind)}</div>
                  <div className="text-xs text-fg-subtle">
                    accepted {c.acceptedVersion ?? '—'} · current {c.currentVersion ?? '—'} {c.acceptedAt ? `· ${formatRelative(c.acceptedAt)}` : ''}
                  </div>
                </div>
                <Badge tone={c.outdated || !c.acceptedVersion ? 'warning' : 'success'}>{!c.acceptedVersion ? 'missing' : c.outdated ? 'outdated' : 'current'}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title="No consent records" />
        )}
        <div className="border-t px-4 py-2 text-xs text-fg-subtle">
          Notifications: {Object.entries(p.notificationPrefs).filter(([, v]) => v).map(([k]) => k).join(', ') || 'all off'}
        </div>
      </Card>
    </div>
  );
}

function BalanceTab({ userId, token }: { userId: string; token: string }) {
  const balance = useViewAs(userId, 'balance', () => viewAsUserApi.balance(token));
  const ledger = useViewAs(userId, 'ledger', () => viewAsUserApi.ledger(token, { limit: 50 }), { limit: 50 });
  const b = balance.data;
  const columns = useMemo<ColumnDef<LedgerEntry, unknown>[]>(
    () => [
      { id: 'when', header: 'When', cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs text-fg-muted">{formatDateTime(row.original.createdAt)}</span>, size: 150 },
      { id: 'source', header: 'Source', cell: ({ row }) => <Badge tone="neutral">{humanize(row.original.sourceType)}</Badge>, size: 150 },
      { id: 'desc', header: 'Description', cell: ({ row }) => <span className="text-xs text-fg-muted">{row.original.description ?? '—'}</span> },
      {
        id: 'amount',
        header: 'Coins',
        meta: { align: 'right', numeric: true },
        cell: ({ row }) => <span className={cn('font-medium', row.original.amount < 0 ? 'text-danger' : 'text-success')}>{row.original.amount > 0 ? '+' : ''}{formatCoins(row.original.amount)}</span>,
        size: 110,
      },
      { id: 'after', header: 'Balance after', meta: { align: 'right', numeric: true }, cell: ({ row }) => formatCoins(row.original.balanceAfter), size: 120 },
    ],
    [],
  );
  return (
    <div className="space-y-4">
      {balance.isError ? (
        <ReadOnlyError error={balance.error} onRetry={() => void balance.refetch()} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Coin balance" value={b?.coinBalance} loading={!b} icon={Wallet} tone="primary" hint={b ? `${formatEtb(b.etbEquivalent)} · ${b.coinsPerEtb} coins = ETB 1` : undefined} />
          <StatCard label="Ledger entries" value={b?.ledgerChecksum.entries} loading={!b} hint={b ? `ledger sum ${formatCoins(b.ledgerChecksum.ledgerSum)}` : undefined} />
          <StatCard
            label="Ledger consistency"
            value={b ? (b.ledgerChecksum.consistent ? 1 : 0) : undefined}
            format={(v) => (v ? 'OK' : 'DRIFT')}
            loading={!b}
            tone={b && !b.ledgerChecksum.consistent ? 'danger' : 'success'}
            hint={b?.conversionNote}
          />
        </div>
      )}
      <Card>
        <CardHeader title="Ledger (as shown in the app)" description="Newest first · latest 50 entries." />
        <DataTable columns={columns} data={ledger.data?.data} getRowId={(r) => r.id} isLoading={ledger.isPending} error={ledger.error} onRetry={() => void ledger.refetch()} className="rounded-t-none border-0 shadow-none" aria-label="User ledger" />
      </Card>
    </div>
  );
}

function FeedTab({ userId, token }: { userId: string; token: string }) {
  const feed = useViewAs(userId, 'feed', () => viewAsUserApi.feed(token, { limit: 20 }), { limit: 20 });
  if (feed.isPending) return <Skeleton className="h-64 w-full" />;
  if (feed.isError) return <ReadOnlyError error={feed.error} onRetry={() => void feed.refetch()} />;
  const meta = feed.data.meta;
  const ads: AdFeedItem[] = feed.data.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <Badge tone="primary" className="tabular">
          {formatInt(meta.dailyRemaining)} of {formatInt(meta.dailyLimit)} completions left today
        </Badge>
        <Badge tone="neutral" className="tabular">
          {formatInt(meta.dailyCompleted)} completed
        </Badge>
        {meta.hiddenByFrequencyCap > 0 ? (
          <Badge tone="warning" className="tabular">
            {formatInt(meta.hiddenByFrequencyCap)} hidden by frequency caps
          </Badge>
        ) : null}
        <span>· {formatInt(meta.total)} ads eligible</span>
      </div>
      {ads.length === 0 ? (
        <EmptyState compact icon={Play} title="Empty feed" description={meta.dailyRemaining === 0 ? 'Daily limit reached - the app shows “come back tomorrow”.' : meta.hiddenByFrequencyCap > 0 ? 'Every eligible ad is hidden by a campaign / advertiser frequency cap today.' : 'No approved, ready ads target this user right now (trust score or status may exclude them).'} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ads.map((ad) => (
            <li key={ad.id} className="overflow-hidden rounded-lg border bg-surface shadow-card">
              <div className="relative aspect-video bg-stone-900">
                {ad.thumbnailUrl ? <img src={ad.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Play className="absolute inset-0 m-auto size-6 text-stone-500" />}
                <span className="absolute right-1.5 bottom-1.5 rounded bg-stone-950/80 px-1 font-mono text-2xs text-stone-100 tabular">{formatDuration(ad.durationSeconds)}</span>
              </div>
              <div className="p-3">
                <div className="truncate text-sm font-medium">{ad.title}</div>
                <div className="truncate text-xs text-fg-muted">{ad.advertiserName}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-2xs text-fg-subtle">
                  <Badge tone="success" size="sm" className="tabular">
                    +{formatCoins(ad.rewardCoins)} coins
                  </Badge>
                  <span>{humanize(ad.targetActionType)}</span>
                  {ad.hasAttentionCheck ? <span>· attention check</span> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-subtle">Read-only: watch sessions cannot be started from here (any POST with this token returns 403 IMPERSONATION_READ_ONLY).</p>
    </div>
  );
}

function WithdrawalsTab({ userId, token }: { userId: string; token: string }) {
  const q = useViewAs(userId, 'withdrawals', () => viewAsUserApi.withdrawals(token, { limit: 50 }), { limit: 50 });
  const columns = useMemo<ColumnDef<WithdrawalItem, unknown>[]>(
    () => [
      { id: 'requested', header: 'Requested', cell: ({ row }) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(row.original.requestedAt)}</span>, size: 150 },
      { id: 'amount', header: 'Amount', meta: { align: 'right', numeric: true }, cell: ({ row }) => <span className="font-medium">{formatEtb(row.original.amountEtb)}</span>, size: 120 },
      {
        id: 'method',
        header: 'Destination (masked)',
        cell: ({ row }) => (
          <div>
            <div>{humanize(row.original.payoutMethod)}</div>
            <div className="font-mono text-2xs text-fg-subtle">
              {row.original.payoutDestination}
              {row.original.destinationAccountName ? ` · ${row.original.destinationAccountName}` : ''}
            </div>
          </div>
        ),
      },
      { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} />, size: 150 },
      { id: 'note', header: 'Note', cell: ({ row }) => <span className="text-xs text-fg-muted">{row.original.failureReason ?? (row.original.reviewReasons.length ? row.original.reviewReasons.map(humanize).join(', ') : '—')}</span> },
    ],
    [],
  );
  return (
    <DataTable
      columns={columns}
      data={q.data?.data}
      getRowId={(r) => r.id}
      isLoading={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
      emptyState={<EmptyState compact title="No withdrawals" description="The user has not requested a payout yet." />}
      aria-label="User withdrawals (read-only)"
    />
  );
}

function NotificationsTab({ userId, token }: { userId: string; token: string }) {
  const q = useViewAs(userId, 'notifications', () => viewAsUserApi.notifications(token, { limit: 50 }), { limit: 50 });
  if (q.isPending) return <Skeleton className="h-64 w-full" />;
  if (q.isError) return <ReadOnlyError error={q.error} onRetry={() => void q.refetch()} />;
  const items: NotificationItem[] = q.data.data;
  if (!items.length) return <EmptyState compact icon={Bell} title="No notifications" />;
  return (
    <Card>
      <ul className="divide-y">
        {items.map((n) => (
          <li key={n.id} className={cn('px-4 py-3 text-sm', !n.readAt && 'bg-primary-soft/40')}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{n.title}</span>
              <Badge tone="neutral" size="sm">
                {humanize(n.type)}
              </Badge>
              {!n.readAt ? (
                <Badge tone="primary" size="sm">
                  unread
                </Badge>
              ) : null}
              <span className="ml-auto text-xs text-fg-subtle">{formatDateTime(n.createdAt)}</span>
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">{n.body}</p>
            {n.data ? (
              <details className="mt-1 text-2xs text-fg-subtle">
                <summary className="cursor-pointer">payload</summary>
                <JsonView value={n.data} maxHeight={140} className="mt-1" />
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="border-t px-4 py-2 text-xs text-fg-subtle">Marking as read is a write action and is not available in a read-only session.</div>
    </Card>
  );
}
