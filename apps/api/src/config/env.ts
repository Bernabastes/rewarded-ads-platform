import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const num = (def: number) => z.coerce.number().default(def);

/**
 * Every environment variable the API reads, with defaults. Documented in /.env.example.
 * Secrets have NO defaults (except in non-production for local convenience).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: num(3000),
    API_PUBLIC_URL: z.string().default('http://localhost:3000'),
    ADVERTISER_WEB_URL: z.string().default('http://localhost:5173'),
    ADMIN_WEB_URL: z.string().default('http://localhost:5174'),
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:8081'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
    LOG_PRETTY: bool.default(false),
    SECURITY_LOG_PATH: z.string().optional(),
    APP_VERSION: z.string().default('0.1.0'),

    DATABASE_URL: z.string().default('postgresql://rap:rap@localhost:5432/rap?schema=public'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    QUEUE_PREFIX: z.string().default('rap'),

    JWT_ACCESS_SECRET: z.string().min(16).default('dev-only-change-me-access-secret-0123456789'),
    JWT_ACCESS_TTL_SECONDS: num(900),
    JWT_REFRESH_TTL_DAYS: num(30),

    OTP_TTL_SECONDS: num(300),
    OTP_LENGTH: num(6),
    OTP_MAX_ATTEMPTS: num(5),
    OTP_RESEND_AFTER_SECONDS: num(60),
    OTP_RATE_LIMIT_PER_PHONE_PER_HOUR: num(5),
    OTP_RATE_LIMIT_PER_IP_PER_HOUR: num(30),
    /** Return the OTP in the API response (dev/demo only). */
    OTP_DEV_ECHO: bool.default(false),
    /** When set (non-production only), this code is accepted for any phone number. */
    OTP_DEV_FIXED_CODE: z.string().optional(),
    SMS_PROVIDER: z.enum(['mock']).default('mock'),

    COINS_PER_ETB: num(100),
    MIN_WITHDRAWAL_ETB: num(50),
    LARGE_WITHDRAWAL_THRESHOLD_ETB: num(500),
    DAILY_AD_COMPLETION_LIMIT: num(15),
    PLATFORM_TAKE_RATE: num(0.5),
    MIN_WATCH_RATIO: num(0.9),
    /** Completion later than duration * MAX_WATCH_RATIO (+ grace) is rejected as implausible. */
    MAX_WATCH_RATIO: num(3),
    WATCH_GRACE_SECONDS: num(60),
    MIN_AGE: num(18),
    HEARTBEAT_INTERVAL_SECONDS: num(10),
    /** Fraction of expected heartbeats that must have been received. */
    MIN_HEARTBEAT_RATIO: num(0.6),
    WATCH_SESSION_TTL_MINUTES: num(30),
    DAILY_WITHDRAWAL_REQUEST_LIMIT: num(3),
    MAX_WATCH_ATTEMPTS_PER_AD_PER_DAY: num(3),
    MIN_CAMPAIGN_BUDGET_ETB: num(100),
    MIN_COST_PER_ACTION_ETB: num(0.5),
    MIN_TOPUP_ETB: num(100),
    INVOICE_VAT_RATE: num(0),

    FRAUD_FLAG_THRESHOLD: num(40),
    FRAUD_REJECT_THRESHOLD: num(80),
    FRAUD_MIN_TRUST_FOR_FEED: num(20),
    FRAUD_DEVICE_SHARED_ACCOUNTS_THRESHOLD: num(3),
    FRAUD_IP_COMPLETIONS_PER_HOUR_THRESHOLD: num(30),
    FRAUD_MIN_ACCOUNT_AGE_HOURS_FOR_FULL_TRUST: num(24),

    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    S3_PUBLIC_URL: z.string().default('http://localhost:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('rap-media'),
    S3_ACCESS_KEY: z.string().default('minioadmin'),
    S3_SECRET_KEY: z.string().default('minioadmin'),
    S3_FORCE_PATH_STYLE: bool.default(true),
    S3_PRESIGN_TTL_SECONDS: num(900),

    CHAPA_SECRET_KEY: z.string().optional(),
    CHAPA_BASE_URL: z.string().default('https://api.chapa.co/v1'),
    CHAPA_WEBHOOK_SECRET: z.string().optional(),

    PAYOUTS_MOCK: bool.default(true),
    PAYOUT_MOCK_FAILURE_RATE: num(0.1),
    PAYOUT_MOCK_PROCESSING_SECONDS: num(5),
    PAYOUT_STATUS_POLL_SECONDS: num(10),
    PAYOUT_MAX_ATTEMPTS: num(3),
    TELEBIRR_BASE_URL: z.string().default('https://app.ethiomobilemoney.et:2121'),
    TELEBIRR_APP_ID: z.string().optional(),
    TELEBIRR_APP_KEY: z.string().optional(),
    TELEBIRR_SHORT_CODE: z.string().optional(),
    TELEBIRR_PUBLIC_KEY: z.string().optional(),

    FCM_PROJECT_ID: z.string().optional(),
    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),

    RECONCILIATION_CRON: z.string().default('0 * * * *'),
    RECONCILIATION_ENABLED: bool.default(true),
    QUEUES_ENABLED: bool.default(true),

    SUPPORT_TELEGRAM_URL: z.string().default('https://t.me/rap_support'),
    SUPPORT_PHONE: z.string().default('+251900000000'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) {
        ctx.addIssue({ code: 'custom', path: ['JWT_ACCESS_SECRET'], message: 'must be set in production' });
      }
      if (env.OTP_DEV_ECHO) {
        ctx.addIssue({ code: 'custom', path: ['OTP_DEV_ECHO'], message: 'must be false in production' });
      }
      if (env.OTP_DEV_FIXED_CODE) {
        ctx.addIssue({
          code: 'custom',
          path: ['OTP_DEV_FIXED_CODE'],
          message: 'must be unset in production',
        });
      }
    }
    if (env.PLATFORM_TAKE_RATE < 0 || env.PLATFORM_TAKE_RATE >= 1) {
      ctx.addIssue({ code: 'custom', path: ['PLATFORM_TAKE_RATE'], message: 'must be in [0,1)' });
    }
    if (env.MIN_WATCH_RATIO <= 0 || env.MIN_WATCH_RATIO > 1) {
      ctx.addIssue({ code: 'custom', path: ['MIN_WATCH_RATIO'], message: 'must be in (0,1]' });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  return parsed.data;
}
