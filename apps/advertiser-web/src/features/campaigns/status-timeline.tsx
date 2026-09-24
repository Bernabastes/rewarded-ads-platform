import type { CampaignStatus, CampaignSummary } from '@rap/shared';
import { Check, Pause, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatDate } from '@/lib/utils/format';

const MAIN_STEPS: Array<{ status: CampaignStatus; label: string; hint: string }> = [
  { status: 'draft', label: 'Draft', hint: 'Details, creatives and budget' },
  { status: 'pending_review', label: 'In review', hint: 'Our team checks the creatives' },
  { status: 'active', label: 'Active', hint: 'Shown to verified viewers' },
  { status: 'completed', label: 'Completed', hint: 'Budget spent or end date reached' },
];

const ORDER: Record<CampaignStatus, number> = {
  draft: 0,
  rejected: 1,
  pending_review: 1,
  paused: 2,
  active: 2,
  completed: 3,
};

/** Horizontal status timeline; paused and rejected render as side states of their main step. */
export function StatusTimeline({ campaign }: { campaign: CampaignSummary }) {
  const current = ORDER[campaign.status];
  return (
    <ol className="grid gap-4 sm:grid-cols-4" aria-label="Campaign progress">
      {MAIN_STEPS.map((step, index) => {
        const reached = index <= current;
        const isCurrent = index === current;
        const sideState = isCurrent && campaign.status === 'paused' ? 'paused' : isCurrent && campaign.status === 'rejected' ? 'rejected' : null;
        return (
          <li key={step.status} className="relative flex gap-3 sm:flex-col sm:gap-3">
            <div className="flex items-center sm:w-full">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                  sideState === 'rejected'
                    ? 'border-danger bg-danger text-white'
                    : sideState === 'paused'
                      ? 'border-info bg-info text-white'
                      : reached
                        ? 'border-primary bg-primary text-primary-fg'
                        : 'border-border-strong bg-surface text-fg-subtle',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {sideState === 'rejected' ? <X className="size-4" /> : sideState === 'paused' ? <Pause className="size-3.5" /> : reached && !isCurrent ? <Check className="size-4" /> : index + 1}
              </span>
              {index < MAIN_STEPS.length - 1 && (
                <span className={cn('mx-2 hidden h-0.5 flex-1 rounded-full sm:block', index < current ? 'bg-primary' : 'bg-border')} aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <p className={cn('text-sm font-semibold', reached ? 'text-fg' : 'text-fg-subtle')}>
                {sideState === 'rejected' ? 'Rejected' : sideState === 'paused' ? 'Paused' : step.label}
              </p>
              <p className="text-xs text-fg-subtle">
                {sideState === 'rejected'
                  ? 'Fix the feedback and resubmit'
                  : sideState === 'paused'
                    ? campaign.pausedReason === 'admin_paused'
                      ? 'Paused by the platform team'
                      : 'Paused by you'
                    : step.hint}
              </p>
              {step.status === 'draft' && <p className="mt-0.5 text-xs text-fg-subtle">Created {formatDate(campaign.createdAt)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
