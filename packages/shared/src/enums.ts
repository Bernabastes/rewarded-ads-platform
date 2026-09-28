/**
 * String enums mirroring the Prisma enums in apps/api/prisma/schema.prisma.
 *
 * They are declared as `const` objects + union types (not TS `enum`s) so they
 * are trivially consumable from Vite (advertiser/admin web) and Metro (Expo)
 * with `isolatedModules`, and so the wire format is always the plain string.
 */

type ValueOf<T> = T[keyof T];

export const AgeVerificationStatus = {
  pending: 'pending',
  verified_adult: 'verified_adult',
  rejected: 'rejected',
} as const;
export type AgeVerificationStatus = ValueOf<typeof AgeVerificationStatus>;

export const UserStatus = {
  active: 'active',
  suspended: 'suspended',
  banned: 'banned',
  /** Account deletion executed: PII anonymised, financial records retained. */
  deleted: 'deleted',
} as const;
export type UserStatus = ValueOf<typeof UserStatus>;

export const KycTier = {
  phone_only: 'phone_only',
  id_verified: 'id_verified',
} as const;
export type KycTier = ValueOf<typeof KycTier>;

export const KycIdType = {
  fayda: 'fayda',
  national_id: 'national_id',
  passport: 'passport',
} as const;
export type KycIdType = ValueOf<typeof KycIdType>;

export const KycStatus = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
} as const;
export type KycStatus = ValueOf<typeof KycStatus>;

export const LegalDocumentKind = {
  terms: 'terms',
  privacy: 'privacy',
} as const;
export type LegalDocumentKind = ValueOf<typeof LegalDocumentKind>;

export const AlertSeverity = {
  info: 'info',
  warning: 'warning',
  critical: 'critical',
} as const;
export type AlertSeverity = ValueOf<typeof AlertSeverity>;

/** Alert rule identifiers emitted by the API (`PlatformAlert.type`). */
export const AlertType = {
  LEDGER_DRIFT: 'LEDGER_DRIFT',
  PAYOUT_FAILURE_RATE: 'PAYOUT_FAILURE_RATE',
  ACCOUNT_MINTING: 'ACCOUNT_MINTING',
  SPEND_VELOCITY: 'SPEND_VELOCITY',
  OTP_SPIKE: 'OTP_SPIKE',
  MANUAL: 'MANUAL',
} as const;
export type AlertType = ValueOf<typeof AlertType>;

export const ReferralStatus = {
  pending: 'pending',
  qualified: 'qualified',
  paid: 'paid',
  rejected: 'rejected',
} as const;
export type ReferralStatus = ValueOf<typeof ReferralStatus>;

export const MediaStatus = {
  processing: 'processing',
  ready: 'ready',
  duration_corrected: 'duration_corrected',
  failed: 'failed',
} as const;
export type MediaStatus = ValueOf<typeof MediaStatus>;

export const DataExportStatus = {
  pending: 'pending',
  processing: 'processing',
  ready: 'ready',
  failed: 'failed',
} as const;
export type DataExportStatus = ValueOf<typeof DataExportStatus>;

export const DeletionRequestStatus = {
  pending: 'pending',
  executed: 'executed',
  cancelled: 'cancelled',
} as const;
export type DeletionRequestStatus = ValueOf<typeof DeletionRequestStatus>;

export const Language = {
  am: 'am',
  en: 'en',
  om: 'om',
  ti: 'ti',
} as const;
export type Language = ValueOf<typeof Language>;

export const AdvertiserVerificationStatus = {
  pending: 'pending',
  verified: 'verified',
  rejected: 'rejected',
} as const;
export type AdvertiserVerificationStatus = ValueOf<typeof AdvertiserVerificationStatus>;

export const CampaignStatus = {
  draft: 'draft',
  pending_review: 'pending_review',
  active: 'active',
  paused: 'paused',
  completed: 'completed',
  rejected: 'rejected',
} as const;
export type CampaignStatus = ValueOf<typeof CampaignStatus>;

export const TargetActionType = {
  video_view: 'video_view',
  survey: 'survey',
  app_install: 'app_install',
} as const;
export type TargetActionType = ValueOf<typeof TargetActionType>;

export const MediaType = {
  video: 'video',
  image: 'image',
} as const;
export type MediaType = ValueOf<typeof MediaType>;

export const ReviewStatus = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
} as const;
export type ReviewStatus = ValueOf<typeof ReviewStatus>;

export const WatchSessionStatus = {
  active: 'active',
  completed: 'completed',
  rejected: 'rejected',
  abandoned: 'abandoned',
  expired: 'expired',
} as const;
export type WatchSessionStatus = ValueOf<typeof WatchSessionStatus>;

export const CompletionStatus = {
  valid: 'valid',
  flagged: 'flagged',
  rejected: 'rejected',
} as const;
export type CompletionStatus = ValueOf<typeof CompletionStatus>;

