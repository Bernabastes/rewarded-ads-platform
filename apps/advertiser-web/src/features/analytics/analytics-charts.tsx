import type { CampaignAnalyticsDailyPoint } from '@rap/shared';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_PROPS, CHART_COLORS, ChartLegend, dateTick, makeTooltip } from '@/components/charts/chart-kit';
import { ChartReveal } from '@/components/motion/motion';
import { cn } from '@/lib/utils/cn';
import { formatCompact, formatEtb, formatNumber, formatPercent } from '@/lib/utils/format';

const CompletionsTooltip = makeTooltip((_k, v) => formatNumber(v), {
  validCompletions: 'Verified',
  flaggedCompletions: 'Flagged',
  rejectedCompletions: 'Rejected',
  rawViews: 'Raw views',
});

/** Stacked daily completions: verified vs flagged vs rejected, with raw views as a reference line. */
export function CompletionsChart({ data }: { data: CampaignAnalyticsDailyPoint[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ChartLegend
        items={[
          { label: 'Verified (billed)', color: CHART_COLORS.primary },
          { label: 'Flagged', color: CHART_COLORS.warning },
          { label: 'Rejected', color: CHART_COLORS.danger },
          { label: 'Raw views', color: CHART_COLORS.neutral, dashed: true },
        ]}
      />
      <ChartReveal className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} strokeDasharray="3 6" />
            <XAxis dataKey="date" tickFormatter={dateTick} minTickGap={28} {...AXIS_PROPS} />
            <YAxis tickFormatter={(v: number) => formatCompact(v)} width={56} allowDecimals={false} {...AXIS_PROPS} />
            <Tooltip content={<CompletionsTooltip />} cursor={{ fill: 'var(--surface-muted)' }} />
            <Bar dataKey="validCompletions" stackId="c" fill={CHART_COLORS.primary} maxBarSize={32} animationDuration={800} />
            <Bar dataKey="flaggedCompletions" stackId="c" fill={CHART_COLORS.warning} maxBarSize={32} animationDuration={800} />
            <Bar dataKey="rejectedCompletions" stackId="c" fill={CHART_COLORS.danger} radius={[4, 4, 0, 0]} maxBarSize={32} animationDuration={800} />
            <Line type="monotone" dataKey="rawViews" stroke={CHART_COLORS.neutral} strokeDasharray="4 4" strokeWidth={2} dot={false} animationDuration={900} />
          </BarChart>
        </ResponsiveContainer>
      </ChartReveal>
    </div>
  );
}

const SpendTooltip = makeTooltip((_k, v) => formatEtb(v), { spendEtb: 'Spend' });

export function AnalyticsSpendChart({ data }: { data: Array<{ date: string; spendEtb: number }> }) {
  return (
    <ChartReveal className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="analyticsSpendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.32} />
              <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 6" />
          <XAxis dataKey="date" tickFormatter={dateTick} minTickGap={28} {...AXIS_PROPS} />
          <YAxis tickFormatter={(v: number) => formatCompact(v)} width={56} {...AXIS_PROPS} />
          <Tooltip content={<SpendTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
          <Area type="monotone" dataKey="spendEtb" stroke={CHART_COLORS.accent} strokeWidth={2.5} fill="url(#analyticsSpendFill)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartReveal>
  );
}

export interface FunnelStage {
  label: string;
  value: number;
  hint?: string;
  tone: 'neutral' | 'soft' | 'primary';
}

const FUNNEL_TONES = { neutral: 'bg-stone-400/70 dark:bg-stone-500/70', soft: 'bg-forest-300 dark:bg-forest-700', primary: 'bg-primary' };

/** Horizontal funnel: each stage is sized relative to the first; conversion shown against the previous stage. */
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, stages[0]?.value ?? 1);
  return (
    <ol className="flex flex-col gap-4" aria-label="Completion funnel">
      {stages.map((stage, index) => {
        const previous = index > 0 ? stages[index - 1].value : null;
        const conversion = previous && previous > 0 ? stage.value / previous : null;
        const width = Math.max(4, (stage.value / max) * 100);
        return (
          <li key={stage.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-fg">{stage.label}</span>
              <span className="tabular-nums text-fg">
                <span className="font-semibold">{formatNumber(stage.value)}</span>
                {conversion !== null && <span className="ml-2 text-xs text-fg-subtle">{formatPercent(conversion, 0)} of previous</span>}
              </span>
            </div>
            <div className="h-8 w-full overflow-hidden rounded-md bg-surface-muted">
              <div className={cn('h-full rounded-md transition-[width] duration-700 ease-out', FUNNEL_TONES[stage.tone])} style={{ width: `${width}%` }} />
            </div>
            {stage.hint && <p className="text-xs text-fg-subtle">{stage.hint}</p>}
          </li>
        );
      })}
    </ol>
  );
}
