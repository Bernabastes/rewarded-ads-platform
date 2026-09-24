import { animate, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils/cn';
import { Skeleton } from './feedback';

export interface CountUpProps {
  value: number;
  /** Formatter applied to the animated value. */
  format?: (v: number) => string;
  durationMs?: number;
  className?: string;
}

/** Animated number that eases from the previous value to the new one (respects reduced motion). */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString(), durationMs = 900, className }: CountUpProps) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const previous = useRef(0);

  useEffect(() => {
    if (reduce || !Number.isFinite(value)) {
      setDisplay(value);
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, {
      duration: durationMs / 1000,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
      onComplete: () => {
        previous.current = value;
        setDisplay(value);
      },
    });
    return () => controls.stop();
  }, [value, durationMs, reduce]);

  return (
    <span className={cn('tabular', className)} aria-live="off">
      {format(display)}
    </span>
  );
}

export interface StatCardProps {
  label: ReactNode;
  value: number | null | undefined;
  format?: (v: number) => string;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'primary' | 'accent' | 'danger' | 'warning' | 'info' | 'success';
  to?: string;
  loading?: boolean;
  className?: string;
  /** Small trailing element (badge, delta …). */
  trailing?: ReactNode;
}

const toneClasses = {
  default: 'text-fg-muted bg-sunken',
  primary: 'text-primary bg-primary-soft',
  accent: 'text-accent bg-accent-soft',
  danger: 'text-danger bg-danger/12',
  warning: 'text-warning bg-warning/15',
  info: 'text-info bg-info/12',
  success: 'text-success bg-success/12',
};

export function StatCard({ label, value, format, hint, icon: Icon, tone = 'default', to, loading, className, trailing }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-fg-muted">{label}</p>
        {Icon ? (
          <span className={cn('flex size-6 items-center justify-center rounded-md', toneClasses[tone])}>
            <Icon className="size-3.5" />
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        {loading || value === null || value === undefined ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <CountUp value={value} format={format} className="text-2xl font-semibold tracking-tight text-fg" />
        )}
        {trailing}
      </div>
      {hint ? <p className="mt-1 truncate text-2xs text-fg-subtle">{hint}</p> : null}
    </>
  );
  const cls = cn('block rounded-lg border bg-surface p-3.5 shadow-card transition-colors', to && 'hover:border-border-strong hover:bg-elevated', className);
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
