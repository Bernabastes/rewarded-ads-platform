/**
 * Platform-wide constants. Every value here is a DEFAULT: the API can override
 * it via environment variables (see .env.example) and exposes the effective
 * values at GET /api/v1/withdrawals/config (users) and GET /api/v1/admin/config.
 * Frontends should prefer the server-reported values and only fall back to these.
 */
export const PLATFORM_DEFAULTS = {
  /** 1 ETB == 100 coins. */
  COINS_PER_ETB: 100,
  /** Minimum withdrawal request, in ETB. */
  MIN_WITHDRAWAL_ETB: 50,
  /** Withdrawals >= this amount need two distinct finance/super_admin approvals. */
  LARGE_WITHDRAWAL_THRESHOLD_ETB: 500,
  /** Max rewarded ad completions per user per UTC day. */
  DAILY_AD_COMPLETION_LIMIT: 15,
  /** Share of advertiser spend kept by the platform (0.50 == 50%). */
  PLATFORM_TAKE_RATE: 0.5,
  /** Fraction of the ad duration that must be watched (server-timed). */
  MIN_WATCH_RATIO: 0.9,
  /** Minimum age to use the product. */
  MIN_AGE: 18,
  /** Watch-session heartbeat interval the client must respect (seconds). */
  HEARTBEAT_INTERVAL_SECONDS: 10,
  /** Max withdrawal requests per user per UTC day. */
  DAILY_WITHDRAWAL_REQUEST_LIMIT: 3,
  /** Max watch-session starts per user per ad per day (retry budget after rejections). */
  MAX_WATCH_ATTEMPTS_PER_AD_PER_DAY: 3,
  /** Minimum campaign budget an advertiser can submit, in ETB. */
  MIN_CAMPAIGN_BUDGET_ETB: 100,
  /** Minimum cost per valid action an advertiser can set, in ETB. */
  MIN_COST_PER_ACTION_ETB: 0.5,
  /** Minimum wallet top-up, in ETB. */
  MIN_TOPUP_ETB: 100,
  /** Max payout attempts per withdrawal (admin retries) before it stays failed. */
  PAYOUT_MAX_ATTEMPTS: 3,
  /** Phone-only (non-KYC) users may receive at most this much in a rolling 30-day window, in ETB. */
  KYC_REQUIRED_ABOVE_MONTHLY_ETB: 1000,
  /** Default per-campaign frequency cap (rewarded completions per user per UTC day). */
  DEFAULT_FREQUENCY_CAP: 1,
  /** Advertiser-editable frequency cap range. */
  MIN_FREQUENCY_CAP: 1,
  MAX_FREQUENCY_CAP: 5,
  /** Distinct ads from one advertiser a user may complete per UTC day. */
  ADVERTISER_IMPRESSION_CAP_PER_USER_PER_DAY: 3,
  /** Referral bonuses (coins) credited with the referee's first valid ad completion. */
  REFERRAL_BONUS_COINS: 500,
  REFEREE_BONUS_COINS: 200,
  /** Max paid referrals per referrer per UTC day. */
  REFERRAL_MAX_PER_REFERRER_PER_DAY: 5,
  /** A destination lookup (`/withdrawals/destinations/resolve`) is valid for this long. */
  DESTINATION_RESOLVE_TTL_MINUTES: 10,
  /** Account deletion is executed after this grace period (cancellable). */
  ACCOUNT_DELETION_GRACE_DAYS: 14,
  /** `Idempotency-Key` responses are replayable for this long. */
  IDEMPOTENCY_TTL_HOURS: 24,
} as const;

/** Length and alphabet of user referral codes (no 0/O/1/I to stay readable when spoken/typed). */
export const REFERRAL_CODE_LENGTH = 6;
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Header names for the idempotency protocol on money POSTs. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

/**
 * Phase 5 (#16) - browser refresh-token mode. Send `X-Auth-Mode: cookie` (or `?mode=cookie`) on the login /
 * register / refresh / logout endpoints and the API keeps the refresh token in an httpOnly, Secure,
 * SameSite=Strict cookie (`rap_refresh`, path /api/v1/auth) instead of returning it in the body
 * (`tokens.refreshToken` is omitted, `tokens.authMode === 'cookie'`). Requests must be made with
 * `credentials: 'include'`. The mobile app keeps the default body mode.
 */
