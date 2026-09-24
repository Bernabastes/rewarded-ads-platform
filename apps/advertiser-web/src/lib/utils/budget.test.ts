import { PLATFORM_DEFAULTS } from '@rap/shared';
import { describe, expect, it } from 'vitest';
import { computeBudgetSplit } from './budget';

describe('computeBudgetSplit', () => {
  it('splits each action between the viewer and the platform using the default take rate', () => {
    const split = computeBudgetSplit(5_000, 2);
    expect(split.rewardEtb).toBe(1);
    expect(split.platformFeeEtb).toBe(1);
    expect(split.rewardCoins).toBe(100);
    expect(split.takeRate).toBe(PLATFORM_DEFAULTS.PLATFORM_TAKE_RATE);
    expect(split.estimatedCompletions).toBe(2_500);
    expect(split.totalToUsersEtb).toBe(2_500);
    expect(split.totalPlatformEtb).toBe(2_500);
  });

  it('rounds money to two decimals and uses whole completions', () => {
    const split = computeBudgetSplit(1_000, 2.5);
    expect(split.rewardEtb).toBe(1.25);
    expect(split.rewardCoins).toBe(125);
    expect(split.estimatedCompletions).toBe(400);

    const odd = computeBudgetSplit(100, 3);
    expect(odd.rewardEtb).toBe(1.5);
    expect(odd.estimatedCompletions).toBe(33);
    expect(odd.totalToUsersEtb).toBe(49.5);
    expect(odd.totalPlatformEtb).toBe(49.5);
  });

  it('avoids float drift for awkward prices', () => {
    const split = computeBudgetSplit(1_000, 0.7);
    expect(split.rewardEtb).toBe(0.35);
    expect(split.platformFeeEtb).toBe(0.35);
    expect(split.rewardCoins).toBe(35);
    expect(split.estimatedCompletions).toBe(1_428);
  });

  it('supports a custom take rate and coin ratio', () => {
    const split = computeBudgetSplit(1_000, 4, 0.25, 50);
    expect(split.rewardEtb).toBe(3);
    expect(split.platformFeeEtb).toBe(1);
    expect(split.rewardCoins).toBe(150);
  });

  it('returns zeros for empty or invalid input instead of NaN', () => {
    for (const [budget, cost] of [
      [Number.NaN, 2],
      [0, 2],
      [1_000, 0],
      [1_000, Number.NaN],
      [-5, -1],
    ]) {
      const split = computeBudgetSplit(budget, cost);
      expect(split.estimatedCompletions).toBe(0);
      expect(Number.isNaN(split.rewardEtb)).toBe(false);
      expect(split.totalToUsersEtb).toBe(0);
    }
  });
});
