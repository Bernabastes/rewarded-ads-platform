import type { CampaignDetail } from '@rap/shared';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { NotFoundPage } from '@/app/error-pages';
import { ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { EASE_OUT, PageTransition } from '@/components/motion/motion';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';
import { useWalletBalance } from '@/features/billing/hooks';
import { useCampaign, useCreateCampaign, useUpdateCampaign } from '@/features/campaigns/hooks';
import { useSubmitCampaignFlow } from '@/features/campaigns/submit-flow';
import {
  canNavigateTo,
  deriveCompletedSteps,
  firstIncomplete,
  isWizardStep,
  STEP_META,
  type WizardState,
  type WizardStep,
} from './machine';
import { wizardScratch, type BudgetValues, type DetailsValues } from './schemas';
import { BudgetStep } from './step-budget';
import { CreativeStep } from './step-creative';
import { DEFAULT_DETAILS, DetailsStep, detailsFromCampaign } from './step-details';
import { ReviewStep } from './step-review';
import { WizardStepper } from './stepper';

function toDto(details: DetailsValues, budget: BudgetValues) {
  return {
    title: details.title,
    description: details.description || undefined,
    targetActionType: details.targetActionType,
    startDate: details.startDate || undefined,
    endDate: details.endDate || undefined,
    attentionCheckEnabled: details.attentionCheckEnabled,
    budgetEtb: budget.budgetEtb,
    costPerActionEtb: budget.costPerActionEtb,
  };
}

/** Derive the wizard state from the URL + server data (no synchronised local state to drift). */
function useWizardState(campaign: CampaignDetail | undefined, requestedStep: string | null): WizardState {
  const scratch = wizardScratch.read();
  const base: WizardState = campaign
    ? {
        step: 'details',
        campaignId: campaign.id,
        completed: deriveCompletedSteps(campaign),
        targetActionType: campaign.targetActionType,
      }
    : {
        step: 'details',
        campaignId: null,
        completed: scratch.details ? ['details'] : [],
        targetActionType: scratch.details?.targetActionType ?? 'video_view',
      };
  const wanted = isWizardStep(requestedStep) ? requestedStep : null;
  const step =
    wanted && canNavigateTo(base, wanted)
      ? wanted
      : campaign
        ? firstIncomplete(base)
        : scratch.details
          ? 'budget'
          : 'details';
  return { ...base, step };
}

export function WizardPage() {
  const { id } = useParams<{ id?: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const campaignQuery = useCampaign(id, { poll: false });
  const wallet = useWalletBalance();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const submitFlow = useSubmitCampaignFlow({
    onSubmitted: (updated) => {
      wizardScratch.clear();
      navigate(`/campaigns/${updated.id}`, { replace: true });
    },
  });

  const campaign = campaignQuery.data;
  const state = useWizardState(campaign, params.get('step'));

  const goTo = useCallback(
    (step: WizardStep, replace = false) => {
      const next = new URLSearchParams(params);
      next.set('step', step);
      setParams(next, { replace });
    },
    [params, setParams],
  );

  if (id && campaignQuery.isError) {
    return (
      <Card>
        <ErrorState error={campaignQuery.error} onRetry={() => void campaignQuery.refetch()} />
      </Card>
    );
  }
  if (id && (campaignQuery.isPending || !campaign)) return <WizardSkeleton />;
  if (id && !campaign) return <NotFoundPage embedded />;

  if (campaign && campaign.status !== 'draft' && campaign.status !== 'rejected') {
    return (
      <PageTransition className="flex flex-col gap-6">
        <PageHeader
          crumbs={[
            { label: 'Campaigns', to: '/campaigns' },
            { label: campaign.title, to: `/campaigns/${campaign.id}` },
            { label: 'Edit' },
          ]}
          title="This campaign cannot be edited"
        />
        <Alert tone="info" title={`“${campaign.title}” is ${campaign.status.replace('_', ' ')}`}>
          Only drafts and rejected campaigns can be edited. Pause an active campaign from its page if you need
          to stop delivery.
        </Alert>
        <Button asChild className="self-start">
          <Link to={`/campaigns/${campaign.id}`}>Back to campaign</Link>
        </Button>
      </PageTransition>
    );
  }

  const scratch = wizardScratch.read();
  const detailsDefaults = campaign ? detailsFromCampaign(campaign) : (scratch.details ?? DEFAULT_DETAILS);
  const budgetDefaults: Partial<BudgetValues> = campaign
    ? { budgetEtb: campaign.budgetEtb, costPerActionEtb: campaign.costPerActionEtb }
    : (scratch.budget ?? {});

  const saveDetails = async (values: DetailsValues) => {
    if (campaign) {
      await updateCampaign.mutateAsync({
        id: campaign.id,
        dto: {
          title: values.title,
          description: values.description || undefined,
          targetActionType: values.targetActionType,
          startDate: values.startDate || undefined,
          endDate: values.endDate || undefined,
          attentionCheckEnabled: values.attentionCheckEnabled,
        },
      });
      toast.success('Details saved');
    } else {
      wizardScratch.write({ details: values });
    }
    goTo('budget');
  };

  const saveBudget = async (values: BudgetValues) => {
    if (campaign) {
      await updateCampaign.mutateAsync({
        id: campaign.id,
        dto: { budgetEtb: values.budgetEtb, costPerActionEtb: values.costPerActionEtb },
      });
      toast.success('Budget saved');
      goTo('creative');
      return;
    }
    const details = wizardScratch.read().details;
    if (!details) {
      goTo('details', true);
      return;
    }
    wizardScratch.write({ budget: values });
    const created = await createCampaign.mutateAsync(toDto(details, values));
    wizardScratch.clear();
    toast.success('Draft created', {
      description: 'Your progress is saved — you can come back to this campaign any time.',
    });
    navigate(`/campaigns/${created.id}/edit?step=creative`, { replace: true });
  };

  const title = campaign
    ? campaign.status === 'rejected'
      ? 'Revise campaign'
      : 'Continue your draft'
    : 'New campaign';

  return (
    <PageTransition className="flex flex-col gap-6">
      <PageHeader
        crumbs={[
          { label: 'Campaigns', to: '/campaigns' },
          ...(campaign ? [{ label: campaign.title, to: `/campaigns/${campaign.id}` }] : []),
          { label: title },
        ]}
        title={title}
        description={
          campaign
            ? 'Every step saves to your draft as you go.'
            : 'Four short steps. Your draft is saved to the server once the budget is set.'
        }
      />

      <WizardStepper state={state} onSelect={(step) => goTo(step)} />

      <Card>
        <CardContent className="py-6 sm:py-8">
          <div className="mb-6">
            <h2 className="text-display text-xl font-semibold text-fg">{STEP_META[state.step].title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{STEP_META[state.step].description}</p>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={state.step}
              initial={reduce ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: -16 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
            >
              {state.step === 'details' && (
                <DetailsStep
                  defaultValues={detailsDefaults}
                  onSubmit={saveDetails}
                  saving={updateCampaign.isPending}
                  submitLabel={campaign ? 'Save and continue' : 'Continue to budget'}
                />
              )}
              {state.step === 'budget' && (
                <BudgetStep
                  defaultValues={budgetDefaults}
                  onSubmit={saveBudget}
                  onBack={() => goTo('details')}
                  saving={createCampaign.isPending || updateCampaign.isPending}
                  submitLabel={campaign ? 'Save and continue' : 'Save draft and continue'}
                  walletBalanceEtb={wallet.data?.balanceEtb}
                />
              )}
              {state.step === 'creative' && campaign && (
                <CreativeStep
                  campaign={campaign}
                  onBack={() => goTo('budget')}
                  onContinue={() => goTo('review')}
                />
              )}
              {state.step === 'review' && campaign && (
                <ReviewStep
                  campaign={campaign}
                  onEdit={(step) => goTo(step)}
                  onBack={() => goTo('creative')}
                  onSaveDraft={() => {
                    toast.success('Draft saved');
                    navigate(`/campaigns/${campaign.id}`);
                  }}
                  onSubmit={() => void submitFlow.submit(campaign)}
                  submitting={submitFlow.isSubmitting}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
      {submitFlow.dialog}
    </PageTransition>
  );
}

function WizardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <Card>
        <CardContent className="flex flex-col gap-5 py-8">
          <Skeleton className="h-6 w-48" />
          <SkeletonText lines={2} />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
