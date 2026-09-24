import { SUPPORT_CONTACT_DEFAULTS } from '@rap/shared';

/**
 * Working brand name (placeholder - see README "Assumptions"). Amharic ጊዜ = "time";
 * the brand promise is "your time has value" / «ጊዜዎ ዋጋ አለው». Keep it in this single constant.
 */
export const BRAND_NAME = 'Gize';
export const BRAND_NAME_AM = 'ጊዜ';

const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** API origin (no /api/v1). Physical devices must use the computer's LAN IP, not localhost. */
export const API_URL = trimSlash(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000');

export const SUPPORT = {
  telegram: process.env.EXPO_PUBLIC_SUPPORT_TELEGRAM ?? SUPPORT_CONTACT_DEFAULTS.telegram,
  phone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? SUPPORT_CONTACT_DEFAULTS.phone,
} as const;

export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '';

/** `__DEV__` is provided by Metro/Jest; fall back for plain Node. */
export const IS_DEV: boolean = typeof __DEV__ === 'boolean' ? __DEV__ : process.env.NODE_ENV !== 'production';

export const APP_SCHEME = 'gize';
