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
} as const;

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
