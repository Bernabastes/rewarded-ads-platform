import type {
  AdminRole,
  AdvertiserVerificationStatus,
  AgeVerificationStatus,
  AuthSubjectType,
  KycTier,
  Language,
  LegalDocumentKind,
  UserStatus,
} from '../enums';
import type { IsoDate, IsoDateTime, Uuid } from './common';

export interface AuthTokens {
  accessToken: string;
  /** Opaque, single-use rotating refresh token. Store securely (Keychain/Keystore, never localStorage on web if avoidable). */
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  tokenType: 'Bearer';
}

/** Decoded access-token claims (informational; verify server-side only). */
export interface AccessTokenClaims {
  sub: Uuid;
  /** `impersonation` = short-lived read-only user token issued to a support admin (see `actorAdminId`). */
  typ: AuthSubjectType | 'impersonation';
  role?: AdminRole;
  /** Present on impersonation tokens: the admin acting on the user's behalf. */
  actorAdminId?: Uuid;
  iat: number;
  exp: number;
}

export interface OtpRequestDto {
  /** Ethiopian mobile number in any common format; normalised to +2519xxxxxxxx. */
  phoneNumber: string;
}

export interface OtpRequestResponse {
  phoneNumber: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Present ONLY when the API runs with OTP_DEV_ECHO=true (dev/demo). */
  devCode?: string;
}

export interface OtpVerifyDto {
  phoneNumber: string;
  code: string;
  /** Stable installation identifier. */
  deviceId?: string;
  /** Device fingerprint hash collected by the client. */
  deviceFingerprint?: string;
  /**
   * Referral code of the inviting user (6 chars). Only honoured on the FIRST login of a new account; ignored
   * (never an error) for existing accounts. Invalid codes -> 400 REFERRAL_CODE_INVALID.
   */
  referralCode?: string;
}

export interface NotificationPrefs {
  rewards: boolean;
  withdrawals: boolean;
  offers: boolean;
}

/** Ethiopian (Amete Mihret) calendar date; month 13 = Pagume (5 days, 6 in leap years). */
export interface EthiopianDate {
  year: number;
  month: number;
  day: number;
}

export interface UserConsentState {
  kind: LegalDocumentKind;
  /** Version the user accepted (null = never). */
  acceptedVersion: string | null;
  /** Latest published version. */
  currentVersion: string | null;
  acceptedAt: IsoDateTime | null;
  /** true when acceptedVersion !== currentVersion. */
  outdated: boolean;
}

export interface UserProfile {
  id: Uuid;
  phoneNumber: string;
  fullName: string | null;
  dateOfBirth: IsoDate | null;
  /** Same birth date in the Ethiopian calendar (derived server-side). */
  dateOfBirthEthiopian: EthiopianDate | null;
  ageVerificationStatus: AgeVerificationStatus;
  languagePreference: Language;
  status: UserStatus;
  trustScore: number;
  coinBalance: number;
  notificationPrefs: NotificationPrefs;
  /** true once full name + date of birth are set and age is verified. */
  profileComplete: boolean;
  kycTier: KycTier;
  /** Shareable referral code (generated on first read). */
  referralCode: string | null;
  /** Per-kind consent state for the current legal document versions. */
  consents: UserConsentState[];
  /** Kinds whose current version is not accepted; when non-empty, money endpoints return 403 CONSENT_REQUIRED. */
  requiresConsent: LegalDocumentKind[];
  createdAt: IsoDateTime;
}

export interface OtpVerifyResponse {
  tokens: AuthTokens;
  user: UserProfile;
  isNewUser: boolean;
  /** Present when a referral code was applied on this (first) login. */
  referralApplied?: boolean;
}

export interface CompleteProfileDto {
  fullName: string;
  /** "YYYY-MM-DD" (Gregorian). Provide EITHER this OR `dateOfBirthEthiopian`. Age is computed server-side. */
  dateOfBirth?: IsoDate;
  /** Ethiopian calendar birth date; converted and validated server-side (Pagume/leap rules). */
  dateOfBirthEthiopian?: EthiopianDate;
  languagePreference?: Language;
}

export interface AdvertiserRegisterDto {
  businessName: string;
  businessRegistrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  /** Min 8 chars, at least one letter and one digit. */
  password: string;
  /** Version of the advertiser terms accepted at registration (from GET /legal/current?audience=advertiser). */
  termsVersion?: string;
}

export interface EmailPasswordLoginDto {
  email: string;
  password: string;
}

export interface AdvertiserNotificationPrefs {
  /** Campaign / creative approved or rejected. */
  campaignReviews: boolean;
  /** Top-ups, invoices, low balance. */
  billing: boolean;
  /** Weekly performance summary. */
  weeklyReport: boolean;
}

export interface AdvertiserProfile {
  id: Uuid;
  businessName: string;
  businessRegistrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  verificationStatus: AdvertiserVerificationStatus;
  verificationNote: string | null;
  walletBalanceEtb: number;
  notificationPrefs: AdvertiserNotificationPrefs;
  /** Advertiser terms version currently accepted (null = none). Campaign submit requires the current version. */
  acceptedTermsVersion: string | null;
  /** Latest published advertiser terms version. */
  currentTermsVersion: string | null;
  /** true when the advertiser must accept the current terms before submitting campaigns. */
  requiresTermsAcceptance: boolean;
  createdAt: IsoDateTime;
}

/** `PATCH /advertisers/me` – identity fields (registration number, email) are not editable here. */
export interface UpdateAdvertiserProfileDto {
  businessName?: string;
  contactPhone?: string;
  notificationPrefs?: Partial<AdvertiserNotificationPrefs>;
}

/** `POST /auth/advertiser/change-password` – revokes every refresh token; re-login required. */
export interface ChangePasswordDto {
  currentPassword: string;
  /** Min 8 chars, at least one letter and one digit. */
  newPassword: string;
}

export interface AdvertiserAuthResponse {
  tokens: AuthTokens;
  advertiser: AdvertiserProfile;
}

export interface AdminProfile {
  id: Uuid;
  email: string;
  fullName: string;
  role: AdminRole;
  active: boolean;
  lastLoginAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  /** Same shape as GET /admin/me: role(s) and coarse permission strings the UI can gate on. */
  roles: AdminRole[];
  permissions: string[];
}

export interface AdminAuthResponse {
  tokens: AuthTokens;
  admin: AdminProfile;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface LogoutDto {
  refreshToken: string;
}
