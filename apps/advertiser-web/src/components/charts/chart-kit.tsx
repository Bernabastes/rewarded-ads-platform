import type { ReactNode } from 'react';
import { formatShortDate } from '@/lib/utils/format';

export const CHART_COLORS = {
  primary: 'var(--chart-1)',
  primarySoft: 'var(--chart-2)',
  accent: 'var(--chart-3)',
  neutral: 'var(--chart-4)',
  info: 'var(--chart-5)',
  danger: 'var(--color-danger)',
  warning: 'var(--color-warning)',
} as const;

export const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tick: { fill: 'var(--fg-subtle)', fontSize: 12 },
} as const;

export const dateTick = (value: string) => formatShortDate(value);

export interface TooltipRow {
  name: string;
  value: ReactNode;
  color?: string;
}

/** Themed tooltip body used by every chart. */
export function ChartTooltipCard({ title, rows }: { title: ReactNode; rows: TooltipRow[] }) {
  return (
    <div className="min-w-40 rounded-md border border-border bg-surface-elevated px-3 py-2.5 text-sm shadow-pop">
      <p className="mb-1.5 text-xs font-medium text-fg-subtle">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-fg-muted">
              {row.color && (
                <span className="size-2 rounded-full" style={{ background: row.color }} aria-hidden="true" />
              )}
              {row.name}
            </span>
            <span className="font-semibold tabular-nums text-fg">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface RechartsTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{
    name?: string;
    value?: number | string;
    color?: string;
    dataKey?: string | number;
    stroke?: string;
    fill?: string;
  }>;
}

/** Adapter so Recharts' `content` prop renders our card. */
export function makeTooltip(
  format: (key: string, value: number) => ReactNode,
  labels: Record<string, string>,
) {
  return function ChartTooltip({ active, label, payload }: RechartsTooltipProps) {
    if (!active || !payload?.length) return null;
    return (
      <ChartTooltipCard
        title={typeof label === 'string' ? formatShortDate(label) : label}
        rows={payload.map((entry) => {
          const key = String(entry.dataKey ?? entry.name ?? '');
          return {
            name: labels[key] ?? key,
            value: format(key, Number(entry.value ?? 0)),
            color: entry.color ?? entry.stroke ?? entry.fill,
          };
        })}
      />
    );
  };
}

export function ChartLegend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-4 text-xs text-fg-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded-full"
            style={{
              background: item.dashed
                ? `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 7px)`
                : item.color,
            }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
