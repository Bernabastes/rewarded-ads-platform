import { Logger } from '@nestjs/common';
import { testConfig } from '../../testing/test-utils';
import { createSmsProvider, HttpSmsProvider, MockSmsProvider } from './sms.module';

describe('SMS providers (security audit #9: no OTPs in logs, real gateway selectable)', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('the mock provider reveals the code only in development', async () => {
    await new MockSmsProvider(true).sendOtp('+251911000000', '123456', 300);
    expect(String(logSpy.mock.calls.at(-1)?.[0])).toContain('otp=123456');
    await new MockSmsProvider(false).sendOtp('+251911000000', '123456', 300);
    expect(String(logSpy.mock.calls.at(-1)?.[0])).toContain('otp=[redacted]');
    expect(String(logSpy.mock.calls.at(-1)?.[0])).not.toContain('123456');
  });

  it('createSmsProvider picks the mock without revealing codes outside development', () => {
    expect(createSmsProvider(testConfig({ NODE_ENV: 'test' }))).toBeInstanceOf(MockSmsProvider);
    expect(createSmsProvider(testConfig({ NODE_ENV: 'development' }))).toBeInstanceOf(MockSmsProvider);
  });

  it('the http provider posts { to, message, from? } with a bearer key, times out, and never logs the code', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"status":"ok"}', { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createSmsProvider(
      testConfig({ SMS_PROVIDER: 'http', SMS_API_URL: 'https://sms.example.et/send', SMS_API_KEY: 'k-1', SMS_SENDER_ID: 'GIZE', SMS_TIMEOUT_MS: 5000 }),
      fetchImpl,
    );
    expect(provider).toBeInstanceOf(HttpSmsProvider);
    expect(provider.isMock).toBe(false);
    await provider.sendOtp('+251911000000', '654321', 300);
    expect(calls[0].url).toBe('https://sms.example.et/send');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k-1');
    const body = JSON.parse(String(calls[0].init.body)) as { to: string; message: string; from: string };
    expect(body).toMatchObject({ to: '+251911000000', from: 'GIZE' });
    expect(body.message).toContain('654321');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    for (const call of logSpy.mock.calls) expect(String(call[0])).not.toContain('654321');

    // gateway failure -> generic error (no code leaks through the exception either)
    const failing = new HttpSmsProvider({ apiUrl: 'https://sms.example.et/send', apiKey: 'k', timeoutMs: 1000 }, (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch);
    await expect(failing.sendOtp('+251911000000', '111111', 300)).rejects.toThrow('SMS delivery failed');
  });
});
