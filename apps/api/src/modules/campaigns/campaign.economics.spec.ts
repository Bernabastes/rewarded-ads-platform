import { Prisma } from '@prisma/client';
import {
  computePlatformRevenue,
  computeRewardPerAction,
  isBudgetExhausted,
  remainingActions,
  rewardCoins,
} from './campaign.economics';

const D = (n: number | string) => new Prisma.Decimal(n);

describe('campaign economics', () => {
  it('splits cost per action between user reward and platform revenue at the take rate', () => {
    expect(computeRewardPerAction(2, 0.5).toString()).toBe('1');
    expect(computePlatformRevenue(2, 0.5).toString()).toBe('1');
    expect(computeRewardPerAction(3.33, 0.5).toString()).toBe('1.67');
    expect(computePlatformRevenue(3.33, 0.5).toString()).toBe('1.66');
    expect(computeRewardPerAction(10, 0.3).toString()).toBe('7');
    expect(computeRewardPerAction('0.50', 0.5).toString()).toBe('0.25');
  });

  it('reward + revenue always equals the advertiser cost', () => {
    for (const cost of [0.5, 1, 1.99, 2.5, 7.77, 100]) {
      for (const rate of [0.3, 0.5, 0.6]) {
        expect(
          computeRewardPerAction(cost, rate).plus(computePlatformRevenue(cost, rate)).toNumber(),
        ).toBeCloseTo(cost, 10);
      }
    }
  });

  it('rejects impossible take rates', () => {
    expect(() => computeRewardPerAction(2, 1)).toThrow();
    expect(() => computeRewardPerAction(2, -0.1)).toThrow();
  });

  it('converts reward ETB to whole coins', () => {
    expect(rewardCoins(D('1.00'), 100)).toBe(100);
    expect(rewardCoins(D('1.67'), 100)).toBe(167);
    expect(rewardCoins(D('0.25'), 100)).toBe(25);
    expect(rewardCoins(D('1.005'), 100)).toBe(101);
  });

  it('computes remaining actions and budget exhaustion', () => {
    expect(remainingActions(D(5000), D(0), D(2))).toBe(2500);
    expect(remainingActions(D(5000), D(4999), D(2))).toBe(0);
    expect(remainingActions(D(5000), D(4998), D(2))).toBe(1);
    expect(isBudgetExhausted(D(5000), D(4998), D(2))).toBe(false);
    expect(isBudgetExhausted(D(5000), D(4999), D(2))).toBe(true);
    expect(isBudgetExhausted(D(5000), D(5000), D(2))).toBe(true);
  });
});
