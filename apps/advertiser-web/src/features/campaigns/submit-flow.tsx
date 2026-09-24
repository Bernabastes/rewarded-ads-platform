import { ErrorCode, type CampaignSummary } from '@rap/shared';
import { Clock, Wallet } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { useWalletBalance } from '@/features/billing/hooks';
import { isApiError } from '@/lib/api/errors';
import { toastApiError } from '@/lib/forms';
import { formatEtb } from '@/lib/utils/format';
import { useSubmitCampaign } from './hooks';

type Blocker = { kind: 'funds'; shortfallEtb: number } | { kind: 'verification' } | null;

/**
 * Submit-for-review flow shared by the wizard and the detail page. Handles the two business errors with a
 * guided dialog: INSUFFICIENT_WALLET_BALANCE → inline top-up path that returns here; ADVERTISER_NOT_VERIFIED →
 * explanation of the pending state.
 */
export function useSubmitCampaignFlow(options: { onSubmitted?: (campaign: CampaignSummary) => void } = {}) {
  const submitMutation = useSubmitCampaign();
  const { profile, updateProfile } = useAuth();
  const wallet = useWalletBalance();
  const navigate = useNavigate();
  const [blocker, setBlocker] = useState<Blocker>(null);
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);

  const submit = useCallback(
    async (target: CampaignSummary) => {
      setCampaign(target);
      try {
        const updated = await submitMutation.mutateAsync(target.id);
        if (profile && profile.verificationStatus !== 'verified') {
          // A successful submit proves the business is verified; refresh the cached profile.
          updateProfile({ verificationStatus: 'verified' });
        }
        toast.success('Campaign submitted for review', {
          description: `${formatEtb(target.budgetEtb)} has been reserved from your wallet. Our team usually reviews within one working day.`,
        });
        options.onSubmitted?.(updated as CampaignSummary);
        return updated as CampaignSummary;
      } catch (error) {
        if (isApiError(error) && error.code === ErrorCode.INSUFFICIENT_WALLET_BALANCE) {
          const balance = wallet.data?.balanceEtb ?? 0;
          setBlocker({ kind: 'funds', shortfallEtb: Math.max(0, target.budgetEtb - balance) });
          return null;
        }
        if (isApiError(error) && error.code === ErrorCode.ADVERTISER_NOT_VERIFIED) {
          if (profile && profile.verificationStatus === 'verified') updateProfile({ verificationStatus: 'pending' });
          setBlocker({ kind: 'verification' });
          return null;
        }
        toastApiError(error);
        return null;
      }
    },
    [submitMutation, profile, updateProfile, wallet.data, options],
  );

  const goToTopup = () => {
    if (!campaign || blocker?.kind !== 'funds') return;
    const amount = Math.max(100, Math.ceil(blocker.shortfallEtb / 100) * 100);
    const params = new URLSearchParams({
      topup: 'start',
      amount: String(amount),
      returnTo: `/campaigns/${campaign.id}`,
      returnLabel: `Back to “${campaign.title}”`,
    });
    setBlocker(null);
    navigate(`/billing?${params.toString()}`);
  };

  const dialog = (
    <Dialog open={blocker !== null} onOpenChange={(open) => !open && setBlocker(null)}>
      {blocker?.kind === 'funds' && campaign && (
        <DialogContent
          title="Add funds to submit this campaign"
          description="Submitting reserves the full campaign budget from your wallet so approved ads can start immediately."
          footer={
            <>
              <Button variant="outline" onClick={() => setBlocker(null)}>
                Not now
              </Button>
              <Button onClick={goToTopup} leadingIcon={<Wallet className="size-4" />}>
                Add funds and come back
              </Button>
            </>
          }
        >
          <dl className="grid gap-3 rounded-md bg-surface-muted p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-fg-subtle">Campaign budget</dt>
              <dd className="font-semibold tabular-nums text-fg">{formatEtb(campaign.budgetEtb)}</dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Wallet balance</dt>
              <dd className="font-semibold tabular-nums text-fg">{formatEtb(wallet.data?.balanceEtb ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-fg-subtle">Shortfall</dt>
              <dd className="font-semibold tabular-nums text-accent">{formatEtb(blocker.shortfallEtb)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-fg-muted">
            Your draft is saved. After the payment settles we bring you straight back here to submit.
          </p>
        </DialogContent>
      )}
      {blocker?.kind === 'verification' && (
        <DialogContent
          title="Your business is still being verified"
          description="Campaigns can only go live for verified advertisers."
          footer={
            <Button onClick={() => setBlocker(null)} leadingIcon={<Clock className="size-4" />}>
              Got it
            </Button>
          }
        >
          <div className="flex flex-col gap-3 text-sm leading-relaxed text-fg-muted">
            <p>
              Our team checks every new registration against the business registry — usually within one working day. Your draft,
              creatives and wallet are all saved.
            </p>
            <p>
              Once approved, sign in again to refresh your status and submit from the campaign page. Nothing else is needed from you.
            </p>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );

  return { submit, dialog, isSubmitting: submitMutation.isPending };
}
