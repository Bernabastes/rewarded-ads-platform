import type { CampaignDetail, TargetActionType } from '@rap/shared';

/**
 * Step order follows the API's constraints: a draft (which needs budget + cost per action) must exist before a
 * creative can be uploaded against it, so pricing comes before creatives.
 */
export const WIZARD_STEPS = ['details', 'budget', 'creative', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_META: Record<WizardStep, { title: string; short: string; description: string }> = {
  details: { title: 'Campaign details', short: 'Details', description: 'What are you promoting and to whom?' },
  budget: { title: 'Budget & pricing', short: 'Budget', description: 'How much to spend and what each verified action is worth.' },
  creative: { title: 'Creatives', short: 'Creatives', description: 'Upload the video or image viewers will see.' },
  review: { title: 'Review & submit', short: 'Review', description: 'Check everything, then send it for review.' },
};

export interface WizardState {
  step: WizardStep;
  /** Set once the draft exists on the server (after the budget step). */
  campaignId: string | null;
  completed: WizardStep[];
  targetActionType: TargetActionType;
}

export type WizardEvent =
  | { type: 'HYDRATE'; campaign: CampaignDetail; step?: WizardStep }
  | { type: 'STEP_COMPLETED'; step: WizardStep; campaignId?: string }
  | { type: 'SET_TARGET'; targetActionType: TargetActionType }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'GOTO'; step: WizardStep };

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

export const initialWizardState: WizardState = {
  step: 'details',
  campaignId: null,
  completed: [],
  targetActionType: 'video_view',
};

/** Creatives are only mandatory for video campaigns (API: CAMPAIGN_HAS_NO_ADS). */
export function creativeRequired(targetActionType: TargetActionType): boolean {
  return targetActionType === 'video_view';
}

/** Which steps an existing campaign already satisfies. */
export function deriveCompletedSteps(campaign: CampaignDetail): WizardStep[] {
  const completed: WizardStep[] = ['details', 'budget'];
  if (campaign.ads.length > 0 || !creativeRequired(campaign.targetActionType)) completed.push('creative');
  return completed;
}

/** A step is reachable when every previous step is complete (creatives need the server draft). */
export function canNavigateTo(state: WizardState, step: WizardStep): boolean {
  const target = stepIndex(step);
  if (target === 0) return true;
  if (target >= stepIndex('creative') && !state.campaignId) return false;
  for (let i = 0; i < target; i += 1) {
    if (!state.completed.includes(WIZARD_STEPS[i])) return false;
  }
  return true;
}

function nextStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, stepIndex(step) + 1)];
}

function previousStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.max(0, stepIndex(step) - 1)];
}

function addCompleted(completed: WizardStep[], step: WizardStep): WizardStep[] {
  return completed.includes(step) ? completed : [...completed, step];
}

export function wizardReducer(state: WizardState, event: WizardEvent): WizardState {
  switch (event.type) {
    case 'HYDRATE': {
      const completed = deriveCompletedSteps(event.campaign);
      const hydrated: WizardState = {
        step: state.step,
        campaignId: event.campaign.id,
        completed,
        targetActionType: event.campaign.targetActionType,
      };
      const requested = event.step ?? state.step;
      return { ...hydrated, step: canNavigateTo(hydrated, requested) ? requested : firstIncomplete(hydrated) };
    }
    case 'SET_TARGET':
      return { ...state, targetActionType: event.targetActionType };
    case 'STEP_COMPLETED': {
      const next: WizardState = {
        ...state,
        campaignId: event.campaignId ?? state.campaignId,
        completed: addCompleted(state.completed, event.step),
      };
      return { ...next, step: nextStep(event.step) };
    }
    case 'NEXT': {
      const target = nextStep(state.step);
      return canNavigateTo(state, target) ? { ...state, step: target } : state;
    }
    case 'BACK':
      return { ...state, step: previousStep(state.step) };
    case 'GOTO':
      return canNavigateTo(state, event.step) ? { ...state, step: event.step } : state;
    default:
      return state;
  }
}

export function firstIncomplete(state: WizardState): WizardStep {
  for (const step of WIZARD_STEPS) {
    if (!state.completed.includes(step)) return canNavigateTo(state, step) ? step : 'details';
  }
  return 'review';
}

export function isWizardStep(value: string | null | undefined): value is WizardStep {
  return !!value && (WIZARD_STEPS as readonly string[]).includes(value);
}
