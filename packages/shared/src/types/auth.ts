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
  /**
   * Opaque, single-use rotating refresh token (body mode - the mobile app). Store securely (Keychain/Keystore).
   * Phase 5 (#16): in cookie mode (`X-Auth-Mode: cookie`, used by the web consoles) this field is OMITTED and the
   * token travels only in the httpOnly `rap_refresh` cookie - see `CookieModeAuthTokens`.
   */
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  tokenType: 'Bearer';
}

/** Token payload returned to a client that requested cookie mode: no refresh token in the body. */
export interface CookieModeAuthTokens {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  authMode: 'cookie';
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
  /** Phase 5 (#5): TOTP second factor enabled (login then needs POST /auth/admin/login/mfa). */
  mfaEnabled: boolean;
  /**
   * ADMIN_MFA_REQUIRED is on, this role (finance / super_admin) must use MFA and it is not enabled yet:
   * every admin route except /admin/me, /admin/me/mfa/* and /admin/me/change-password answers 403 MFA_SETUP_REQUIRED.
   */
  mfaSetupRequired: boolean;
  /** Temporary password (account created / reset by a super_admin): only /admin/me + change-password work until changed. */
  mustChangePassword: boolean;
}

export interface AdminAuthResponse {
  tokens: AuthTokens;
  admin: AdminProfile;
}

/** First login step for an admin with MFA enabled: no tokens yet; finish with POST /auth/admin/login/mfa. */
export interface AdminMfaChallengeResponse {
  mfaRequired: true;
  /** Short-lived (5 min), single-use token binding the second step to the verified password. */
  mfaToken: string;
  expiresIn: number;
}

export type AdminLoginResponse = AdminAuthResponse | AdminMfaChallengeResponse;

export function isAdminMfaChallenge(res: AdminLoginResponse): res is AdminMfaChallengeResponse {
  return (res as AdminMfaChallengeResponse).mfaRequired === true;
}

export interface AdminMfaLoginDto {
  mfaToken: string;
  /** 6-digit TOTP code from the authenticator app. */
  code: string;
}

/** `POST /admin/me/mfa/setup` – a pending secret; MFA is NOT active until /enable confirms a valid code. */
export interface MfaSetupResponse {
  /** Base32 secret for manual entry. */
  secret: string;
  /** otpauth:// URI for QR-code rendering. */
  otpauthUri: string;
  issuer: string;
  account: string;
}

/** Phase 5b New-7: starting enrolment re-authenticates with the current password (401 INVALID_CREDENTIALS). */
export interface MfaSetupDto {
  password: string;
}

/** Phase 5b New-7: `code` + the current password; attempts are throttled / lockout-counted like a login. */
export interface MfaEnableDto {
  code: string;
  password: string;
}

export interface MfaDisableDto {
  code: string;
  password: string;
}

export interface MfaStatusResponse {
  mfaEnabled: boolean;
  mfaEnabledAt: IsoDateTime | null;
}

/** `POST /admin/me/change-password` – revokes every other admin session (re-login required). */
export interface AdminChangePasswordResponse {
  changed: true;
  sessionsRevoked: true;
}

/** `GET /admin/admins` list item (super_admin only). */
export interface AdminAccountItem {
  id: Uuid;
  email: string;
  fullName: string;
  role: AdminRole;
  active: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: IsoDateTime | null;
  passwordChangedAt: IsoDateTime | null;
  createdBy: Uuid | null;
  createdAt: IsoDateTime;
}

/** `POST /admin/admins` */
export interface CreateAdminDto {
  email: string;
  fullName: string;
  role: AdminRole;
}

/** The temporary password is shown ONCE; the new admin must change it at first login. */
export interface CreateAdminResponse {
  admin: AdminAccountItem;
  temporaryPassword: string;
}

/** `PATCH /admin/admins/:id/role` – stamps tokens_invalid_before so the old role dies immediately. */
export interface UpdateAdminRoleDto {
  role: AdminRole;
  reason: string;
}

/** `POST /admin/admins/:id/reset-password` */
export interface ResetAdminPasswordResponse {
  admin: AdminAccountItem;
  temporaryPassword: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface LogoutDto {
  refreshToken: string;
}
