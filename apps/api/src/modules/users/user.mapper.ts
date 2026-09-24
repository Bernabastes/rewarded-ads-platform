import type { User } from '@prisma/client';

export interface UserProfileView {
  id: string;
  phoneNumber: string;
  fullName: string | null;
  dateOfBirth: string | null;
  ageVerificationStatus: User['ageVerificationStatus'];
  languagePreference: User['languagePreference'];
  status: User['status'];
  trustScore: number;
  coinBalance: number;
  notificationPrefs: { rewards: boolean; withdrawals: boolean; offers: boolean };
  profileComplete: boolean;
  createdAt: Date;
}

export const DEFAULT_NOTIFICATION_PREFS = { rewards: true, withdrawals: true, offers: true };

export function toUserProfile(user: User): UserProfileView {
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...((user.notificationPrefs as Record<string, boolean>) ?? {}) };
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    fullName: user.fullName,
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
    ageVerificationStatus: user.ageVerificationStatus,
    languagePreference: user.languagePreference,
    status: user.status,
    trustScore: user.trustScore,
    coinBalance: user.coinBalance,
    notificationPrefs: prefs,
    profileComplete: Boolean(user.fullName && user.dateOfBirth && user.ageVerificationStatus === 'verified_adult'),
    createdAt: user.createdAt,
  };
}
