import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CountUp } from '@/components/motion/count-up';
import { StaggerItem } from '@/components/motion/motion';
import { cn } from '@/lib/utils/cn';

export interface StatCardProps {
  label: string;
  value: number;
  format?: (value: number) => string;
  icon: LucideIcon;
  hint?: ReactNode;
  tone?: 'primary' | 'accent' | 'info' | 'neutral' | 'success';
  className?: string;
  /** Optional trailing element (badge, sparkline). */
  extra?: ReactNode;
}

const TONES = {
  primary: 'bg-primary-soft text-primary',
  accent: 'bg-accent-soft text-accent',
  info: 'bg-info/10 text-info',
  neutral: 'bg-surface-muted text-fg-muted',
  success: 'bg-success/10 text-success',
};

export function StatCard({ label, value, format, icon: Icon, hint, tone = 'primary', className, extra }: StatCardProps) {
  return (
    <StaggerItem className={cn('card-surface flex flex-col gap-3 p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-fg-muted">{label}</p>
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md', TONES[tone])} aria-hidden="true">
          <Icon className="size-[18px]" />
        </span>
      </div>
      <p className="text-display text-3xl font-bold tracking-tight text-fg">
        <CountUp value={value} format={format} />
      </p>
      {(hint || extra) && (
        <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
          <span>{hint}</span>
          {extra}
        </div>
      )}
    </StaggerItem>
  );
}
