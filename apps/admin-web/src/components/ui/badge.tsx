import type { AlertSeverity, FraudSeverity, MediaStatus } from '@rap/shared';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { humanize } from '@/lib/utils/format';

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-fg-muted border-transparent',
  primary: 'bg-primary-soft text-forest-700 dark:text-forest-300 border-transparent',
  accent: 'bg-accent-soft text-terracotta-700 dark:text-terracotta-300 border-transparent',
  success: 'bg-success/12 text-[#157a52] dark:text-[#4fcf9a] border-transparent',
  warning: 'bg-warning/15 text-[#8a5d0c] dark:text-[#f0c060] border-transparent',
  danger: 'bg-danger/12 text-[#a83329] dark:text-[#f08a80] border-transparent',
  info: 'bg-info/12 text-[#2953a8] dark:text-[#8fb0f5] border-transparent',
  outline: 'bg-transparent text-fg-muted border-border-strong',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
  size?: 'sm' | 'md';
}

export function Badge({ tone = 'neutral', dot, size = 'md', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-4.5 px-1.5 text-2xs' : 'h-5 px-2 text-xs',
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

/* --------------------------- status mapping --------------------------- */

const STATUS_TONES: Record<string, BadgeTone> = {
  // review / campaigns / advertisers
  pending: 'warning',
  pending_review: 'warning',
  pending_approval: 'warning',
  pending_verification: 'warning',
  approved: 'success',
  verified: 'success',
  active: 'success',
  executed: 'success',
  completed: 'success',
  valid: 'success',
  rejected: 'danger',
  failed: 'danger',
  banned: 'danger',
  suspended: 'warning',
  flagged: 'accent',
  flagged_for_review: 'accent',
  needs_manual_review: 'danger',
  processing: 'info',
  paused: 'neutral',
  draft: 'neutral',
  cancelled: 'neutral',
  dismissed: 'neutral',
  reviewed: 'info',
  open: 'warning',
  escalated: 'accent',
  confirmed: 'danger',
};

export function toneForStatus(status: string | null | undefined): BadgeTone {
  return (status && STATUS_TONES[status]) || 'neutral';
}

export function StatusBadge({ status, className, size }: { status: string | null | undefined; className?: string; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={toneForStatus(status)} dot size={size} className={className}>
      {humanize(status)}
    </Badge>
  );
}

/** Severity scale: low=info, medium=warning, high=accent, critical=danger. */
export const SEVERITY_TONE: Record<FraudSeverity, BadgeTone> = {
  low: 'info',
  medium: 'warning',
  high: 'accent',
  critical: 'danger',
};

/** Platform-alert severities (info / warning / critical) share the same tone vocabulary. */
export const ALERT_SEVERITY_TONE: Record<AlertSeverity, BadgeTone> = { info: 'info', warning: 'warning', critical: 'danger' };

/** Media pipeline states: processing=info, ready=success, duration_corrected=warning, failed=danger. */
export const MEDIA_STATUS_TONE: Record<MediaStatus, BadgeTone> = {
  processing: 'info',
  ready: 'success',
  duration_corrected: 'warning',
  failed: 'danger',
};

export const SEVERITY_ORDER: FraudSeverity[] = ['low', 'medium', 'high', 'critical'];

export function SeverityBadge({ severity, size }: { severity: FraudSeverity; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} dot size={size} className="uppercase tracking-wide">
      {severity}
    </Badge>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('rounded bg-sunken px-1.5 py-0.5 font-mono text-2xs text-fg-muted', className)}>{children}</span>;
}