export const LedgerSourceType = {
  ad_view: 'ad_view',
  survey: 'survey',
  app_install: 'app_install',
  withdrawal: 'withdrawal',
  withdrawal_reversal: 'withdrawal_reversal',
  admin_adjustment: 'admin_adjustment',
  reconciliation: 'reconciliation',
  /** Referral bonus (referrer or referee). */
  referral: 'referral',
} as const;
export type LedgerSourceType = ValueOf<typeof LedgerSourceType>;

export const PayoutMethod = {
  telebirr: 'telebirr',
  bank: 'bank',
  cbe_birr: 'cbe_birr',
} as const;
export type PayoutMethod = ValueOf<typeof PayoutMethod>;

export const WithdrawalStatus = {
  pending: 'pending',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
  flagged_for_review: 'flagged_for_review',
  rejected: 'rejected',
} as const;
export type WithdrawalStatus = ValueOf<typeof WithdrawalStatus>;

export const ApprovalDecision = {
  approved: 'approved',
  rejected: 'rejected',
} as const;
export type ApprovalDecision = ValueOf<typeof ApprovalDecision>;

export const FraudSeverity = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
} as const;
export type FraudSeverity = ValueOf<typeof FraudSeverity>;

export const FraudResolution = {
  dismissed: 'dismissed',
  escalated: 'escalated',
  confirmed: 'confirmed',
} as const;
export type FraudResolution = ValueOf<typeof FraudResolution>;

export const AdminRole = {
  super_admin: 'super_admin',
  ad_reviewer: 'ad_reviewer',
  support: 'support',
  finance: 'finance',
} as const;
export type AdminRole = ValueOf<typeof AdminRole>;

export const ActorType = {
  admin: 'admin',
  system: 'system',
  user: 'user',
  advertiser: 'advertiser',
} as const;
export type ActorType = ValueOf<typeof ActorType>;

export const AuthSubjectType = {
  user: 'user',
  advertiser: 'advertiser',
  admin: 'admin',
} as const;
export type AuthSubjectType = ValueOf<typeof AuthSubjectType>;

export const CoinAdjustmentStatus = {
  pending_approval: 'pending_approval',
  executed: 'executed',
  rejected: 'rejected',
  cancelled: 'cancelled',
} as const;
export type CoinAdjustmentStatus = ValueOf<typeof CoinAdjustmentStatus>;

export const AdvertiserLedgerEntryType = {
  topup: 'topup',
  campaign_budget_reservation: 'campaign_budget_reservation',
  campaign_budget_refund: 'campaign_budget_refund',
  adjustment: 'adjustment',
} as const;
export type AdvertiserLedgerEntryType = ValueOf<typeof AdvertiserLedgerEntryType>;

export const PaymentStatus = {
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;
export type PaymentStatus = ValueOf<typeof PaymentStatus>;

export const InvoiceStatus = {
  issued: 'issued',
  paid: 'paid',
  void: 'void',
} as const;
export type InvoiceStatus = ValueOf<typeof InvoiceStatus>;

export const NotificationType = {
  reward_confirmed: 'reward_confirmed',
  reward_flagged: 'reward_flagged',
  withdrawal_status: 'withdrawal_status',
  new_offer: 'new_offer',
  account_status: 'account_status',
  system: 'system',
  kyc_status: 'kyc_status',
  referral: 'referral',
  data_export: 'data_export',
  account_deletion: 'account_deletion',
} as const;
export type NotificationType = ValueOf<typeof NotificationType>;

export const PushStatus = {
  pending: 'pending',
  sent: 'sent',
  failed: 'failed',
  skipped: 'skipped',
} as const;
export type PushStatus = ValueOf<typeof PushStatus>;

export const DevicePlatform = {
  android: 'android',
  ios: 'ios',
  web: 'web',
} as const;
export type DevicePlatform = ValueOf<typeof DevicePlatform>;

export const AdReportReason = {
  inappropriate: 'inappropriate',
  misleading: 'misleading',
  broken_media: 'broken_media',
  offensive: 'offensive',
  banned_topic: 'banned_topic',
  other: 'other',
} as const;
export type AdReportReason = ValueOf<typeof AdReportReason>;

export const AdReportStatus = {
  open: 'open',
  reviewed: 'reviewed',
  dismissed: 'dismissed',
} as const;
export type AdReportStatus = ValueOf<typeof AdReportStatus>;

export const OfferCompletionStatus = {
  pending_verification: 'pending_verification',
  valid: 'valid',
  flagged: 'flagged',
  rejected: 'rejected',
} as const;
export type OfferCompletionStatus = ValueOf<typeof OfferCompletionStatus>;

export const OfferType = {
  survey: 'survey',
  app_install: 'app_install',
} as const;
export type OfferType = ValueOf<typeof OfferType>;
