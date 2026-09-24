import type { AdvertiserOverview } from '@rap/shared';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AXIS_PROPS, CHART_COLORS, ChartLegend, dateTick, makeTooltip } from '@/components/charts/chart-kit';
import { ChartReveal } from '@/components/motion/motion';
import { formatCompact, formatEtb, formatNumber } from '@/lib/utils/format';

type Point = AdvertiserOverview['daily'][number];

const SpendTooltip = makeTooltip((_key, value) => formatEtb(value), { spendEtb: 'Spend' });
const ViewsTooltip = makeTooltip((_key, value) => formatNumber(value), {
  rawViews: 'Raw views',
  validCompletions: 'Verified completions',
});

export function SpendChart({ data }: { data: Point[] }) {
  return (
    <ChartReveal className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.32} />
              <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 6" />
          <XAxis dataKey="date" tickFormatter={dateTick} minTickGap={28} {...AXIS_PROPS} />
          <YAxis tickFormatter={(v: number) => formatCompact(v)} width={56} {...AXIS_PROPS} />
          <Tooltip content={<SpendTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
          <Area
            type="monotone"
            dataKey="spendEtb"
            stroke={CHART_COLORS.primary}
            strokeWidth={2.5}
            fill="url(#spendFill)"
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
            isAnimationActive
            animationDuration={900}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartReveal>
  );
}

export function ViewsChart({ data }: { data: Point[] }) {
  return (
    <div className="flex flex-col gap-3">
      <ChartLegend
        items={[
          { label: 'Raw views', color: CHART_COLORS.primarySoft },
          { label: 'Verified completions', color: CHART_COLORS.accent },
        ]}
      />
      <ChartReveal className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 6" />
            <XAxis dataKey="date" tickFormatter={dateTick} minTickGap={28} {...AXIS_PROPS} />
            <YAxis
              tickFormatter={(v: number) => formatCompact(v)}
              width={56}
              allowDecimals={false}
              {...AXIS_PROPS}
            />
            <Tooltip content={<ViewsTooltip />} cursor={{ fill: 'var(--surface-muted)' }} />
            <Bar
              dataKey="rawViews"
              fill={CHART_COLORS.primarySoft}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              animationDuration={800}
            />
            <Line
              type="monotone"
              dataKey="validCompletions"
              stroke={CHART_COLORS.accent}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
              animationDuration={900}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartReveal>
    </div>
  );
}