export const AUTH_MODE_HEADER = 'X-Auth-Mode';
export const AUTH_MODE_COOKIE = 'cookie';
export const REFRESH_COOKIE_NAME = 'rap_refresh';

/** Endpoints that honour `Idempotency-Key` (relative to API_BASE_PATH). */
export const IDEMPOTENT_ENDPOINTS = [
  'POST /withdrawals',
  'POST /billing/topups',
  'POST /admin/coin-adjustments',
  'POST /offers/surveys/:id/complete',
  'POST /offers/app-installs/:id/complete',
] as const;

/** KYC document upload constraints enforced by the API (private bucket prefix, presigned PUT). */
export const KYC_UPLOAD_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  kinds: ['document_front', 'document_back', 'selfie'],
} as const;
export type KycUploadKind = (typeof KYC_UPLOAD_LIMITS.kinds)[number];

/** Referral rejection reasons (`ReferralItem.rejectionReason`). */
export const REFERRAL_REJECTION_REASONS = [
  'self_referral_device',
  'self_referral_ip',
  'referrer_daily_cap',
  'referrer_inactive',
] as const;
export type ReferralRejectionReason = (typeof REFERRAL_REJECTION_REASONS)[number];

/** Reasons a withdrawal is held for manual review (`WithdrawalItem.reviewReasons`). */
export const WITHDRAWAL_REVIEW_REASONS = ['first_withdrawal', 'large_amount', 'low_trust_score'] as const;
export type WithdrawalReviewReason = (typeof WITHDRAWAL_REVIEW_REASONS)[number];

/** Access token lifetime the frontends should assume (they must still handle 401 + refresh). */
export const ACCESS_TOKEN_TTL_SECONDS_DEFAULT = 900;

export const SUPPORTED_LANGUAGES = ['am', 'en', 'om', 'ti'] as const;
export const DEFAULT_LANGUAGE = 'am';

/** Banned advertising topics that reviewers must check (spec §7). Stored per ad as a structured checklist. */
export const BANNED_TOPICS = [
  { key: 'alcohol', label: 'Alcohol' },
  { key: 'gambling', label: 'Gambling / betting / chance-based promotions' },
  { key: 'restricted_medicine', label: 'Prescription or restricted medicines' },
  { key: 'political', label: 'Political content' },
  { key: 'tobacco', label: 'Tobacco / khat / vaping' },
  { key: 'adult', label: 'Adult / sexual content' },
  { key: 'weapons', label: 'Weapons' },
  { key: 'misleading_financial', label: 'Misleading financial / get-rich-quick claims' },
] as const;
export type BannedTopicKey = (typeof BANNED_TOPICS)[number]['key'];

/** Ethiopian mobile numbers: 09xxxxxxxx / 07xxxxxxxx / +2519xxxxxxxx / +2517xxxxxxxx. */
export const ETHIOPIAN_PHONE_REGEX = /^(\+251|0)(9|7)\d{8}$/;

export const PAYOUT_METHOD_INFO = {
  telebirr: {
    label: 'telebirr',
    destinationHint: 'telebirr phone number (09.. or +2519..)',
    destinationKind: 'phone',
  },
  cbe_birr: { label: 'CBE Birr', destinationHint: 'CBE Birr phone number', destinationKind: 'phone' },
  bank: {
    label: 'Bank transfer',
    destinationHint: 'Bank account number (settled via Chapa)',
    destinationKind: 'bank_account',
  },
} as const;

/** Creative upload constraints enforced by the API. */
export const UPLOAD_LIMITS = {
  video: { maxBytes: 100 * 1024 * 1024, mimeTypes: ['video/mp4', 'video/webm'], maxDurationSeconds: 120 },
  image: { maxBytes: 5 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
} as const;

/** Support contact shown in the mobile app (placeholder values; override via env on the API). */
export const SUPPORT_CONTACT_DEFAULTS = {
  telegram: 'https://t.me/rap_support',
  phone: '+251900000000',
} as const;
