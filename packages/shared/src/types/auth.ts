import type {
  AdminRole,
  AdvertiserVerificationStatus,
  AgeVerificationStatus,
  AuthSubjectType,
  Language,
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
  typ: AuthSubjectType;
  role?: AdminRole;
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
}

export interface NotificationPrefs {
  rewards: boolean;
  withdrawals: boolean;
  offers: boolean;
}

export interface UserProfile {
  id: Uuid;
  phoneNumber: string;
  fullName: string | null;
  dateOfBirth: IsoDate | null;
  ageVerificationStatus: AgeVerificationStatus;
  languagePreference: Language;
  status: UserStatus;
  trustScore: number;
  coinBalance: number;
  notificationPrefs: NotificationPrefs;
  /** true once full name + date of birth are set and age is verified. */
  profileComplete: boolean;
  createdAt: IsoDateTime;
}

export interface OtpVerifyResponse {
  tokens: AuthTokens;
  user: UserProfile;
  isNewUser: boolean;
}

export interface CompleteProfileDto {
  fullName: string;
  /** "YYYY-MM-DD". Age is computed server-side; under MIN_AGE -> 403 AGE_RESTRICTED. */
  dateOfBirth: IsoDate;
  languagePreference?: Language;
}

export interface AdvertiserRegisterDto {
  businessName: string;
  businessRegistrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  /** Min 8 chars, at least one letter and one digit. */
  password: string;
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
