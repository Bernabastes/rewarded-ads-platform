import type { Language, MyReferralsResponse, ReferralStatus } from '@rap/shared';
import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from '@rap/shared';

/** Upper-cases and strips separators; returns the cleaned code (may still be invalid). */
export function normalizeReferralCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, REFERRAL_CODE_LENGTH);
}

/** Format check only (length + alphabet); the server decides whether the code exists. */
export function referralCodeLooksValid(code: string): boolean {
  if (code.length !== REFERRAL_CODE_LENGTH) return false;
  return [...code].every((ch) => REFERRAL_CODE_ALPHABET.includes(ch));
}

/** The server ships English + Amharic share texts; other UI languages fall back to Amharic (the product default). */
export function shareTextFor(referrals: Pick<MyReferralsResponse, 'shareText' | 'shareUrl' | 'code'>, language: Language): string {
  const text = language === 'en' ? referrals.shareText.en : referrals.shareText.am;
  return text || `${referrals.code} ${referrals.shareUrl}`;
}

export type ReferralTone = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

export const REFERRAL_STATUS_TONE: Record<ReferralStatus, ReferralTone> = {
  pending: 'info',
  qualified: 'warning',
  paid: 'success',
  rejected: 'danger',
};
