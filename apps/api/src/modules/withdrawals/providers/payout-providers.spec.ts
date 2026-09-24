import { mockSecurity, testConfig } from '../../../testing/test-utils';
import { ChapaPayoutProvider } from './chapa-payout.provider';
import { mockPayoutStatus, type PayoutProvider } from './payout-provider';
import { PayoutProviderRegistry } from './payout-provider.registry';
import { TelebirrPayoutProvider } from './telebirr.provider';

describe('payout providers (mock mode)', () => {
  const config = testConfig({
    PAYOUTS_MOCK: 'true',
    PAYOUT_MOCK_PROCESSING_SECONDS: '5',
    PAYOUT_MOCK_FAILURE_RATE: '0.1',
  });

  it('telebirr and chapa run in labelled mock mode without credentials', async () => {
    const tb = new TelebirrPayoutProvider(config);
    const ch = new ChapaPayoutProvider(config);
    expect(tb.isMock).toBe(true);
    expect(ch.isMock).toBe(true);
    const r = await tb.initiatePayout('u1', 50, '+251911223344', { reference: 'w1' });
    expect(r.providerPayoutId).toMatch(/^MOCK-TB-/);
    expect(r.status).toBe('processing');
    const c = await ch.initiatePayout('u1', 50, '1000123456', {
      reference: 'w2',
      bankCode: '946',
      accountName: 'Abebe',
    });
    expect(c.providerPayoutId).toMatch(/^MOCK-CH-/);
  });

  it('mock status is processing first, then a deterministic final state', () => {
    const now = Date.now();
    const id = `MOCK-TB-${now}-ABCDEF`;
    expect(mockPayoutStatus(id, 5, 0.1, now + 1000).status).toBe('processing');
    const final = mockPayoutStatus(id, 5, 0.1, now + 10_000);
    expect(['completed', 'failed']).toContain(final.status);
    expect(mockPayoutStatus(id, 5, 0.1, now + 20_000).status).toBe(final.status);
    expect(mockPayoutStatus(id, 5, 0, now + 10_000).status).toBe('completed');
    expect(mockPayoutStatus(id, 5, 1, now + 10_000).status).toBe('failed');
    expect(mockPayoutStatus('garbage', 5, 0.1).status).toBe('failed');
  });

  it('real mode is selected only when credentials are present and PAYOUTS_MOCK=false', () => {
    const real = testConfig({
      PAYOUTS_MOCK: 'false',
      TELEBIRR_APP_ID: 'a',
      TELEBIRR_APP_KEY: 'b',
      TELEBIRR_SHORT_CODE: 'c',
      CHAPA_SECRET_KEY: 'k',
    });
    expect(new TelebirrPayoutProvider(real).isMock).toBe(false);
    expect(new ChapaPayoutProvider(real).isMock).toBe(false);
    const half = testConfig({ PAYOUTS_MOCK: 'false', TELEBIRR_APP_ID: 'a' });
    expect(new TelebirrPayoutProvider(half).isMock).toBe(true);
  });
});

describe('PayoutProviderRegistry failover', () => {
  const security = mockSecurity();
  const make = (
    name: string,
    methods: string[],
    impl: () => Promise<unknown>,
    available = true,
  ): PayoutProvider =>
    ({
      name,
      isMock: true,
      supportedMethods: methods,
      isAvailable: () => available,
      initiatePayout: jest.fn(impl),
      checkStatus: jest.fn(),
    }) as unknown as PayoutProvider;

  it('routes telebirr to the telebirr provider first and falls over to chapa on failure', async () => {
    const telebirr = make('telebirr', ['telebirr'], async () => {
      throw new Error('telebirr down');
    });
    const chapa = make('chapa', ['bank', 'telebirr', 'cbe_birr'], async () => ({
      providerPayoutId: 'CH-1',
      status: 'processing',
    }));
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    const { provider, result } = await registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', {
      reference: 'w1',
    });
    expect(provider.name).toBe('chapa');
    expect(result.providerPayoutId).toBe('CH-1');
    expect(telebirr.initiatePayout).toHaveBeenCalledTimes(1);
    expect(security.warn).toHaveBeenCalledWith(
      'payout.provider_failover',
      expect.objectContaining({ usedProvider: 'chapa', failedOver: ['telebirr'] }),
    );
  });

  it('uses the primary provider when it works', async () => {
    const telebirr = make('telebirr', ['telebirr'], async () => ({
      providerPayoutId: 'TB-1',
      status: 'processing',
    }));
    const chapa = make('chapa', ['bank', 'telebirr'], async () => ({
      providerPayoutId: 'CH-1',
      status: 'processing',
    }));
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    const { provider } = await registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', {
      reference: 'w1',
    });
    expect(provider.name).toBe('telebirr');
    expect(chapa.initiatePayout).not.toHaveBeenCalled();
  });

  it('skips unavailable providers and fails when none can pay', async () => {
    const telebirr = make(
      'telebirr',
      ['telebirr'],
      async () => ({ providerPayoutId: 'x', status: 'processing' }),
      false,
    );
    const chapa = make('chapa', ['bank', 'telebirr'], async () => {
      throw new Error('chapa 500');
    });
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    expect(registry.isMethodAvailable('telebirr')).toBe(true);
    await expect(
      registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', { reference: 'w1' }),
    ).rejects.toThrow('chapa 500');
    expect(telebirr.initiatePayout).not.toHaveBeenCalled();
    expect(registry.providersFor('bank').map((p) => p.name)).toEqual(['chapa']);
    expect(new PayoutProviderRegistry([telebirr], security).isMethodAvailable('bank')).toBe(false);
  });
});
