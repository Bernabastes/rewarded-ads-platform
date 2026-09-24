import { WithdrawalStatus } from '@rap/shared';

import {
  maxWithdrawableEtb,
  methodRequiresName,
  normalizeDestination,
  parseAmount,
  quickAmounts,
  validateAmount,
  validateDestination,
} from '../validation';
import { buildTimeline } from '../WithdrawalTimeline';

const config = { minWithdrawalEtb: 50, coinsPerEtb: 100, largeWithdrawalThresholdEtb: 500 };

describe('withdrawal amount validation', () => {
  it('parses friendly input', () => {
    expect(parseAmount('50')).toBe(50);
    expect(parseAmount('50.5')).toBe(50.5);
    expect(parseAmount('1,250.00')).toBe(1250);
    expect(parseAmount('1 250')).toBe(1250);
    expect(parseAmount('ETB 75')).toBe(75);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('.')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
  });

  it('computes the maximum withdrawable amount from coins', () => {
    expect(maxWithdrawableEtb(12345, 100)).toBe(123.45);
    expect(maxWithdrawableEtb(0, 100)).toBe(0);
  });

  it('rejects invalid, below-minimum and insufficient amounts', () => {
    expect(validateAmount('abc', 10_000, config)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(validateAmount('49.99', 10_000, config)).toMatchObject({ ok: false, reason: 'below_min', amountEtb: 49.99 });
    expect(validateAmount('100.01', 10_000, config)).toMatchObject({ ok: false, reason: 'insufficient', maxEtb: 100 });
  });

  it('accepts valid amounts and flags large ones', () => {
    expect(validateAmount('75', 10_000, config)).toEqual({ ok: true, amountEtb: 75, coins: 7500, isLarge: false });
    expect(validateAmount('500', 100_000, config)).toEqual({ ok: true, amountEtb: 500, coins: 50_000, isLarge: true });
    expect(validateAmount('100', 10_000, config)).toMatchObject({ ok: true, coins: 10_000 });
  });

  it('handles a non-default coin rate', () => {
    expect(validateAmount('60', 3000, { ...config, coinsPerEtb: 50 })).toEqual({ ok: true, amountEtb: 60, coins: 3000, isLarge: false });
  });
});

describe('destination validation', () => {
  it('validates Ethiopian phone numbers for mobile-money methods', () => {
    expect(validateDestination('phone', '0911 000 000')).toBe(true);
    expect(validateDestination('phone', '+251911000000')).toBe(true);
    expect(validateDestination('phone', '911000000')).toBe(true);
    expect(validateDestination('phone', '12345')).toBe(false);
    expect(normalizeDestination('phone', '0911 000 000')).toBe('+251911000000');
  });

  it('validates bank account numbers', () => {
    expect(validateDestination('bank_account', '1000 1234 5678')).toBe(true);
    expect(validateDestination('bank_account', '123')).toBe(false);
    expect(validateDestination('bank_account', 'ABC123456')).toBe(false);
    expect(normalizeDestination('bank_account', '1000 1234-5678')).toBe('100012345678');
  });

  it('requires a holder name only for bank transfers', () => {
    expect(methodRequiresName('bank')).toBe(true);
    expect(methodRequiresName('telebirr')).toBe(false);
    expect(methodRequiresName('cbe_birr')).toBe(false);
  });
});

describe('quickAmounts', () => {
  it('offers the minimum, round steps and "all" within the balance', () => {
    expect(quickAmounts(config, 123.45)).toEqual([50, 100, 123.45]);
    expect(quickAmounts(config, 40)).toEqual([]);
    expect(quickAmounts(config, 1000)).toEqual([50, 100, 200, 500]);
  });
});

describe('buildTimeline', () => {
  const base = { reviewReasons: [] as string[], requiresDualApproval: false };
  const keys = (status: WithdrawalStatus, extra: Partial<typeof base> = {}) =>
    buildTimeline({ status, ...base, ...extra }).map((s) => `${s.key}:${s.state}`);

  it('shows the review step while under review and afterwards when it happened', () => {
    expect(keys(WithdrawalStatus.flagged_for_review)).toEqual([
      'requested:done',
      'review:active',
      'queued:upcoming',
      'sending:upcoming',
      'completed:upcoming',
    ]);
    expect(keys(WithdrawalStatus.processing, { reviewReasons: ['first_withdrawal'] })).toEqual([
      'requested:done',
      'review:done',
      'queued:done',
      'sending:active',
      'completed:upcoming',
    ]);
  });

  it('skips the review step for auto-processed requests', () => {
    expect(keys(WithdrawalStatus.pending)).toEqual(['requested:done', 'queued:active', 'sending:upcoming', 'completed:upcoming']);
    expect(keys(WithdrawalStatus.completed)).toEqual(['requested:done', 'queued:done', 'sending:done', 'completed:done']);
  });

  it('ends with a failed / rejected step (coins refunded)', () => {
    expect(keys(WithdrawalStatus.failed).at(-1)).toBe('failed:failed');
    expect(keys(WithdrawalStatus.rejected)).toEqual(['requested:done', 'review:done', 'rejected:failed']);
  });
});
