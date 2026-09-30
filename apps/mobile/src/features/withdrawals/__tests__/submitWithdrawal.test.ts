import type { CreateWithdrawalDto, WithdrawalItem } from '@rap/shared';
import { ErrorCode } from '@rap/shared';

import { ApiError } from '@/api/errors';
import { createIntentKeys, matchesIntent, submitWithdrawal, type SubmitWithdrawalDeps } from '../submitWithdrawal';
import { kycProjection } from '../validation';

const dto: CreateWithdrawalDto = { amountEtb: 50, payoutMethod: 'telebirr', payoutDestination: '+251977200002' };

const item = (overrides: Partial<WithdrawalItem> = {}): WithdrawalItem => ({
  id: 'w-1',
  userId: 'u-1',
  amountEtb: 50,
  coinAmount: 5000,
  payoutMethod: 'telebirr',
  payoutDestination: '+2519****0002',
  destinationName: null,
  destinationAccountName: 'Fikru Desta',
  destinationVerifiedAt: '2026-09-29T14:31:41.229Z',
  status: 'flagged_for_review',
  reviewReasons: ['first_withdrawal'],
  requiresDualApproval: false,
  approvalsCount: 0,
  failureReason: null,
  providerName: null,
  providerPayoutId: null,
  requestedAt: '2026-09-29T14:32:00.000Z',
  processedAt: null,
  updatedAt: '2026-09-29T14:32:00.000Z',
  ...overrides,
});

const conflict = (inProgress: boolean) =>
  new ApiError(409, ErrorCode.IDEMPOTENCY_KEY_REUSED, 'reused', { key: 'k1', inProgress });

function deps(overrides: Partial<SubmitWithdrawalDeps> = {}): SubmitWithdrawalDeps & { create: jest.Mock; listRecent: jest.Mock } {
  return {
    create: jest.fn(async () => item()),
    listRecent: jest.fn(async () => [] as WithdrawalItem[]),
    newKey: () => 'fresh-key',
    sleep: async () => undefined,
    now: () => new Date('2026-09-29T14:31:50.000Z').getTime(),
    ...overrides,
  } as never;
}

describe('submitWithdrawal (idempotency protocol)', () => {
  it('posts once with the given Idempotency-Key', async () => {
    const d = deps();
    const result = await submitWithdrawal(d, dto, 'k1');
    expect(result).toMatchObject({ outcome: 'created', key: 'k1' });
    expect(d.create).toHaveBeenCalledWith(dto, 'k1');
  });

  it('polls the list instead of re-posting when the first request is still in progress', async () => {
    const d = deps({
      create: jest.fn(async () => {
        throw conflict(true);
      }),
      listRecent: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([item({ id: 'w-found' })]),
    });
    const result = await submitWithdrawal(d, dto, 'k1');
    expect(result).toEqual({ outcome: 'found_in_progress', item: expect.objectContaining({ id: 'w-found' }), key: 'k1' });
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(d.listRecent).toHaveBeenCalledTimes(2);
  });

  it('gives up polling after the budget and rethrows the conflict', async () => {
    const d = deps({
      create: jest.fn(async () => {
        throw conflict(true);
      }),
      pollAttempts: 2,
    });
    await expect(submitWithdrawal(d, dto, 'k1')).rejects.toMatchObject({ code: ErrorCode.IDEMPOTENCY_KEY_REUSED });
    expect(d.listRecent).toHaveBeenCalledTimes(2);
  });

  it('retries once with a fresh key when the old key was used with a different payload', async () => {
    const d = deps({
      create: jest
        .fn()
        .mockRejectedValueOnce(conflict(false))
        .mockResolvedValueOnce(item({ id: 'w-2' })),
    });
    const result = await submitWithdrawal(d, dto, 'stale');
    expect(result).toMatchObject({ outcome: 'created', key: 'fresh-key', item: { id: 'w-2' } });
    expect(d.create).toHaveBeenNthCalledWith(1, dto, 'stale');
    expect(d.create).toHaveBeenNthCalledWith(2, dto, 'fresh-key');
  });

  it('rethrows every other error untouched (4xx are not memoised, the key stays valid)', async () => {
    const d = deps({
      create: jest.fn(async () => {
        throw new ApiError(422, ErrorCode.KYC_REQUIRED, 'kyc', { projectedEtb: 1050, thresholdEtb: 1000 });
      }),
    });
    await expect(submitWithdrawal(d, dto, 'k1')).rejects.toMatchObject({ code: ErrorCode.KYC_REQUIRED });
    expect(d.listRecent).not.toHaveBeenCalled();
  });

  it('matches a listed item to the intent by amount, method and recency', () => {
    const started = new Date('2026-09-29T14:31:50.000Z').getTime();
    expect(matchesIntent(item(), dto, started)).toBe(true);
    expect(matchesIntent(item({ amountEtb: 75 }), dto, started)).toBe(false);
    expect(matchesIntent(item({ requestedAt: '2026-09-01T00:00:00.000Z' }), dto, started)).toBe(false);
  });
});

describe('createIntentKeys', () => {
  it('reuses the key while the payload is unchanged and rotates it when the intent changes', () => {
    let n = 0;
    const keys = createIntentKeys(() => `key-${++n}`);
    const first = keys.keyFor(dto, 1000);
    expect(first).toEqual({ key: 'key-1', startedAt: 1000 });
    expect(keys.keyFor({ ...dto }, 2000)).toEqual({ key: 'key-1', startedAt: 1000 });
    expect(keys.keyFor({ ...dto, amountEtb: 60 }, 3000)).toEqual({ key: 'key-2', startedAt: 3000 });
    keys.replaceKey('server-picked');
    expect(keys.keyFor({ ...dto, amountEtb: 60 }).key).toBe('server-picked');
    keys.reset();
    expect(keys.keyFor({ ...dto, amountEtb: 60 }).key).toBe('key-3');
  });
});

describe('kycProjection', () => {
  const config = { kycTier: 'phone_only' as const, kycRequiredAboveMonthlyEtb: 1000, monthlyPayoutTotalEtb: 900 };

  it('flags a phone-only request that would reach or cross the rolling monthly limit (inclusive boundary, mirrors the API)', () => {
    expect(kycProjection(config, 150)).toMatchObject({ projectedEtb: 1050, exceeds: true, progress: 0.9 });
    expect(kycProjection(config, 100)).toMatchObject({ projectedEtb: 1000, exceeds: true });
    expect(kycProjection(config, 99.99)).toMatchObject({ projectedEtb: 999.99, exceeds: false });
    expect(kycProjection({ ...config, monthlyPayoutTotalEtb: 0 }, 1000).exceeds).toBe(true);
    expect(kycProjection(config, null).exceeds).toBe(false);
  });

  it('never flags id_verified users', () => {
    expect(kycProjection({ ...config, kycTier: 'id_verified' }, 5000).exceeds).toBe(false);
  });
});
