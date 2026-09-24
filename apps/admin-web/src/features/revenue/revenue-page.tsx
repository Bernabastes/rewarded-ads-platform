import type { RevenueOverview } from '@rap/shared';
import { useQuery } from '@tanstack/react-query';
import { Download, Landmark, PiggyBank, Receipt, TrendingUp, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { revenueApi } from '@/lib/api/endpoints';
import { queryKeys } from '@/lib/api/query-keys';
import { useListParams } from '@/lib/hooks/use-list-params';
import { downloadCsv, toCsv } from '@/lib/utils/csv';
import { daysAgo, formatEtb, formatEtbBare, formatInt, formatPercent, formatShortDate, humanize, toIsoDate, toNumber } from '@/lib/utils/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input, Label } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { StatCard } from '@/components/ui/stat';
import { CHART_COLORS, ChartTooltip } from '@/features/fraud/fraud-charts';

const PRESETS = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
];

const defaults = { from: '' as string, to: '' as string };
const etbFmt = (v: number) => `ETB ${formatEtbBare(v)}`;

export function RevenuePage() {
  const { params, set } = useListParams(defaults);
  const to = params.to || toIsoDate(new Date());
  const from = params.from || toIsoDate(daysAgo(29));
  const preset = useMemo(() => PRESETS.find((p) => from === toIsoDate(daysAgo(p.days - 1)) && to === toIsoDate(new Date()))?.key ?? 'custom', [from, to]);

  const q = useQuery({ queryKey: queryKeys.revenue({ from, to }), queryFn: () => revenueApi.overview({ from, to: `${to}T23:59:59.999Z` }), placeholderData: (p) => p });
  const r = q.data;
  const t = r?.totals;

  const daily = useMemo(
    () =>
      (r?.daily ?? []).map((d) => ({
        date: d.date,
        spend: toNumber(d.advertiserSpendEtb),
        rewards: toNumber(d.userRewardsEtb),
        revenue: toNumber(d.platformRevenueEtb),
        payouts: toNumber(d.payoutsEtb),
        topups: toNumber(d.topupsEtb),
      })),
    [r],
  );
  const hasActivity = daily.some((d) => d.spend > 0 || d.payouts > 0 || d.topups > 0);

  const exportCsv = () => {
    if (!r) return;
    const csv = toCsv(daily, [
      { header: 'date', value: (d) => d.date },
      { header: 'advertiser_spend_etb', value: (d) => d.spend.toFixed(2) },
      { header: 'user_rewards_etb', value: (d) => d.rewards.toFixed(2) },
      { header: 'platform_revenue_etb', value: (d) => d.revenue.toFixed(2) },
      { header: 'payouts_completed_etb', value: (d) => d.payouts.toFixed(2) },
      { header: 'topups_etb', value: (d) => d.topups.toFixed(2) },
    ]);
    downloadCsv(`gize-revenue-${from}_${to}.csv`, csv);
  };
  const exportAdvertisers = () => {
    if (!r) return;
    downloadCsv(
      `gize-advertiser-spend-${from}_${to}.csv`,
      toCsv(r.byAdvertiser, [
        { header: 'advertiser_id', value: (a) => a.advertiserId },
        { header: 'business_name', value: (a) => a.businessName },
        { header: 'spend_etb', value: (a) => toNumber(a.spendEtb).toFixed(2) },
        { header: 'valid_completions', value: (a) => a.validCompletions },
        { header: 'share', value: (a) => toNumber(a.share).toFixed(4) },
      ]),
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Revenue"
        description="Platform revenue = advertiser spend on valid actions − user rewards. Payouts and top-ups are cash movements, not revenue."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportAdvertisers} disabled={!r}>
              <Download className="size-3.5" /> Advertisers CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!r}>
              <Download className="size-3.5" /> Daily CSV
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Tabs value={preset} onValueChange={(v) => v !== 'custom' && set({ from: toIsoDate(daysAgo(Number(v) - 1)), to: toIsoDate(new Date()) })}>
            <TabsList>
              {PRESETS.map((p) => (
                <TabsTrigger key={p.key} value={p.key}>
                  {p.label}
                </TabsTrigger>
              ))}
              <TabsTrigger value="custom" disabled>
                Custom
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div>
            <Label htmlFor="rev-from" className="mb-1">
              From (UTC)
            </Label>
            <Input id="rev-from" type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value, to })} className="w-40 tabular" />
          </div>
          <div>
            <Label htmlFor="rev-to" className="mb-1">
              To (UTC)
            </Label>
            <Input id="rev-to" type="date" value={to} min={from} max={toIsoDate(new Date())} onChange={(e) => e.target.value && set({ from, to: e.target.value })} className="w-40 tabular" />
          </div>
        </div>
      </PageHeader>

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Platform revenue" value={t ? toNumber(t.platformRevenueEtb) : undefined} format={etbFmt} loading={!t} icon={TrendingUp} tone="primary" hint={t ? `${formatPercent(toNumber(t.takeRate), 0)} take rate on ${formatInt(t.validCompletions)} valid actions` : undefined} />
        <StatCard label="Advertiser spend" value={t ? toNumber(t.advertiserSpendEtb) : undefined} format={etbFmt} loading={!t} icon={Receipt} hint={t ? `${formatEtb(t.userRewardsEtb)} passed to users as rewards` : undefined} />
        <StatCard label="Payouts completed" value={t ? toNumber(t.payoutsCompletedEtb) : undefined} format={etbFmt} loading={!t} icon={Landmark} tone="accent" hint={t ? `${formatEtb(t.payoutsPendingEtb)} pending / processing / held` : undefined} />
        <StatCard label="Advertiser top-ups" value={t ? toNumber(t.topupsEtb) : undefined} format={etbFmt} loading={!t} icon={Wallet} tone="info" hint="Completed wallet payments in range" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue over time" description="Daily advertiser spend, user rewards and platform revenue." />
          <CardBody className="h-64 p-2 pr-4">
            {!r ? (
              <Skeleton className="h-full w-full" />
            ) : !hasActivity ? (
              <EmptyState compact title="No activity in this range" description="Pick a wider range or wait for campaigns to run." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(v: number) => formatInt(v)} width={48} />
                  <Tooltip content={<ChartTooltip labelFormatter={formatShortDate} formatter={etbFmt} />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={(v) => humanize(String(v))} />
                  <Area type="monotone" dataKey="spend" stroke={CHART_COLORS.muted} fill="transparent" strokeDasharray="4 3" />
                  <Area type="monotone" dataKey="rewards" stroke={CHART_COLORS.accent} fill="transparent" />
                  <Area type="monotone" dataKey="revenue" stroke={CHART_COLORS.primary} fill="url(#gRev)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Take rate" description="Where each birr of advertiser spend goes." />
          <CardBody className="h-64 p-2">{t ? <TakeRateDonut totals={t} /> : <Skeleton className="h-full w-full" />}</CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top advertisers by spend" description="Valid-action spend in the selected range." />
          {!r ? (
            <CardBody>
              <Skeleton className="h-48 w-full" />
            </CardBody>
          ) : r.byAdvertiser.length === 0 ? (
            <EmptyState compact title="No advertiser spend" />
          ) : (
            <ul className="divide-y">
              {r.byAdvertiser.slice(0, 10).map((a, i) => (
                <li key={a.advertiserId} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-4 text-right font-mono text-xs text-fg-subtle">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link to={`/advertisers/${a.advertiserId}`} className="block truncate font-medium hover:text-primary hover:underline">
                      {a.businessName}
                    </Link>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, toNumber(a.share) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular font-medium">ETB {formatEtbBare(a.spendEtb)}</div>
                    <div className="text-2xs text-fg-subtle">
                      {formatInt(a.validCompletions)} actions · {formatPercent(toNumber(a.share), 0)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Spend by action type" />
          <CardBody className="h-64 p-2 pr-4">
            {!r ? (
              <Skeleton className="h-full w-full" />
            ) : r.byActionType.length === 0 ? (
              <EmptyState compact title="No spend recorded" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r.byActionType.map((b) => ({ ...b, spendEtb: toNumber(b.spendEtb) }))} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap="35%">
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="targetActionType" tickFormatter={(v: string) => humanize(v)} tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatInt(v)} />
                  <Tooltip content={<ChartTooltip formatter={(v, name) => (name === 'spendEtb' ? etbFmt(v) : formatInt(v))} labelFormatter={humanize} />} />
                  <Bar dataKey="spendEtb" name="spend" fill={CHART_COLORS.primary} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="validCompletions" name="valid completions" fill={CHART_COLORS.primarySoft} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Daily breakdown"
          description={r ? `${formatShortDate(r.from)} → ${formatShortDate(r.to)} · ${daily.length} days` : undefined}
          actions={
            t ? (
              <Badge tone="outline" className="tabular">
                Σ revenue ETB {formatEtbBare(t.platformRevenueEtb)}
              </Badge>
            ) : null
          }
        />
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-2xs font-semibold tracking-wider text-fg-subtle uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-right">Spend</th>
                <th className="px-4 py-2 text-right">Rewards</th>
                <th className="px-4 py-2 text-right">Revenue</th>
                <th className="px-4 py-2 text-right">Payouts</th>
                <th className="px-4 py-2 text-right">Top-ups</th>
              </tr>
            </thead>
            <tbody className="divide-y tabular">
              {daily
                .slice()
                .reverse()
                .map((d) => (
                  <tr key={d.date} className={d.spend === 0 && d.payouts === 0 && d.topups === 0 ? 'text-fg-subtle' : ''}>
                    <td className="px-4 py-1.5 font-mono text-xs">{d.date}</td>
                    <td className="px-4 py-1.5 text-right">{formatEtbBare(d.spend)}</td>
                    <td className="px-4 py-1.5 text-right">{formatEtbBare(d.rewards)}</td>
                    <td className="px-4 py-1.5 text-right font-medium">{formatEtbBare(d.revenue)}</td>
                    <td className="px-4 py-1.5 text-right">{formatEtbBare(d.payouts)}</td>
                    <td className="px-4 py-1.5 text-right">{formatEtbBare(d.topups)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function TakeRateDonut({ totals }: { totals: RevenueOverview['totals'] }) {
  const revenue = toNumber(totals.platformRevenueEtb);
  const rewards = toNumber(totals.userRewardsEtb);
  const total = revenue + rewards;
  if (total <= 0) return <EmptyState compact icon={PiggyBank} title="No spend yet" description="The split appears once valid actions are recorded." />;
  const data = [
    { name: 'platform revenue', value: revenue, color: CHART_COLORS.primary },
    { name: 'user rewards', value: rewards, color: CHART_COLORS.accent },
  ];
  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="85%" paddingAngle={2} stroke="var(--color-surface)" strokeWidth={2}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatter={(v) => `${etbFmt(v)} (${formatPercent(v / total, 0)})`} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-6">
        <span className="text-2xl font-semibold tabular text-fg">{formatPercent(toNumber(totals.takeRate), 0)}</span>
        <span className="text-2xs tracking-wider text-fg-subtle uppercase">take rate</span>
      </div>
    </div>
  );
}
