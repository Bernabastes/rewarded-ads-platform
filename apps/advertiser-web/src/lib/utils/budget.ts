import { computePlatformRevenueEtb, computeRewardEtb, etbToCoins, PLATFORM_DEFAULTS, roundEtb } from '@rap/shared';

export interface BudgetSplit {
  costPerActionEtb: number;
  /** What the viewer receives per valid action. */
  rewardEtb: number;
  rewardCoins: number;
  /** Platform fee per valid action. */
  platformFeeEtb: number;
  takeRate: number;
  /** Whole completions the budget can pay for. */
  estimatedCompletions: number;
  totalToUsersEtb: number;
  totalPlatformEtb: number;
}

/**
 * Transparent budget economics shown in the wizard: the advertiser pays `costPerActionEtb` for every valid
 * action; the platform keeps `takeRate`; the viewer receives the rest as coins.
 */
export function computeBudgetSplit(
  budgetEtb: number,
  costPerActionEtb: number,
  takeRate: number = PLATFORM_DEFAULTS.PLATFORM_TAKE_RATE,
  coinsPerEtb: number = PLATFORM_DEFAULTS.COINS_PER_ETB,
): BudgetSplit {
  const safeBudget = Number.isFinite(budgetEtb) && budgetEtb > 0 ? budgetEtb : 0;
  const safeCost = Number.isFinite(costPerActionEtb) && costPerActionEtb > 0 ? costPerActionEtb : 0;
  const rewardEtb = safeCost > 0 ? computeRewardEtb(safeCost, takeRate) : 0;
  const platformFeeEtb = safeCost > 0 ? computePlatformRevenueEtb(safeCost, takeRate) : 0;
  const estimatedCompletions = safeCost > 0 ? Math.floor(roundEtb(safeBudget) / safeCost) : 0;
  return {
    costPerActionEtb: safeCost,
    rewardEtb,
    rewardCoins: rewardEtb > 0 ? etbToCoins(rewardEtb, coinsPerEtb) : 0,
    platformFeeEtb,
    takeRate,
    estimatedCompletions,
    totalToUsersEtb: roundEtb(estimatedCompletions * rewardEtb),
    totalPlatformEtb: roundEtb(estimatedCompletions * platformFeeEtb),
  };
}
