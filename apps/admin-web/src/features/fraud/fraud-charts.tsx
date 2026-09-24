import type { FraudMetrics, FraudSeverity } from '@rap/shared';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInt, formatPercent, formatShortDate, humanize } from '@/lib/utils/format';
import { SEVERITY_ORDER } from '@/components/ui/badge';

export const CHART_COLORS = {
  primary: 'var(--color-forest-500)',
  primarySoft: 'var(--color-forest-300)',
  accent: 'var(--color-terracotta-500)',
  danger: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  success: 'var(--color-success)',
  muted: 'var(--color-stone-400)',
};

export const SEVERITY_COLORS: Record<FraudSeverity, string> = {
  low: CHART_COLORS.info,
  medium: CHART_COLORS.warning,
  high: CHART_COLORS.accent,
  critical: CHART_COLORS.danger,
};

interface TooltipEntry {
  name?: string | number;
  value?: number | string | ReadonlyArray<number | string>;
  color?: string;
  dataKey?: string | number;
}

/** Theme-aware tooltip shared by every chart in the console. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  formatter?: (value: number, name: string) => string;
  labelFormatter?: (label: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const heading = typeof label === 'string' ? (labelFormatter ? labelFormatter(label) : label) : String(label ?? '');
  return (
    <div className="rounded-md border bg-elevated px-2.5 py-2 text-xs shadow-pop">
      {heading ? <div className="mb-1 font-medium text-fg">{heading}</div> : null}
      <ul className="space-y-0.5">
        {payload.map((p, i) => {
          const value = typeof p.value === 'number' ? p.value : Number(p.value);
          const name = String(p.name ?? p.dataKey ?? '');
          return (
            <li key={i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-fg-muted">
                <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
                {humanize(name)}
              </span>
              <span className="tabular font-medium text-fg">{formatter ? formatter(value, name) : formatInt(value)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FraudTrendChart({ data }: { data: FraudMetrics['daily'] }) {
  const rows = data.map((d) => ({
    date: d.date,
    valid: Math.max(0, d.rawCompletions - d.flaggedCompletions - d.rejectedCompletions),
    flagged: d.flaggedCompletions,
    rejected: d.rejectedCompletions,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickFormatter={formatShortDate} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: 'color-mix(in oklab, var(--color-primary) 8%, transparent)' }} content={<ChartTooltip labelFormatter={formatShortDate} />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={(v) => humanize(String(v))} />
        <Bar dataKey="valid" stackId="a" fill={CHART_COLORS.primary} radius={[0, 0, 0, 0]} />
        <Bar dataKey="flagged" stackId="a" fill={CHART_COLORS.warning} />
        <Bar dataKey="rejected" stackId="a" fill={CHART_COLORS.danger} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SeverityDonut({ data }: { data: FraudMetrics['openFlagsBySeverity'] }) {
  const rows = SEVERITY_ORDER.map((s) => ({ name: s, value: data[s] })).filter((r) => r.value > 0);
  const total = rows.reduce((n, r) => n + r.value, 0);
  if (!total) return <p className="flex h-full items-center justify-center text-xs text-fg-subtle">No open flags</p>;
  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="var(--color-surface)" strokeWidth={2}>
            {rows.map((r) => (
              <Cell key={r.name} fill={SEVERITY_COLORS[r.name]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip formatter={(v) => `${formatInt(v)} (${formatPercent(v / total, 0)})`} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular text-fg">{formatInt(total)}</span>
        <span className="text-2xs text-fg-subtle uppercase tracking-wider">open</span>
      </div>
    </div>
  );
}

export function FlagTypeBars({ data }: { data: FraudMetrics['flagsByType'] }) {
  if (!data.length) return <p className="flex h-full items-center justify-center text-xs text-fg-subtle">No flags in the last 7 days</p>;
  const rows = [...data].sort((a, b) => b.count - a.count);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} hide />
        <YAxis type="category" dataKey="flagType" width={170} tickLine={false} axisLine={false} tickFormatter={(v: string) => humanize(v)} />
        <Tooltip cursor={{ fill: 'color-mix(in oklab, var(--color-primary) 8%, transparent)' }} content={<ChartTooltip />} />
        <Bar dataKey="count" name="flags" fill={CHART_COLORS.accent} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
