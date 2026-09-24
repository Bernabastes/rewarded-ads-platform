import type { CampaignDetail } from '@rap/shared';
import { describe, expect, it } from 'vitest';
import { campaignDetailFixture, draftCampaignFixture } from '@/test/mocks/fixtures';
import {
  canNavigateTo,
  creativeRequired,
  deriveCompletedSteps,
  firstIncomplete,
  initialWizardState,
  isWizardStep,
  wizardReducer,
  WIZARD_STEPS,
  type WizardState,
} from './machine';

const emptyDraft: CampaignDetail = { ...draftCampaignFixture, ads: [] };

describe('wizard machine', () => {
  it('orders steps details → budget → creative → review', () => {
    expect(WIZARD_STEPS).toEqual(['details', 'budget', 'creative', 'review']);
  });

  it('cannot jump ahead until previous steps are complete', () => {
    expect(canNavigateTo(initialWizardState, 'details')).toBe(true);
    expect(canNavigateTo(initialWizardState, 'budget')).toBe(false);
    expect(canNavigateTo(initialWizardState, 'creative')).toBe(false);
    expect(wizardReducer(initialWizardState, { type: 'GOTO', step: 'review' })).toEqual(initialWizardState);
    expect(wizardReducer(initialWizardState, { type: 'NEXT' })).toEqual(initialWizardState);
  });

  it('advances as steps complete and requires a server draft before creatives', () => {
    let state = wizardReducer(initialWizardState, { type: 'STEP_COMPLETED', step: 'details' });
    expect(state.step).toBe('budget');
    expect(canNavigateTo(state, 'creative')).toBe(false);

    state = wizardReducer(state, { type: 'STEP_COMPLETED', step: 'budget', campaignId: 'camp-1' });
    expect(state.step).toBe('creative');
    expect(state.campaignId).toBe('camp-1');
    expect(canNavigateTo(state, 'creative')).toBe(true);
    expect(canNavigateTo(state, 'review')).toBe(false);

    state = wizardReducer(state, { type: 'STEP_COMPLETED', step: 'creative' });
    expect(state.step).toBe('review');
    expect(state.completed).toEqual(['details', 'budget', 'creative']);
  });

  it('BACK never goes before the first step and GOTO respects completion', () => {
    const state: WizardState = {
      step: 'details',
      campaignId: null,
      completed: [],
      targetActionType: 'video_view',
    };
    expect(wizardReducer(state, { type: 'BACK' }).step).toBe('details');
    const later: WizardState = {
      ...state,
      step: 'review',
      campaignId: 'c',
      completed: ['details', 'budget', 'creative'],
    };
    expect(wizardReducer(later, { type: 'BACK' }).step).toBe('creative');
    expect(wizardReducer(later, { type: 'GOTO', step: 'budget' }).step).toBe('budget');
  });

  it('derives completed steps from an existing campaign', () => {
    expect(deriveCompletedSteps(campaignDetailFixture)).toEqual(['details', 'budget', 'creative']);
    expect(deriveCompletedSteps(emptyDraft)).toEqual(['details', 'budget']);
    expect(deriveCompletedSteps({ ...emptyDraft, targetActionType: 'survey' })).toEqual([
      'details',
      'budget',
      'creative',
    ]);
  });

  it('hydrates from a campaign and lands on the requested or first incomplete step', () => {
    const hydrated = wizardReducer(initialWizardState, {
      type: 'HYDRATE',
      campaign: emptyDraft,
      step: 'review',
    });
    expect(hydrated.campaignId).toBe(emptyDraft.id);
    // review is not reachable without a creative on a video campaign → first incomplete step
    expect(hydrated.step).toBe('creative');

    const withAds = wizardReducer(initialWizardState, {
      type: 'HYDRATE',
      campaign: campaignDetailFixture,
      step: 'review',
    });
    expect(withAds.step).toBe('review');
    expect(firstIncomplete(withAds)).toBe('review');
  });

  it('only video campaigns require a creative', () => {
    expect(creativeRequired('video_view')).toBe(true);
    expect(creativeRequired('survey')).toBe(false);
    expect(creativeRequired('app_install')).toBe(false);
  });

  it('validates step names from the URL', () => {
    expect(isWizardStep('budget')).toBe(true);
    expect(isWizardStep('nope')).toBe(false);
    expect(isWizardStep(null)).toBe(false);
  });
});
