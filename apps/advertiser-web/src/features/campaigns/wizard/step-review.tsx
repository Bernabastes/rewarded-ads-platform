import type { CampaignDetail } from '@rap/shared';
import { ArrowLeft, Pencil, Save, Send, ShieldCheck } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DescriptionList } from '@/components/ui/table';
import { useAuth } from '@/features/auth/auth-provider';
import { useWalletBalance } from '@/features/billing/hooks';
import { TARGET_ACTION_META } from '@/features/campaigns/campaign-card';
import { AdPreview } from '@/features/campaigns/creative-preview';
import { computeBudgetSplit } from '@/lib/utils/budget';
import { formatDate, formatDuration, formatEtb, formatNumber, formatPercent } from '@/lib/utils/format';
import { creativeRequired, type WizardStep } from './machine';

export function ReviewStep({
  campaign,
  onEdit,
  onBack,
  onSaveDraft,
  onSubmit,
  submitting,
}: {
  campaign: CampaignDetail;
  onEdit: (step: WizardStep) => void;
  onBack: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const { profile } = useAuth();
  const wallet = useWalletBalance();
  const meta = TARGET_ACTION_META[campaign.targetActionType];
  const split = computeBudgetSplit(campaign.budgetEtb, campaign.costPerActionEtb);
  const needsAds = creativeRequired(campaign.targetActionType) && campaign.ads.length === 0;
  const balance = wallet.data?.balanceEtb;
  const shortfall = balance !== undefined ? Math.max(0, campaign.budgetEtb - balance) : 0;
  const pending = profile?.verificationStatus !== 'verified';

  return (
    <div className="flex flex-col gap-6">
      {pending && (
        <Alert tone="warning" title="Submitting unlocks after verification">
          Your business is still being verified. Save the draft now — everything is kept — and submit once your account is approved.
        </Alert>
      )}
      {!pending && shortfall > 0 && (
        <Alert tone="warning" title={`Add ${formatEtb(shortfall)} to submit`}>
          Submitting reserves the full {formatEtb(campaign.budgetEtb)} budget. Your wallet holds {formatEtb(balance ?? 0)}; we will take you to add funds
          and bring you back here.
        </Alert>
      )}
      {needsAds && (
        <Alert tone="danger" title="Add at least one creative">
          Video campaigns cannot be submitted without a creative.{' '}
          <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => onEdit('creative')}>
            Upload one now
          </button>
          .
        </Alert>
      )}

      <ReviewSection title="Details" onEdit={() => onEdit('details')}>
        <DescriptionList
          items={[
            { term: 'Title', detail: campaign.title },
            { term: 'Target action', detail: meta.label },
            { term: 'Description', detail: campaign.description || <span className="text-fg-subtle">None</span> },
            { term: 'Attention check', detail: campaign.attentionCheckEnabled ? 'On — viewers answer one question per ad' : 'Off' },
            { term: 'Start', detail: campaign.startDate ? formatDate(campaign.startDate) : 'As soon as approved' },
            { term: 'End', detail: campaign.endDate ? formatDate(campaign.endDate) : 'When the budget is spent' },
          ]}
        />
      </ReviewSection>

      <ReviewSection title="Budget & pricing" onEdit={() => onEdit('budget')}>
        <DescriptionList
          items={[
            { term: 'Total budget', detail: formatEtb(campaign.budgetEtb) },
            { term: 'Cost per verified action', detail: formatEtb(campaign.costPerActionEtb) },
            {
              term: 'Viewer receives',
              detail: `${formatEtb(campaign.rewardPerActionEtb)} (${formatNumber(campaign.rewardCoins)} coins)`,
            },
            { term: `Platform fee (${formatPercent(split.takeRate, 0)})`, detail: formatEtb(split.platformFeeEtb) },
            { term: 'Estimated verified completions', detail: `≈ ${formatNumber(split.estimatedCompletions)}` },
          ]}
        />
      </ReviewSection>

      <ReviewSection title={`Creatives (${campaign.ads.length})`} onEdit={() => onEdit('creative')}>
        {campaign.ads.length === 0 ? (
          <p className="text-sm text-fg-muted">No creatives attached.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaign.ads.map((ad) => (
              <li key={ad.id} className="flex flex-col gap-2">
                <AdPreview ad={ad} compact />
                <p className="truncate text-sm font-medium text-fg">{ad.title}</p>
                <p className="text-xs text-fg-subtle">
                  {ad.mediaType === 'video' ? 'Video' : 'Image'} · {formatDuration(ad.durationSeconds)} · {ad.attentionQuestionsCount} question
                  {ad.attentionQuestionsCount === 1 ? '' : 's'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>

      <div className="flex gap-3 rounded-md bg-primary-soft p-4 text-sm text-fg">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>
          <strong className="font-semibold">What happens next.</strong> Submitting reserves {formatEtb(campaign.budgetEtb)} from your wallet and sends the
          creatives to our review team (usually within one working day). Once approved, ads go live and you are charged only for completions
          that pass server-side watch verification and fraud checks. Unspent budget is released back to your wallet.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={onBack} leadingIcon={<ArrowLeft className="size-4" />}>
          Back
        </Button>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={onSaveDraft} leadingIcon={<Save className="size-4" />}>
            Save as draft
          </Button>
          <Button type="button" size="lg" onClick={onSubmit} disabled={needsAds} loading={submitting} leadingIcon={<Send className="size-4" />}>
            Submit for review
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-5" aria-label={title}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit} leadingIcon={<Pencil className="size-3.5" />}>
          Edit
        </Button>
      </div>
      {children}
    </section>
  );
}
