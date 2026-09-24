import type { CampaignSummary, TargetActionType } from '@rap/shared';
import { AppWindow, ClipboardList, PlayCircle, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { StaggerItem } from '@/components/motion/motion';
import { CampaignStatusBadge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils/cn';
import { formatEtb, formatNumber, formatPercent } from '@/lib/utils/format';

export const TARGET_ACTION_META: Record<TargetActionType, { label: string; icon: LucideIcon; description: string }> = {
  video_view: { label: 'Video view', icon: PlayCircle, description: 'Viewers watch your video ad to the end and pass an attention check.' },
  survey: { label: 'Survey', icon: ClipboardList, description: 'Viewers answer a short questionnaire — higher reward, richer insight.' },
  app_install: { label: 'App install', icon: AppWindow, description: 'Viewers install and open your app; verified before payout.' },
};

export function budgetProgress(campaign: Pick<CampaignSummary, 'budgetEtb' | 'spentEtb'>): number {
  return campaign.budgetEtb > 0 ? Math.min(1, campaign.spentEtb / campaign.budgetEtb) : 0;
}

export function CampaignCard({ campaign, className, animated = true }: { campaign: CampaignSummary; className?: string; animated?: boolean }) {
  const meta = TARGET_ACTION_META[campaign.targetActionType];
  const progress = budgetProgress(campaign);
  const Wrapper = animated ? StaggerItem : 'div';
  const validRate = campaign.rawCompletions > 0 ? campaign.validCompletions / campaign.rawCompletions : null;

  return (
    <Wrapper className={cn('h-full', className)}>
      <Link
        to={`/campaigns/${campaign.id}`}
        className="card-surface group flex h-full flex-col gap-4 p-5 transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`${campaign.title}, ${campaign.status.replace('_', ' ')}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-fg group-hover:text-primary">{campaign.title}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-subtle">
              <meta.icon className="size-3.5" /> {meta.label} · {formatEtb(campaign.costPerActionEtb)} per action
            </p>
          </div>
          <CampaignStatusBadge status={campaign.status} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-fg-muted">Spent</span>
            <span className="font-medium tabular-nums text-fg">
              {formatEtb(campaign.spentEtb)} <span className="text-fg-subtle">/ {formatEtb(campaign.budgetEtb)}</span>
            </span>
          </div>
          <Progress value={progress} size="sm" tone={progress >= 0.9 ? 'accent' : 'primary'} label="Budget spent" />
        </div>

        <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-border pt-4 text-sm">
          <div>
            <dt className="text-xs text-fg-subtle">Verified</dt>
            <dd className="font-semibold tabular-nums text-fg">{formatNumber(campaign.validCompletions)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Raw</dt>
            <dd className="font-semibold tabular-nums text-fg-muted">{formatNumber(campaign.rawCompletions)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Pass rate</dt>
            <dd className="font-semibold tabular-nums text-fg">{validRate === null ? '—' : formatPercent(validRate, 0)}</dd>
          </div>
        </dl>
      </Link>
    </Wrapper>
  );
}
