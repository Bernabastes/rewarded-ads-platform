import type { Job } from 'bullmq';
import { mockQueue, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { MAX_CONSECUTIVE_STATUS_ERRORS, PayoutProcessor } from './payout.processor';
import { type PayoutProvider, PayoutProviderError } from './providers/payout-provider';
import { PayoutProviderRegistry } from './providers/payout-provider.registry';

const WD = uuid(20);

function provider(name: string, impl: Partial<Record<'initiatePayout' | 'checkStatus' | 'findByReference', jest.Mock>> = {}) {
  return {
    name,
    isMock: false,
    supportedMethods: name === 'telebirr' ? ['telebirr'] : ['bank', 'telebirr', 'cbe_birr'],
    isAvailable: () => true,
    initiatePayout: jest.fn(async () => ({ providerPayoutId: `${name}-1`, status: 'processing' })),
    checkStatus: jest.fn(async () => ({ status: 'processing' })),
    findByReference: jest.fn(async () => null),
    resolveAccount: jest.fn(),
    ...impl,
  } as unknown as PayoutProvider & Record<'initiatePayout' | 'checkStatus' | 'findByReference', jest.Mock>;
}

/**
 * Security audit #7: the worker must never refund (or pay twice) while a transfer may be in flight.
 */
describe('PayoutProcessor (ambiguous partner outcomes)', () => {
  let withdrawals: Record<string, jest.Mock>;
  let queue: ReturnType<typeof mockQueue>;
  const config = testConfig({ PAYOUT_MAX_POLLS: 3, PAYOUT_STATUS_POLL_SECONDS: 0 });
  const w = { id: WD, userId: uuid(1), payoutMethod: 'telebirr', amountEtb: 50, payoutDestination: '+251911223344', destinationName: null, bankCode: null };

  const build = (providers: PayoutProvider[]) => {
    withdrawals = {
      markProcessing: jest.fn(async () => ({ ...w })),
      findProcessingWithoutProvider: jest.fn(async () => null),
      setProvider: jest.fn(),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
      markNeedsManualReview: jest.fn(),
    };
    queue = mockQueue();
    return new PayoutProcessor(withdrawals as never, new PayoutProviderRegistry(providers, mockSecurity()), config, queue);
  };
  const job = (data: Record<string, unknown>) => ({ data } as unknown as Job<never>);

  it('definitive failure of every provider -> markFailed (refund is safe: nothing was sent)', async () => {
    const tb = provider('telebirr', { initiatePayout: jest.fn(async () => { throw new PayoutProviderError('invalid msisdn', 'definitive', 'telebirr', 400); }) });
    const ch = provider('chapa', { initiatePayout: jest.fn(async () => { throw new PayoutProviderError('refused', 'definitive', 'chapa'); }) });
    await build([tb, ch]).initiate(job({ withdrawalId: WD }));
    expect(withdrawals.markFailed).toHaveBeenCalledWith(WD, expect.stringMatching(/All payout providers failed/));
    expect(withdrawals.markNeedsManualReview).not.toHaveBeenCalled();
  });

  it('timeout on the primary + partner has no record -> fails over to chapa and polls chapa', async () => {
    const tb = provider('telebirr', { initiatePayout: jest.fn(async () => { throw new PayoutProviderError('timeout', 'ambiguous', 'telebirr'); }) });
    const ch = provider('chapa');
    await build([tb, ch]).initiate(job({ withdrawalId: WD }));
    expect(tb.findByReference).toHaveBeenCalledWith(WD);
    expect(ch.initiatePayout).toHaveBeenCalledTimes(1);
    expect(withdrawals.setProvider).toHaveBeenCalledWith(WD, 'chapa', 'chapa-1', expect.anything());
    expect(queue.add).toHaveBeenCalledWith('poll', expect.objectContaining({ providerName: 'chapa', payoutId: 'chapa-1' }), expect.anything());
    expect(withdrawals.markFailed).not.toHaveBeenCalled();
  });

  it('timeout on the primary + partner HAS the transfer -> keeps the primary, no second payout, no refund', async () => {
    const tb = provider('telebirr', {
      initiatePayout: jest.fn(async () => { throw new PayoutProviderError('timeout', 'ambiguous', 'telebirr'); }),
      findByReference: jest.fn(async () => ({ providerPayoutId: 'TB-77', status: 'processing' })),
    });
    const ch = provider('chapa');
    await build([tb, ch]).initiate(job({ withdrawalId: WD }));
    expect(ch.initiatePayout).not.toHaveBeenCalled();
    expect(withdrawals.setProvider).toHaveBeenCalledWith(WD, 'telebirr', 'TB-77', expect.anything());
    expect(queue.add).toHaveBeenCalledWith('poll', expect.objectContaining({ providerName: 'telebirr', payoutId: 'TB-77' }), expect.anything());
    expect(withdrawals.markFailed).not.toHaveBeenCalled();
  });

  it('timeout + lookup also fails -> needs_manual_review (coins stay held), chapa never tried', async () => {
    const tb = provider('telebirr', {
      initiatePayout: jest.fn(async () => { throw new PayoutProviderError('timeout', 'ambiguous', 'telebirr'); }),
      findByReference: jest.fn(async () => { throw new PayoutProviderError('lookup timeout', 'ambiguous', 'telebirr'); }),
    });
    const ch = provider('chapa');
    await build([tb, ch]).initiate(job({ withdrawalId: WD }));
    expect(ch.initiatePayout).not.toHaveBeenCalled();
    expect(withdrawals.markNeedsManualReview).toHaveBeenCalledWith(WD, expect.stringMatching(/did not confirm/));
    expect(withdrawals.markFailed).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('a transfer that the partner already reports as completed via the lookup is marked completed', async () => {
    const tb = provider('telebirr', {
      initiatePayout: jest.fn(async () => { throw new PayoutProviderError('HTTP 502', 'ambiguous', 'telebirr', 502); }),
      findByReference: jest.fn(async () => ({ providerPayoutId: 'TB-done', status: 'completed', raw: { ok: true } })),
    });
    await build([tb, provider('chapa')]).initiate(job({ withdrawalId: WD }));
    expect(withdrawals.markCompleted).toHaveBeenCalledWith(WD, { ok: true });
  });

  it('poll give-up -> needs_manual_review, NOT a refund', async () => {
    const tb = provider('telebirr', { checkStatus: jest.fn(async () => ({ status: 'processing', raw: { still: true } })) });
    const processor = build([tb, provider('chapa')]);
    await processor.poll(job({ withdrawalId: WD, providerName: 'telebirr', payoutId: 'TB-1', polls: 2 })); // polls + 1 >= PAYOUT_MAX_POLLS (3)
    expect(withdrawals.markNeedsManualReview).toHaveBeenCalledWith(WD, expect.stringMatching(/stayed non-final after 3 polls/), { still: true });
    expect(withdrawals.markFailed).not.toHaveBeenCalled();
    // before the cap it just schedules the next poll
    withdrawals.markNeedsManualReview.mockClear();
    await processor.poll(job({ withdrawalId: WD, providerName: 'telebirr', payoutId: 'TB-1', polls: 0 }));
    expect(withdrawals.markNeedsManualReview).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('poll', expect.objectContaining({ polls: 1, statusErrors: 0 }), expect.anything());
  });

  it('status queries that keep failing -> retries, then needs_manual_review; a definitive provider "failed" still refunds', async () => {
    const tb = provider('telebirr', { checkStatus: jest.fn(async () => { throw new PayoutProviderError('timeout', 'ambiguous', 'telebirr'); }) });
    const processor = build([tb, provider('chapa')]);
    await processor.poll(job({ withdrawalId: WD, providerName: 'telebirr', payoutId: 'TB-1', polls: 0, statusErrors: 0 }));
    expect(queue.add).toHaveBeenCalledWith('poll', expect.objectContaining({ statusErrors: 1 }), expect.anything());
    await processor.poll(job({ withdrawalId: WD, providerName: 'telebirr', payoutId: 'TB-1', polls: 0, statusErrors: MAX_CONSECUTIVE_STATUS_ERRORS - 1 }));
    expect(withdrawals.markNeedsManualReview).toHaveBeenCalledWith(WD, expect.stringMatching(/status query kept failing/));
    expect(withdrawals.markFailed).not.toHaveBeenCalled();

    const failing = provider('telebirr', { checkStatus: jest.fn(async () => ({ status: 'failed', failureReason: 'account blocked' })) });
    await build([failing]).poll(job({ withdrawalId: WD, providerName: 'telebirr', payoutId: 'TB-1', polls: 0 }));
    expect(withdrawals.markFailed).toHaveBeenCalledWith(WD, 'account blocked', undefined);
  });

  it('an unregistered provider on poll -> needs_manual_review instead of a blind refund', async () => {
    await build([provider('chapa')]).poll(job({ withdrawalId: WD, providerName: 'telebirr', payoutId: 'TB-1', polls: 0 }));
    expect(withdrawals.markNeedsManualReview).toHaveBeenCalledWith(WD, expect.stringMatching(/no longer registered/));
    expect(withdrawals.markFailed).not.toHaveBeenCalled();
  });

  /* ---------------- Phase 5b New-2: only definitive failures refund; interrupted initiations resume safely ---------------- */

  it('REGRESSION New-2: an ambiguous failure of the LAST provider (lookup "not found") parks the withdrawal, it is not refunded', async () => {
    const tb = provider('telebirr', { initiatePayout: jest.fn(async () => { throw new PayoutProviderError('invalid msisdn', 'definitive', 'telebirr', 400); }) });
    const ch = provider('chapa', { initiatePayout: jest.fn(async () => { throw new PayoutProviderError('HTTP 504', 'ambiguous', 'chapa', 504); }) });
    await build([tb, ch]).initiate(job({ withdrawalId: WD }));
    expect(withdrawals.markNeedsManualReview).toHaveBeenCalledWith(WD, expect.stringMatching(/did not confirm/));
    expect(withdrawals.markFailed).not.toHaveBeenCalled();
  });

  it('New-2: an unexpected (non-provider) error during initiation -> needs_manual_review, never markFailed', async () => {
    const tb = provider('telebirr', { initiatePayout: jest.fn(async () => { throw new TypeError('Cannot read properties of undefined'); }) });
    await build([tb]).initiate(job({ withdrawalId: WD }));
    expect(withdrawals.markNeedsManualReview).toHaveBeenCalledWith(WD, expect.stringMatching(/unexpected error|did not confirm/));
    expect(withdrawals.markFailed).not.toHaveBeenCalled();
  });

  describe('retry of an interrupted initiation (processing without a partner)', () => {
    const retryJob = { data: { withdrawalId: WD }, attemptsMade: 1 } as unknown as Job<never>;

    it('adopts the transfer when a partner already holds our reference (no second payout)', async () => {
      const tb = provider('telebirr', { findByReference: jest.fn(async () => ({ providerPayoutId: 'TB-55', status: 'processing' })) });
      const ch = provider('chapa');
      const processor = build([tb, ch]);
      withdrawals.markProcessing.mockResolvedValue(null);
      withdrawals.findProcessingWithoutProvider = jest.fn(async () => ({ ...w }));
      await processor.initiate(retryJob);
      expect(tb.initiatePayout).not.toHaveBeenCalled();
      expect(ch.initiatePayout).not.toHaveBeenCalled();
      expect(withdrawals.setProvider).toHaveBeenCalledWith(WD, 'telebirr', 'TB-55', expect.anything());
      expect(queue.add).toHaveBeenCalledWith('poll', expect.objectContaining({ providerName: 'telebirr', payoutId: 'TB-55' }), expect.anything());
    });

    it('sends normally when every partner explicitly answers "not found"', async () => {
      const tb = provider('telebirr');
      const processor = build([tb, provider('chapa')]);
      withdrawals.markProcessing.mockResolvedValue(null);
      withdrawals.findProcessingWithoutProvider = jest.fn(async () => ({ ...w }));
      await processor.initiate(retryJob);
      expect(tb.findByReference).toHaveBeenCalledWith(WD);
      expect(tb.initiatePayout).toHaveBeenCalledTimes(1);
      expect(withdrawals.setProvider).toHaveBeenCalledWith(WD, 'telebirr', 'telebirr-1', expect.anything());
    });

    it('parks for manual review when a partner cannot tell whether the transfer exists', async () => {
      const tb = provider('telebirr', { findByReference: jest.fn(async () => { throw new PayoutProviderError('lookup timeout', 'ambiguous', 'telebirr'); }) });
      const processor = build([tb, provider('chapa')]);
      withdrawals.markProcessing.mockResolvedValue(null);
      withdrawals.findProcessingWithoutProvider = jest.fn(async () => ({ ...w }));
      await processor.initiate(retryJob);
      expect(tb.initiatePayout).not.toHaveBeenCalled();
      expect(withdrawals.markNeedsManualReview).toHaveBeenCalledWith(WD, expect.stringMatching(/interrupted/));
      expect(withdrawals.markFailed).not.toHaveBeenCalled();
    });

    it('does nothing when the withdrawal is neither pending nor stuck', async () => {
      const tb = provider('telebirr');
      const processor = build([tb]);
      withdrawals.markProcessing.mockResolvedValue(null);
      withdrawals.findProcessingWithoutProvider = jest.fn(async () => null);
      await processor.initiate(retryJob);
      expect(tb.initiatePayout).not.toHaveBeenCalled();
      expect(withdrawals.markNeedsManualReview).not.toHaveBeenCalled();
    });
  });
});
