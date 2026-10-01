import { Prisma } from '@prisma/client';

/**
 * Campaign economics (pure, unit-tested):
 *   advertiser pays cost_per_action per valid action
 *   user receives reward_per_action = cost * (1 - takeRate)   (rounded to 2 decimals, converted to coins)
 *   platform keeps the difference
 * The take rate is snapshotted on the campaign so later config changes never alter live campaigns.
 */
export function computeRewardPerAction(
  costPerActionEtb: Prisma.Decimal | number | string,
  takeRate: number,
): Prisma.Decimal {
  if (takeRate < 0 || takeRate >= 1) throw new Error('takeRate must be in [0, 1)');
  return new Prisma.Decimal(costPerActionEtb)
    .mul(1 - takeRate)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function computePlatformRevenue(
  costPerActionEtb: Prisma.Decimal | number | string,
  takeRate: number,
): Prisma.Decimal {
  return new Prisma.Decimal(costPerActionEtb).minus(computeRewardPerAction(costPerActionEtb, takeRate));
}

export function rewardCoins(
  rewardPerActionEtb: Prisma.Decimal | number | string,
  coinsPerEtb: number,
): number {
  return new Prisma.Decimal(rewardPerActionEtb).mul(coinsPerEtb).round().toNumber();
}

/** How many more valid actions a campaign can afford. */
export function remainingActions(
  budgetEtb: Prisma.Decimal,
  spentEtb: Prisma.Decimal,
  costPerActionEtb: Prisma.Decimal,
): number {
  if (costPerActionEtb.lte(0)) return 0;
  return Math.max(0, budgetEtb.minus(spentEtb).div(costPerActionEtb).floor().toNumber());
}

export function isBudgetExhausted(
  budgetEtb: Prisma.Decimal,
  spentEtb: Prisma.Decimal,
  costPerActionEtb: Prisma.Decimal,
): boolean {
  return budgetEtb.minus(spentEtb).lessThan(costPerActionEtb);
}

/**
 * Wallet idempotency keys for a campaign's budget lifecycle. Every submission cycle has its own `seq`
 * (`campaigns.submission_seq`, incremented atomically on submit), so a reservation that was refunded after a
 * rejection can never be replayed by a later resubmission (security audit #1).
 */
export const reservationKey = (campaignId: string, seq: number) => `campaign_budget_reservation:${campaignId}:${seq}`;
export const refundKey = (campaignId: string, seq: number, reason: string) =>
  `campaign_budget_refund:${campaignId}:${seq}:${reason}`;
