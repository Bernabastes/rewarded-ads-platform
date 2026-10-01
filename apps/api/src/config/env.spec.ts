import { envSchema, loadEnv } from './env';

/**
 * Security audit #8 / #9: a production process must refuse to start with any unsafe combination.
 */
describe('env schema production gates', () => {
  const safeProd: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'p'.repeat(48),
    CHAPA_SECRET_KEY: 'CHASECK-live-xxxxxxxxxxxxxxxx',
    CHAPA_WEBHOOK_SECRET: 'whsec_xxxxxxxxxxxxxxxxxxxxxxxx',
    PAYOUTS_MOCK: 'false',
    TELEBIRR_APP_ID: 'app',
    TELEBIRR_APP_KEY: 'key',
    TELEBIRR_SHORT_CODE: '12345',
    S3_ACCESS_KEY: 'rap-prod-access-key',
    S3_SECRET_KEY: 'a-long-random-storage-secret-key',
    CORS_ORIGINS: 'https://ads.gize.app,https://admin.gize.app',
    SMS_PROVIDER: 'http',
    SMS_API_URL: 'https://sms.example.et/send',
    SMS_API_KEY: 'sms-key',
    KYC_HASH_KEY: 'k'.repeat(40),
    MFA_ENCRYPTION_KEY: 'm'.repeat(40),
    SWAGGER_ENABLED: 'false',
    OTP_DEV_ECHO: 'false',
  };

  const issuesFor = (overrides: NodeJS.ProcessEnv) => {
    const parsed = envSchema.safeParse({ ...safeProd, ...overrides });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
  };

  it('accepts a fully configured production environment', () => {
    expect(issuesFor({})).toEqual([]);
    expect(() => loadEnv(safeProd)).not.toThrow();
  });

  it.each<[string, NodeJS.ProcessEnv, string]>([
    ['missing Chapa secret (mock checkout would credit wallets for free)', { CHAPA_SECRET_KEY: '' }, 'CHAPA_SECRET_KEY'],
    ['missing Chapa webhook secret', { CHAPA_WEBHOOK_SECRET: '' }, 'CHAPA_WEBHOOK_SECRET'],
    ['mock payouts', { PAYOUTS_MOCK: 'true' }, 'PAYOUTS_MOCK'],
    ['missing telebirr payout credentials', { TELEBIRR_APP_KEY: '' }, 'TELEBIRR_APP_ID'],
    ['default MinIO credentials', { S3_ACCESS_KEY: 'minioadmin', S3_SECRET_KEY: 'minioadmin' }, 'S3_SECRET_KEY'],
    ['short storage secret', { S3_SECRET_KEY: 'short' }, 'S3_SECRET_KEY'],
    ['wildcard CORS', { CORS_ORIGINS: 'https://ads.gize.app,*' }, 'CORS_ORIGINS'],
    ['JWT secret below 32 chars', { JWT_ACCESS_SECRET: 'only-twenty-chars!!!' }, 'JWT_ACCESS_SECRET'],
    ['dev-only JWT secret', { JWT_ACCESS_SECRET: 'dev-only-change-me-access-secret-0123456789' }, 'JWT_ACCESS_SECRET'],
    ['mock SMS provider (OTPs in logs)', { SMS_PROVIDER: 'mock' }, 'SMS_PROVIDER'],
    ['OTP echo', { OTP_DEV_ECHO: 'true' }, 'OTP_DEV_ECHO'],
    ['fixed OTP', { OTP_DEV_FIXED_CODE: '123456' }, 'OTP_DEV_FIXED_CODE'],
    ['missing KYC hash key', { KYC_HASH_KEY: '' }, 'KYC_HASH_KEY'],
    ['missing MFA encryption key (New-4: TOTP secrets must not fall back to the JWT secret)', { MFA_ENCRYPTION_KEY: '' }, 'MFA_ENCRYPTION_KEY'],
    ['short MFA encryption key', { MFA_ENCRYPTION_KEY: 'short-key' }, 'MFA_ENCRYPTION_KEY'],
    ['MFA encryption key equal to the JWT secret', { MFA_ENCRYPTION_KEY: 'p'.repeat(48) }, 'MFA_ENCRYPTION_KEY'],
    ['MFA encryption key equal to the KYC hash key', { MFA_ENCRYPTION_KEY: 'k'.repeat(40) }, 'MFA_ENCRYPTION_KEY'],
    ['Swagger enabled', { SWAGGER_ENABLED: 'true' }, 'SWAGGER_ENABLED'],
  ])('rejects %s', (_label, overrides, path) => {
    expect(issuesFor(overrides)).toContain(path);
  });

  it('http SMS provider needs its URL and key in every environment', () => {
    const parsed = envSchema.safeParse({ NODE_ENV: 'development', SMS_PROVIDER: 'http' });
    expect(parsed.success).toBe(false);
  });

  it('development keeps its convenience defaults (mocks allowed)', () => {
    const env = envSchema.parse({ NODE_ENV: 'development' });
    expect(env.PAYOUTS_MOCK).toBe(true);
    expect(env.SMS_PROVIDER).toBe('mock');
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });
});
