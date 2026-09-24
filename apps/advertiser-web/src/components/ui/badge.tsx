import type { AdvertiserVerificationStatus, CampaignStatus, InvoiceStatus, PaymentStatus, ReviewStatus } from '@rap/shared';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { humanize } from '@/lib/utils/format';

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-fg-muted ring-border',
  primary: 'bg-primary-soft text-primary ring-primary/15',
  accent: 'bg-accent-soft text-accent ring-accent/20',
  success: 'bg-success/12 text-success ring-success/20 dark:text-[#4fc79a]',
  warning: 'bg-warning/15 text-[#8a5a00] ring-warning/30 dark:text-[#f0c265]',
  danger: 'bg-danger/10 text-danger ring-danger/20 dark:text-[#f08a80]',
  info: 'bg-info/10 text-info ring-info/20 dark:text-[#8db0f5]',
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
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ring-1 ring-inset',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, BadgeTone> = {
  draft: 'neutral',
  pending_review: 'warning',
  active: 'success',
  paused: 'info',
  completed: 'primary',
  rejected: 'danger',
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  pending_review: 'In review',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  rejected: 'Rejected',
};

export function CampaignStatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  return (
    <Badge tone={CAMPAIGN_STATUS_TONE[status]} dot className={className}>
      {CAMPAIGN_STATUS_LABEL[status]}
    </Badge>
  );
}

const REVIEW_TONE: Record<ReviewStatus, BadgeTone> = { pending: 'warning', approved: 'success', rejected: 'danger' };
export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const label = status === 'pending' ? 'Awaiting review' : humanize(status);
  return (
    <Badge tone={REVIEW_TONE[status]} dot>
      {label}
    </Badge>
  );
}

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  pending: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge tone={PAYMENT_TONE[status]} dot>
      {humanize(status)}
    </Badge>
  );
}

const INVOICE_TONE: Record<InvoiceStatus, BadgeTone> = { issued: 'info', paid: 'success', void: 'neutral' };
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge tone={INVOICE_TONE[status]} dot>
      {humanize(status)}
    </Badge>
  );
}

const VERIFICATION_TONE: Record<AdvertiserVerificationStatus, BadgeTone> = {
  pending: 'warning',
  verified: 'success',
  rejected: 'danger',
};
export function VerificationBadge({ status, children }: { status: AdvertiserVerificationStatus; children?: ReactNode }) {
  return (
    <Badge tone={VERIFICATION_TONE[status]} dot>
      {children ?? (status === 'pending' ? 'Verification pending' : humanize(status))}
    </Badge>
  );
}
