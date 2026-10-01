import { PLATFORM_DEFAULTS } from '@rap/shared';
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
    /**
     * Number of trusted reverse-proxy hops in front of the API (Express `trust proxy`). 0 = the API is exposed
     * directly and X-Forwarded-For is ignored; 1 = one load balancer / nginx. Never more than you really have.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
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
    /** Verify-side brute-force limits (security audit #4): attempts per phone / per IP within the window. */
    OTP_VERIFY_LIMIT_PER_PHONE: num(10),
    OTP_VERIFY_LIMIT_PER_IP: num(30),
    OTP_VERIFY_WINDOW_SECONDS: num(900),
    /** Return the OTP in the API response (dev/demo only). */
    OTP_DEV_ECHO: bool.default(false),
    /** When set (non-production only), this code is accepted for any phone number. */
    OTP_DEV_FIXED_CODE: z.string().optional(),
    SMS_PROVIDER: z.enum(['mock', 'http']).default('mock'),
    /** Generic HTTP SMS gateway (SMS_PROVIDER=http): JSON POST { to, message, from? } with a bearer key. */
    SMS_API_URL: z.string().url().optional(),
    SMS_API_KEY: z.string().optional(),
    SMS_SENDER_ID: z.string().optional(),
    SMS_TIMEOUT_MS: num(8000),

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
    MIN_CAMPAIGN_BUDGET_ETB: num(PLATFORM_DEFAULTS.MIN_CAMPAIGN_BUDGET_ETB),
    MIN_COST_PER_ACTION_ETB: num(PLATFORM_DEFAULTS.MIN_COST_PER_ACTION_ETB),
    MIN_TOPUP_ETB: num(PLATFORM_DEFAULTS.MIN_TOPUP_ETB),
    INVOICE_VAT_RATE: num(0),

    FRAUD_FLAG_THRESHOLD: num(40),
    FRAUD_REJECT_THRESHOLD: num(80),
    FRAUD_MIN_TRUST_FOR_FEED: num(20),
    FRAUD_DEVICE_SHARED_ACCOUNTS_THRESHOLD: num(3),
    FRAUD_IP_COMPLETIONS_PER_HOUR_THRESHOLD: num(30),
    FRAUD_MIN_ACCOUNT_AGE_HOURS_FOR_FULL_TRUST: num(24),

    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    /** Endpoint browsers can reach; used ONLY to presign upload URLs (the Host is part of the signature). */
    S3_PUBLIC_ENDPOINT: z.string().optional(),
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
    PAYOUT_MAX_ATTEMPTS: num(PLATFORM_DEFAULTS.PAYOUT_MAX_ATTEMPTS),
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

    /* ---------- Phase 4A ---------- */
    /** Rolling 30-day payout total (ETB) above which phone_only users must complete KYC. */
    KYC_REQUIRED_ABOVE_MONTHLY_ETB: num(PLATFORM_DEFAULTS.KYC_REQUIRED_ABOVE_MONTHLY_ETB),
    /** Presigned GET links for KYC documents shown to admins (seconds). */
    KYC_DOCUMENT_URL_TTL_SECONDS: num(300),
    ID_VERIFICATION_PROVIDER: z.enum(['mock', 'fayda']).default('mock'),
    FAYDA_BASE_URL: z.string().default('https://api.fayda.et'),
    FAYDA_CLIENT_ID: z.string().optional(),
    FAYDA_CLIENT_SECRET: z.string().optional(),

    /** A destination lookup (resolve) stays valid this long; the OTP re-check too. */
    DESTINATION_RESOLVE_TTL_MINUTES: num(PLATFORM_DEFAULTS.DESTINATION_RESOLVE_TTL_MINUTES),

    ALERT_TELEGRAM_BOT_TOKEN: z.string().optional(),
    ALERT_TELEGRAM_CHAT_ID: z.string().optional(),
    ALERT_WEBHOOK_URL: z.string().optional(),
    ALERT_RULES_CRON: z.string().default('*/5 * * * *'),
    ALERT_RULES_ENABLED: bool.default(true),
    /** Same alert dedupe key is not re-raised within this window. */
    ALERT_DEDUPE_MINUTES: num(60),
    ALERT_PAYOUT_FAILURE_RATE: num(0.2),
    ALERT_PAYOUT_MIN_SAMPLE: num(5),
    ALERT_ACCOUNTS_PER_DEVICE_PER_HOUR: num(3),
    ALERT_SPEND_VELOCITY_MULTIPLIER: num(5),
    ALERT_SPEND_VELOCITY_MIN_ETB: num(50),
    ALERT_OTP_REQUESTS_PER_IP_PER_HOUR: num(20),

    DEFAULT_FREQUENCY_CAP: num(PLATFORM_DEFAULTS.DEFAULT_FREQUENCY_CAP),
    ADVERTISER_IMPRESSION_CAP_PER_USER_PER_DAY: num(PLATFORM_DEFAULTS.ADVERTISER_IMPRESSION_CAP_PER_USER_PER_DAY),

    MEDIA_PROCESSING_ENABLED: bool.default(true),
    /** Explicit binaries (e.g. apk ffmpeg in the container); falls back to ffmpeg-static / ffprobe-static / PATH. */
    MEDIA_FFMPEG_PATH: z.string().optional(),
    MEDIA_FFPROBE_PATH: z.string().optional(),
    MEDIA_JOB_TIMEOUT_SECONDS: num(300),
    MEDIA_TARGET_HEIGHT: num(720),
    /** |declared - probed| above this (seconds) corrects duration_seconds and marks duration_corrected. */
    MEDIA_DURATION_TOLERANCE_SECONDS: num(1),

    REFERRAL_BONUS_COINS: num(PLATFORM_DEFAULTS.REFERRAL_BONUS_COINS),
    REFEREE_BONUS_COINS: num(PLATFORM_DEFAULTS.REFEREE_BONUS_COINS),
    REFERRAL_MAX_PER_REFERRER_PER_DAY: num(PLATFORM_DEFAULTS.REFERRAL_MAX_PER_REFERRER_PER_DAY),
    /** Share link template ({code} is replaced). */
    REFERRAL_SHARE_URL: z.string().default('https://gize.app/r/{code}'),

    ACCOUNT_DELETION_GRACE_DAYS: num(PLATFORM_DEFAULTS.ACCOUNT_DELETION_GRACE_DAYS),
    /** Cron for the job that executes due deletion requests and expires old exports. */
    DATA_RIGHTS_CRON: z.string().default('30 * * * *'),
    DATA_EXPORT_URL_TTL_SECONDS: num(900),
    DATA_EXPORT_RETENTION_DAYS: num(7),
    IMPERSONATION_TTL_SECONDS: num(600),
    IDEMPOTENCY_TTL_HOURS: num(PLATFORM_DEFAULTS.IDEMPOTENCY_TTL_HOURS),

    /* ---------- Phase 5 (security remediation) ---------- */
    /** Interactive Swagger UI + /api/docs-json; always off in production (the env schema refuses true). */
    SWAGGER_ENABLED: bool.default(true),
    /** HMAC key for the KYC identity-number duplicate hash (#14). Required (>= 32 chars) in production. */
    KYC_HASH_KEY: z.string().optional(),
    /** AES-256-GCM key (any string, hashed) for admin TOTP secrets at rest. Production: required, >= 32 chars, != JWT secret (New-4). */
    MFA_ENCRYPTION_KEY: z.string().optional(),
    /** finance / super_admin accounts must have TOTP enabled; until then every non-MFA admin route is 403 MFA_SETUP_REQUIRED. */
    ADMIN_MFA_REQUIRED: bool.default(false),
    /**
     * Login throttling (#5): attempts per IP / per account inside LOGIN_WINDOW_SECONDS, lockout after
     * LOGIN_LOCKOUT_THRESHOLD consecutive failures. The per-IP limit is deliberately higher than the per-account one
     * so an office NAT shared by many admins is not locked out by normal use.
     */
    LOGIN_RATE_LIMIT_PER_IP: num(30),
    LOGIN_RATE_LIMIT_PER_ACCOUNT: num(10),
    LOGIN_WINDOW_SECONDS: num(900),
    LOGIN_LOCKOUT_THRESHOLD: num(5),
    LOGIN_LOCKOUT_SECONDS: num(900),
    /** Phase 5b: an IP that completed a login for an account is exempt from that account's SOFT throttle for this long. */
    LOGIN_TRUSTED_IP_HOURS: num(24),
    /** Seeding is refused with NODE_ENV=production unless this is explicitly true. */
    ALLOW_SEED_IN_PRODUCTION: bool.default(false),
    /** Account-name lookups (destination verification) per user per UTC day (#11). */
    DESTINATION_LOOKUPS_PER_DAY: num(5),
    /** Alert rule: lookups per IP per hour above which an alert is raised (#11). */
    ALERT_DESTINATION_LOOKUPS_PER_IP_PER_HOUR: num(30),
    /** HTTP timeout for payout-partner calls (#7). */
    PAYOUT_PROVIDER_TIMEOUT_MS: num(15_000),
    /** Max status polls before a payout is parked for manual review instead of being refunded (#7). */
    PAYOUT_MAX_POLLS: num(500),
    /** BullMQ attempts for the payout `initiate` job; a retry resumes safely via partner lookup (Phase 5b New-2). */
    PAYOUT_INITIATE_ATTEMPTS: num(3),
    /** A payout `processing` without a partner for longer than this is parked for manual review + alert (New-2). */
    PAYOUT_STUCK_PROCESSING_MINUTES: num(15),
    /** Refresh-token cookie attributes for the web apps' cookie mode (#16). */
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    AUTH_COOKIE_SECURE: bool.optional(),
    /** Phase 5b New-5: Redis-backed security controls when Redis is unreachable (default closed in production). */
    SECURITY_REDIS_FAIL_MODE: z.enum(['closed', 'open']).optional(),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.NODE_ENV === 'production') {
      // Security audit #8 / #9: a production process must not be able to start with mock money paths,
      // default infrastructure credentials, wildcard CORS, weak signing keys or OTPs in the logs.
      if (env.JWT_ACCESS_SECRET.startsWith('dev-only')) issue('JWT_ACCESS_SECRET', 'must be set in production');
      if (env.JWT_ACCESS_SECRET.length < 32) issue('JWT_ACCESS_SECRET', 'must be at least 32 characters (256-bit HS256 key) in production');
      if (env.OTP_DEV_ECHO) issue('OTP_DEV_ECHO', 'must be false in production');
      if (env.OTP_DEV_FIXED_CODE) issue('OTP_DEV_FIXED_CODE', 'must be unset in production');
      if (!env.CHAPA_SECRET_KEY) issue('CHAPA_SECRET_KEY', 'required in production (the mock checkout credits wallets for free)');
      if (!env.CHAPA_WEBHOOK_SECRET) issue('CHAPA_WEBHOOK_SECRET', 'required in production');
      if (env.PAYOUTS_MOCK) issue('PAYOUTS_MOCK', 'must be false in production (mock payouts mark withdrawals completed without paying)');
      if (!(env.TELEBIRR_APP_ID && env.TELEBIRR_APP_KEY && env.TELEBIRR_SHORT_CODE)) {
        issue('TELEBIRR_APP_ID', 'telebirr payout credentials (TELEBIRR_APP_ID, TELEBIRR_APP_KEY, TELEBIRR_SHORT_CODE) are required in production');
      }
      if (env.S3_ACCESS_KEY === 'minioadmin' || env.S3_SECRET_KEY === 'minioadmin' || env.S3_SECRET_KEY.length < 16) {
        issue('S3_SECRET_KEY', 'non-default object storage credentials (secret >= 16 chars) are required in production');
      }
      if (env.CORS_ORIGINS.split(',').some((o) => o.trim() === '*')) issue('CORS_ORIGINS', 'wildcard origins are not allowed in production (credentials: true)');
      if (env.SMS_PROVIDER === 'mock') issue('SMS_PROVIDER', 'the mock SMS provider (OTPs in logs) is not allowed in production');
      if (!env.KYC_HASH_KEY || env.KYC_HASH_KEY.length < 32) issue('KYC_HASH_KEY', 'a >= 32 character HMAC key for identity-number hashes is required in production');
      // Phase 5b New-4: TOTP secrets must not be protected by the token-signing key (one leak would expose both).
      if (!env.MFA_ENCRYPTION_KEY || env.MFA_ENCRYPTION_KEY.length < 32) {
        issue('MFA_ENCRYPTION_KEY', 'a dedicated >= 32 character key for admin TOTP secrets at rest is required in production');
      } else if (env.MFA_ENCRYPTION_KEY === env.JWT_ACCESS_SECRET || env.MFA_ENCRYPTION_KEY === env.KYC_HASH_KEY) {
        issue('MFA_ENCRYPTION_KEY', 'must differ from JWT_ACCESS_SECRET and KYC_HASH_KEY');
      }
      if (env.SWAGGER_ENABLED) issue('SWAGGER_ENABLED', 'the interactive API docs must stay disabled in production');
      // Phase 5b New-5: Redis holds the login lockouts, the token denylist and the BullMQ money queues - it must be
      // authenticated (compose enforces --requirepass; the URL must carry the password).
      if (!redisUrlHasPassword(env.REDIS_URL)) issue('REDIS_URL', 'must include a password (redis://:<password>@host:6379) in production');
    }
    if (env.SMS_PROVIDER === 'http' && !(env.SMS_API_URL && env.SMS_API_KEY)) {
      issue('SMS_PROVIDER', 'http requires SMS_API_URL and SMS_API_KEY');
    }
    if (env.PLATFORM_TAKE_RATE < 0 || env.PLATFORM_TAKE_RATE >= 1) {
      issue('PLATFORM_TAKE_RATE', 'must be in [0,1)');
    }
    if (env.MIN_WATCH_RATIO <= 0 || env.MIN_WATCH_RATIO > 1) {
      issue('MIN_WATCH_RATIO', 'must be in (0,1]');
    }
    if (env.DEFAULT_FREQUENCY_CAP < 1 || env.DEFAULT_FREQUENCY_CAP > 5) {
      issue('DEFAULT_FREQUENCY_CAP', 'must be in [1,5]');
    }
    if (env.ALERT_PAYOUT_FAILURE_RATE <= 0 || env.ALERT_PAYOUT_FAILURE_RATE > 1) {
      issue('ALERT_PAYOUT_FAILURE_RATE', 'must be in (0,1]');
    }
    if (env.ID_VERIFICATION_PROVIDER === 'fayda' && !(env.FAYDA_CLIENT_ID && env.FAYDA_CLIENT_SECRET)) {
      issue('ID_VERIFICATION_PROVIDER', 'fayda requires FAYDA_CLIENT_ID and FAYDA_CLIENT_SECRET');
    }
  });

export type Env = z.infer<typeof envSchema>;

export function redisUrlHasPassword(url: string): boolean {
  try {
    return new URL(url).password.length > 0;
  } catch {
    return false;
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  return parsed.data;
}
