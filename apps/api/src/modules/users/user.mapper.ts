import type { LegalDocumentKind, User } from '@prisma/client';
import { type EthiopianDate, gregorianToEthiopian } from '@rap/shared';

export interface ConsentStateView {
  kind: LegalDocumentKind;
  acceptedVersion: string | null;
  currentVersion: string | null;
  acceptedAt: Date | null;
  outdated: boolean;
}

export interface UserProfileExtras {
  consents?: ConsentStateView[];
  requiresConsent?: LegalDocumentKind[];
}

export interface UserProfileView {
  id: string;
  phoneNumber: string;
  fullName: string | null;
  dateOfBirth: string | null;
  dateOfBirthEthiopian: EthiopianDate | null;
  ageVerificationStatus: User['ageVerificationStatus'];
  languagePreference: User['languagePreference'];
  status: User['status'];
  trustScore: number;
  coinBalance: number;
  notificationPrefs: { rewards: boolean; withdrawals: boolean; offers: boolean };
  profileComplete: boolean;
  kycTier: User['kycTier'];
  referralCode: string | null;
  consents: ConsentStateView[];
  requiresConsent: LegalDocumentKind[];
  createdAt: Date;
}

export const DEFAULT_NOTIFICATION_PREFS = { rewards: true, withdrawals: true, offers: true };

/** Gregorian Date (UTC) -> Ethiopian calendar date, null when absent. */
export function toEthiopianDate(date: Date | null): EthiopianDate | null {
  if (!date) return null;
  try {
    return gregorianToEthiopian({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  } catch {
    return null;
  }
}

export function toUserProfile(user: User, extras: UserProfileExtras = {}): UserProfileView {
  const prefs = {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...((user.notificationPrefs as Record<string, boolean>) ?? {}),
  };
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    fullName: user.fullName,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
    dateOfBirthEthiopian: toEthiopianDate(user.dateOfBirth),
    ageVerificationStatus: user.ageVerificationStatus,
    languagePreference: user.languagePreference,
    status: user.status,
    trustScore: user.trustScore,
    coinBalance: user.coinBalance,
    notificationPrefs: prefs,
    profileComplete: Boolean(
      user.fullName && user.dateOfBirth && user.ageVerificationStatus === 'verified_adult',
    ),
    kycTier: user.kycTier,
    referralCode: user.referralCode,
    consents: extras.consents ?? [],
    requiresConsent: extras.requiresConsent ?? [],
    createdAt: user.createdAt,
  };
}
