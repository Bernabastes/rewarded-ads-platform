import { mockSecurity, testConfig } from '../../../testing/test-utils';
import { ChapaPayoutProvider } from './chapa-payout.provider';
import {
  classifyFetchError,
  classifyHttpStatus,
  fetchWithTimeout,
  mockPayoutStatus,
  PayoutOutcomeUnknownError,
  type PayoutProvider,
  PayoutProviderError,
} from './payout-provider';
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

describe('PayoutProviderRegistry failover (security audit #7: only on DEFINITIVE pre-send failures)', () => {
  const security = mockSecurity();
  const make = (
    name: string,
    methods: string[],
    impl: () => Promise<unknown>,
    available = true,
    findByReference: () => Promise<unknown> = async () => null,
  ) =>
    ({
      name,
      isMock: true,
      supportedMethods: methods,
      isAvailable: () => available,
      initiatePayout: jest.fn(impl),
      checkStatus: jest.fn(),
      findByReference: jest.fn(findByReference),
    }) as unknown as PayoutProvider & { initiatePayout: jest.Mock; findByReference: jest.Mock };
  const definitive = (msg: string) => new PayoutProviderError(msg, 'definitive', 'telebirr', 400);
  const ambiguous = (msg: string) => new PayoutProviderError(msg, 'ambiguous', 'telebirr', 504);

  it('routes telebirr to the telebirr provider first and falls over to chapa on a DEFINITIVE failure', async () => {
    const telebirr = make('telebirr', ['telebirr'], async () => {
      throw definitive('telebirr rejected: invalid msisdn');
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
    expect(telebirr.findByReference).not.toHaveBeenCalled(); // nothing was sent, no lookup needed
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

  it('AMBIGUOUS failure + partner HAS our reference -> continues with that transfer, never fails over (no double payout)', async () => {
    const telebirr = make(
      'telebirr',
      ['telebirr'],
      async () => {
        throw ambiguous('telebirr request failed (timeout/network)');
      },
      true,
      async () => ({ providerPayoutId: 'TB-77', status: 'processing', raw: { found: true } }),
    );
    const chapa = make('chapa', ['bank', 'telebirr'], async () => ({ providerPayoutId: 'CH-1', status: 'processing' }));
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    const { provider, result } = await registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', { reference: 'w1' });
    expect(provider.name).toBe('telebirr');
    expect(result).toMatchObject({ providerPayoutId: 'TB-77', status: 'processing' });
    expect(telebirr.findByReference).toHaveBeenCalledWith('w1');
    expect(chapa.initiatePayout).not.toHaveBeenCalled();
  });

  it('AMBIGUOUS failure + partner has NO record -> safe to fail over', async () => {
    const telebirr = make('telebirr', ['telebirr'], async () => {
      throw ambiguous('HTTP 503');
    });
    const chapa = make('chapa', ['bank', 'telebirr'], async () => ({ providerPayoutId: 'CH-2', status: 'processing' }));
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    const { provider } = await registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', { reference: 'w1' });
    expect(provider.name).toBe('chapa');
    expect(telebirr.findByReference).toHaveBeenCalledTimes(1);
  });

  it('AMBIGUOUS failure + lookup also fails -> PayoutOutcomeUnknownError (manual review), no failover, no refund', async () => {
    const telebirr = make(
      'telebirr',
      ['telebirr'],
      async () => {
        throw ambiguous('timeout');
      },
      true,
      async () => {
        throw ambiguous('lookup timeout');
      },
    );
    const chapa = make('chapa', ['bank', 'telebirr'], async () => ({ providerPayoutId: 'CH-3', status: 'processing' }));
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    await expect(registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', { reference: 'w1' })).rejects.toBeInstanceOf(PayoutOutcomeUnknownError);
    expect(chapa.initiatePayout).not.toHaveBeenCalled();
    expect(security.error).toHaveBeenCalledWith('payout.outcome_unknown', expect.objectContaining({ provider: 'telebirr', reference: 'w1' }));
  });

  it('skips unavailable providers and fails when none can pay', async () => {
    const telebirr = make(
      'telebirr',
      ['telebirr'],
      async () => ({ providerPayoutId: 'x', status: 'processing' }),
      false,
    );
    const chapa = make('chapa', ['bank', 'telebirr'], async () => {
      throw new PayoutProviderError('chapa 500', 'ambiguous', 'chapa', 500);
    });
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    expect(registry.isMethodAvailable('telebirr')).toBe(true);
    // Phase 5b New-2: the LAST provider failing ambiguously (+ "not found") is parked, not reported as a refundable failure
    await expect(
      registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', { reference: 'w1' }),
    ).rejects.toMatchObject({ name: 'PayoutOutcomeUnknownError', providerName: 'chapa', cause: expect.objectContaining({ message: 'chapa 500' }) });
    expect(telebirr.initiatePayout).not.toHaveBeenCalled();
    expect(registry.providersFor('bank').map((p) => p.name)).toEqual(['chapa']);
    expect(new PayoutProviderRegistry([telebirr], security).isMethodAvailable('bank')).toBe(false);
  });
});

describe('fetchWithTimeout / error classification (security audit #7)', () => {
  it('classifies connection refused / DNS as definitive and timeouts / resets as ambiguous', () => {
    expect(classifyFetchError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe('definitive');
    expect(classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toBe('definitive');
    expect(classifyFetchError(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('ambiguous');
    expect(classifyFetchError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe('ambiguous');
    expect(classifyFetchError(new Error('weird'))).toBe('ambiguous');
    expect(classifyHttpStatus(400)).toBe('definitive');
    expect(classifyHttpStatus(422)).toBe('definitive');
    expect(classifyHttpStatus(500)).toBe('ambiguous');
    expect(classifyHttpStatus(504)).toBe('ambiguous');
  });

  it('aborts a hanging partner call after the timeout and reports it as ambiguous', async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const started = Date.now();
    await expect(fetchWithTimeout('telebirr', 'https://partner.invalid/x', {}, 50, hanging)).rejects.toMatchObject({
      name: 'PayoutProviderError',
      kind: 'ambiguous',
      providerName: 'telebirr',
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('real telebirr/chapa providers surface 5xx as ambiguous and 4xx as definitive', async () => {
    const real = testConfig({ PAYOUTS_MOCK: 'false', TELEBIRR_APP_ID: 'a', TELEBIRR_APP_KEY: 'b', TELEBIRR_SHORT_CODE: 'c', CHAPA_SECRET_KEY: 'k', PAYOUT_PROVIDER_TIMEOUT_MS: 1000 });
    const chapa500 = new ChapaPayoutProvider(real, (async () => new Response('{"status":"failed","message":"upstream"}', { status: 502 })) as unknown as typeof fetch);
    await expect(chapa500.initiatePayout('u', 50, '+251911223344', { reference: 'w1' })).rejects.toMatchObject({ kind: 'ambiguous', httpStatus: 502 });
    const chapa400 = new ChapaPayoutProvider(real, (async () => new Response('{"status":"failed","message":"invalid account"}', { status: 400 })) as unknown as typeof fetch);
    await expect(chapa400.initiatePayout('u', 50, '+251911223344', { reference: 'w1' })).rejects.toMatchObject({ kind: 'definitive', httpStatus: 400 });
    // chapa verify: ONLY the documented "Transfer not found" business reply means "never accepted" (New-2)
    const chapaNotFound = new ChapaPayoutProvider(real, (async () => new Response('{"status":"failed","message":"Transfer not found","data":null}', { status: 404 })) as unknown as typeof fetch);
    expect(await chapaNotFound.findByReference('w1')).toBeNull();
    const chapaBare404 = new ChapaPayoutProvider(real, (async () => new Response('{"status":"failed"}', { status: 404 })) as unknown as typeof fetch);
    await expect(chapaBare404.findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous', httpStatus: 404 });
    // telebirr: token exchange fails before any transfer -> definitive
    const tbToken = new TelebirrPayoutProvider(real, (async () => new Response('{"msg":"bad key"}', { status: 401 })) as unknown as typeof fetch);
    await expect(tbToken.initiatePayout('u', 50, '+251911223344', { reference: 'w1' })).rejects.toMatchObject({ kind: 'definitive' });
    // telebirr: token ok, disbursement 5xx -> ambiguous
    let call = 0;
    const tb5xx = new TelebirrPayoutProvider(real, (async () => (call++ === 0 ? new Response('{"token":"t"}', { status: 200 }) : new Response('{"msg":"gateway"}', { status: 500 }))) as unknown as typeof fetch);
    await expect(tb5xx.initiatePayout('u', 50, '+251911223344', { reference: 'w1' })).rejects.toMatchObject({ kind: 'ambiguous', httpStatus: 500 });
  });
});

/**
 * Phase 5b New-2: `findByReference` returns null ONLY for the partner's documented "order not found" business
 * answer; everything else is ambiguous. The registry never lets a chain that contained an ambiguous send end in a
 * refundable failure.
 */
describe('findByReference semantics + registry parking (Phase 5b New-2)', () => {
  const real = testConfig({ PAYOUTS_MOCK: 'false', TELEBIRR_APP_ID: 'a', TELEBIRR_APP_KEY: 'b', TELEBIRR_SHORT_CODE: 'c', CHAPA_SECRET_KEY: 'k', PAYOUT_PROVIDER_TIMEOUT_MS: 1000 });
  const telebirrWith = (reply: () => Response) => {
    let call = 0;
    return new TelebirrPayoutProvider(real, (async () => (call++ === 0 ? new Response('{"token":"t"}', { status: 200 }) : reply())) as unknown as typeof fetch);
  };

  it('telebirr: documented NOT_FOUND code -> null; bare 404 / unexpected 2xx shape / malformed body -> ambiguous', async () => {
    expect(await telebirrWith(() => new Response('{"code":"ORDER_NOT_FOUND","msg":"no such order"}', { status: 200 })).findByReference('w1')).toBeNull();
    expect(await telebirrWith(() => new Response('{"code":"NOT_FOUND"}', { status: 404 })).findByReference('w1')).toBeNull();
    await expect(telebirrWith(() => new Response('not json', { status: 404 })).findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous' });
    await expect(telebirrWith(() => new Response('{"msg":"route missing"}', { status: 404 })).findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous', httpStatus: 404 });
    await expect(telebirrWith(() => new Response('{"code":"0","result":{}}', { status: 200 })).findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous' });
    await expect(telebirrWith(() => new Response('{"code":"99","msg":"system busy"}', { status: 200 })).findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous' });
    await expect(telebirrWith(() => new Response('{"msg":"gateway"}', { status: 502 })).findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous', httpStatus: 502 });
    const found = await telebirrWith(() => new Response('{"code":"0","result":{"transactionNo":"TB-9","status":"SUCCESS"}}', { status: 200 })).findByReference('w1');
    expect(found).toMatchObject({ providerPayoutId: 'TB-9', status: 'completed' });
  });

  it('chapa: documented "Transfer not found" -> null; unexpected 2xx without data / 401 / malformed -> ambiguous', async () => {
    const chapa = (body: string, status: number) => new ChapaPayoutProvider(real, (async () => new Response(body, { status })) as unknown as typeof fetch);
    expect(await chapa('{"status":"failed","message":"Transfer not found","data":null}', 404).findByReference('w1')).toBeNull();
    expect(await chapa('{"status":"failed","message":"Transaction not found"}', 400).findByReference('w1')).toBeNull();
    await expect(chapa('{"status":"success","message":"ok"}', 200).findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous' });
    await expect(chapa('{"status":"failed","message":"Invalid API key"}', 401).findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous', httpStatus: 401 });
    await expect(chapa('<html>502</html>', 502).findByReference('w1')).rejects.toMatchObject({ kind: 'ambiguous' });
    expect(await chapa('{"status":"success","data":{"status":"pending"}}', 200).findByReference('w1')).toMatchObject({ providerPayoutId: 'w1', status: 'processing' });
  });

  const security = mockSecurity();
  const make = (name: string, methods: string[], impl: () => Promise<unknown>, findByReference: () => Promise<unknown> = async () => null) =>
    ({ name, isMock: false, supportedMethods: methods, isAvailable: () => true, initiatePayout: jest.fn(impl), checkStatus: jest.fn(), findByReference: jest.fn(findByReference) }) as unknown as PayoutProvider & { initiatePayout: jest.Mock; findByReference: jest.Mock };

  it('REGRESSION: the last provider times out and answers "not found" -> PayoutOutcomeUnknownError, never a refundable failure', async () => {
    const telebirr = make('telebirr', ['telebirr'], async () => { throw new PayoutProviderError('invalid msisdn', 'definitive', 'telebirr', 400); });
    const chapa = make('chapa', ['bank', 'telebirr'], async () => { throw new PayoutProviderError('timeout', 'ambiguous', 'chapa'); });
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    await expect(registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', { reference: 'w1' })).rejects.toMatchObject({ name: 'PayoutOutcomeUnknownError', providerName: 'chapa' });
    expect(chapa.findByReference).toHaveBeenCalledWith('w1');
    expect(security.error).toHaveBeenCalledWith('payout.outcome_unknown', expect.objectContaining({ reason: 'last_provider_not_found' }));
  });

  it('an ambiguous send followed only by definitive failures is still parked (ambiguous_then_exhausted)', async () => {
    const telebirr = make('telebirr', ['telebirr'], async () => { throw new PayoutProviderError('timeout', 'ambiguous', 'telebirr'); });
    const chapa = make('chapa', ['bank', 'telebirr'], async () => { throw new PayoutProviderError('invalid account', 'definitive', 'chapa', 400); });
    const registry = new PayoutProviderRegistry([telebirr, chapa], security);
    await expect(registry.initiateWithFailover('telebirr', 'u1', 50, '+251911223344', { reference: 'w1' })).rejects.toMatchObject({ name: 'PayoutOutcomeUnknownError', providerName: 'telebirr' });
    expect(chapa.initiatePayout).toHaveBeenCalledTimes(1); // the explicit not-found still allowed ONE failover attempt
  });

  it('findExisting (crash recovery): adopts a partner record, null when every partner says not found, unknown when one cannot tell', async () => {
    const telebirr = make('telebirr', ['telebirr'], async () => ({}), async () => null);
    const chapa = make('chapa', ['bank', 'telebirr'], async () => ({}), async () => ({ providerPayoutId: 'w1', status: 'processing' }));
    expect(await new PayoutProviderRegistry([telebirr, chapa], security).findExisting('telebirr', 'w1')).toMatchObject({ provider: { name: 'chapa' }, result: { providerPayoutId: 'w1', status: 'processing' } });
    const none = make('chapa', ['bank', 'telebirr'], async () => ({}), async () => null);
    expect(await new PayoutProviderRegistry([telebirr, none], security).findExisting('telebirr', 'w1')).toBeNull();
    const broken = make('telebirr', ['telebirr'], async () => ({}), async () => { throw new PayoutProviderError('lookup 502', 'ambiguous', 'telebirr', 502); });
    await expect(new PayoutProviderRegistry([broken, none], security).findExisting('telebirr', 'w1')).rejects.toBeInstanceOf(PayoutOutcomeUnknownError);
  });
});
