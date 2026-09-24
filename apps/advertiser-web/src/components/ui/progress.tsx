import { cn } from '@/lib/utils/cn';

export interface ProgressProps {
  /** 0..1 */
  value: number;
  className?: string;
  tone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
  label?: string;
}

const TONES = {
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function Progress({ value, className, tone = 'primary', size = 'md', label }: ProgressProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-label={label}
      className={cn(
        'w-full overflow-hidden rounded-full bg-surface-muted',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        className,
      )}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', TONES[tone])}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
