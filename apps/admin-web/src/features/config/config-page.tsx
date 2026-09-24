import { PLATFORM_DEFAULTS } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Info, Settings2 } from 'lucide-react';
import { homeApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils/cn';
import { formatEtb, formatInt, formatPercent } from '@/lib/utils/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page';

interface Row {
  label: string;
  value: string;
  fallback?: string;
  note?: string;
}

function ConfigTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y">
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="py-2 pr-4 text-fg-muted">
              {r.label}
              {r.note ? <div className="text-2xs text-fg-subtle">{r.note}</div> : null}
            </td>
            <td className="py-2 text-right tabular font-medium">
              {r.value}
              {r.fallback !== undefined && r.fallback !== r.value ? <div className="text-2xs font-normal text-fg-subtle">default {r.fallback}</div> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ConfigPage() {
  const q = useQuery({ queryKey: queryKeys.config, queryFn: homeApi.config, staleTime: 60_000 });
  const c = q.data;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load configuration" />;

  const mocks = c ? Object.entries(c.mocks) : [];
  const anyMock = mocks.some(([, v]) => v);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Platform configuration"
        description="Effective values the API is running with. Read-only - change them through environment variables on the API and restart."
        actions={
          c ? (
            <Badge tone="outline" className="font-mono">
              {c.environment} · v{c.version}
            </Badge>
          ) : null
        }
      />

      <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3', anyMock ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10')}>
        <FlaskConical className={cn('mt-0.5 size-4 shrink-0', anyMock ? 'text-warning' : 'text-success')} />
        <div className="text-sm">
          <div className="font-medium">{anyMock ? 'Some providers are mocked' : 'All providers are live'}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {c
              ? mocks.map(([k, v]) => (
                  <Badge key={k} tone={v ? 'warning' : 'success'} dot>
                    {k === 'sms' ? 'SMS / OTP' : k === 'payouts' ? 'Payouts (telebirr, Chapa)' : k === 'paymentGateway' ? 'Payment gateway (Chapa)' : 'Push (FCM)'} · {v ? 'mock' : 'live'}
                  </Badge>
                ))
              : null}
          </div>
          {anyMock ? <p className="mt-1.5 text-xs text-fg-muted">Mocked payouts simulate async processing with a deterministic failure rate; OTPs are echoed in API responses. Nothing leaves this environment.</p> : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Economics" actions={<Settings2 className="size-4 text-fg-subtle" />} />
          <CardBody>
            {c ? (
              <ConfigTable
                rows={[
                  { label: 'Coins per ETB', value: formatInt(c.coinsPerEtb), fallback: formatInt(PLATFORM_DEFAULTS.COINS_PER_ETB) },
                  { label: 'Platform take rate', value: formatPercent(c.platformTakeRate, 0), fallback: formatPercent(PLATFORM_DEFAULTS.PLATFORM_TAKE_RATE, 0), note: 'User reward = cost × (1 − rate)' },
                  { label: 'Minimum withdrawal', value: formatEtb(c.minWithdrawalEtb), fallback: formatEtb(PLATFORM_DEFAULTS.MIN_WITHDRAWAL_ETB) },
                  { label: 'Large-withdrawal threshold', value: formatEtb(c.largeWithdrawalThresholdEtb), fallback: formatEtb(PLATFORM_DEFAULTS.LARGE_WITHDRAWAL_THRESHOLD_ETB), note: 'Requires two distinct approvers' },
                  { label: 'Withdrawal requests / day', value: formatInt(c.dailyWithdrawalRequestLimit), fallback: formatInt(PLATFORM_DEFAULTS.DAILY_WITHDRAWAL_REQUEST_LIMIT) },
                ]}
              />
            ) : (
              <Skeleton className="h-48 w-full" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ad completion rules" />
          <CardBody>
            {c ? (
              <ConfigTable
                rows={[
                  { label: 'Completions per user / day', value: formatInt(c.dailyAdCompletionLimit), fallback: formatInt(PLATFORM_DEFAULTS.DAILY_AD_COMPLETION_LIMIT) },
                  { label: 'Minimum watch ratio', value: formatPercent(c.minWatchRatio, 0), fallback: formatPercent(PLATFORM_DEFAULTS.MIN_WATCH_RATIO, 0), note: 'Server-timed share of the ad duration' },
                  { label: 'Heartbeat interval', value: `${c.heartbeatIntervalSeconds}s`, fallback: `${PLATFORM_DEFAULTS.HEARTBEAT_INTERVAL_SECONDS}s` },
                  { label: 'Watch attempts per ad / day', value: formatInt(c.maxWatchAttemptsPerAdPerDay), fallback: formatInt(PLATFORM_DEFAULTS.MAX_WATCH_ATTEMPTS_PER_AD_PER_DAY) },
                  { label: 'Minimum age', value: `${c.minAge}`, fallback: `${PLATFORM_DEFAULTS.MIN_AGE}`, note: 'Computed server-side from date of birth' },
                ]}
              />
            ) : (
              <Skeleton className="h-48 w-full" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Fraud engine" />
          <CardBody>
            {c ? (
              <ConfigTable
                rows={[
                  { label: 'Flag threshold', value: `${c.fraud.flagThreshold}`, note: 'Score ≥ this → completion flagged, not credited' },
                  { label: 'Reject threshold', value: `${c.fraud.rejectThreshold}`, note: 'Score ≥ this → completion rejected' },
                  { label: 'Min trust score for feed', value: `${c.fraud.minTrustScoreForFeed}`, note: 'Users below see an empty feed' },
                ]}
              />
            ) : (
              <Skeleton className="h-32 w-full" />
            )}
            <div className="mt-4 flex items-start gap-2 rounded-md bg-sunken/60 px-3 py-2 text-xs text-fg-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This console talks to <span className="font-mono text-fg">{env.apiBaseUrl}</span>. Values marked “default” differ from the <span className="font-mono">@rap/shared</span> fallback constants.
              </span>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
