/**
 * Phase 4A contract: KYC tiers, legal consent, money-day alerts, referrals, data-subject rights,
 * idempotency. Enums live in ../enums, error codes in ../error-codes, routes in ../routes.
 */
import type { KycUploadKind, ReferralRejectionReason } from '../constants';
import type {
  AlertSeverity,
  AlertType,
  DataExportStatus,
  DeletionRequestStatus,
  KycIdType,
  KycStatus,
  KycTier,
  Language,
  LegalDocumentKind,
  ReferralStatus,
  UserStatus,
} from '../enums';
import type { EthiopianDate } from './auth';
import type { DateRangeQuery, IsoDate, IsoDateTime, PaginationQuery, Uuid } from './common';

/* ------------------------------ legal / consent ------------------------------ */

export interface LegalDocumentItem {
  id: Uuid;
  kind: LegalDocumentKind;
  version: string;
  locale: Language;
  title: string;
  /** Hosted URL (may be null when `contentMarkdown` is provided). */
  url: string | null;
  contentMarkdown: string | null;
  publishedAt: IsoDateTime;
}

/** `GET /legal/current?locale=am&audience=user|advertiser` -> one document per kind in the requested locale. */
export interface CurrentLegalDocumentsResponse {
  locale: Language;
  audience: 'user' | 'advertiser';
  documents: LegalDocumentItem[];
}

/** `POST /users/me/consents` / `POST /advertisers/me/consents` */
export interface AcceptConsentDto {
  kind: LegalDocumentKind;
  /** Must equal the current version (else 409 CONSENT_VERSION_OUTDATED). */
  version: string;
}

export interface ConsentRecord {
  kind: LegalDocumentKind;
  version: string;
  acceptedAt: IsoDateTime;
}

/* ------------------------------ KYC ------------------------------ */

/** `POST /users/me/kyc/uploads/presign` */
export interface KycPresignDto {
  kind: KycUploadKind;
  contentType: string;
  sizeBytes: number;
}

/** `POST /users/me/kyc` */
export interface CreateKycSubmissionDto {
  idType: KycIdType;
  /** Raw id number; only a hash + last 4 digits are stored. */
  idNumber: string;
  fullName: string;
  /** Gregorian `YYYY-MM-DD`, or provide `dateOfBirthEthiopian`. */
  dateOfBirth?: IsoDate;
  dateOfBirthEthiopian?: EthiopianDate;
  /** Storage keys returned by the presign endpoint (private bucket prefix). */
  documentFrontKey: string;
  documentBackKey?: string;
  selfieKey: string;
}

export interface KycSubmissionItem {
  id: Uuid;
  userId: Uuid;
  idType: KycIdType;
  idNumberLast4: string;
  fullName: string;
  dateOfBirth: IsoDate;
  status: KycStatus;
  /** Provider pre-check (mock Fayda today): { provider, mock, match, score }. */
  providerName: string | null;
  providerResult: Record<string, unknown> | null;
  reviewedAt: IsoDateTime | null;
  /** Rejection reason (shown to the user). */
  reason: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `GET /users/me/kyc` */
export interface MyKycResponse {
  kycTier: KycTier;
  /** Latest submission, if any. */
  submission: KycSubmissionItem | null;
  /** Whether a new submission may be created (no pending one, tier not already id_verified). */
  canSubmit: boolean;
  requiredAboveMonthlyEtb: number;
  monthlyPayoutTotalEtb: number;
  uploadLimits: { maxBytes: number; mimeTypes: readonly string[] };
}

export interface AdminKycQuery extends PaginationQuery {
  status?: KycStatus;
  idType?: KycIdType;
  /** Search phone / name / last 4 digits. */
  q?: string;
}

export interface AdminKycSummary extends KycSubmissionItem {
  user: { id: Uuid; phoneNumber: string; fullName: string | null; kycTier: KycTier; trustScore: number };
  reviewedBy: Uuid | null;
}

/** `GET /admin/kyc/:id` - document links are presigned GET URLs valid for 5 minutes. */
export interface AdminKycDetail extends AdminKycSummary {
  documents: {
    front: { url: string; expiresInSeconds: number };
    back: { url: string; expiresInSeconds: number } | null;
    selfie: { url: string; expiresInSeconds: number };
  };
  /** Does the submitted name / DOB match the profile? */
  profileMatch: { fullName: boolean; dateOfBirth: boolean };
  /** Other users who submitted the same id number hash (duplicate identity check). */
  duplicateIdentityUsers: number;
}

export interface KycDecisionDto {
  /** Required for reject. */
  reason?: string;
  note?: string;
}

/* ------------------------------ alerts ------------------------------ */

export interface PlatformAlertItem {
  id: Uuid;
  type: AlertType | (string & {});
  severity: AlertSeverity;
  title: string;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  deliveries: Array<{ notifier: string; ok: boolean; error?: string }> | null;
  acknowledgedBy: Uuid | null;
  acknowledgedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface AdminAlertsQuery extends PaginationQuery, DateRangeQuery {
  type?: string;
  severity?: AlertSeverity;
  /** true = only acknowledged, false = only open. */
  acknowledged?: boolean;
}

export interface AlertRulesRunResult {
  ranAt: IsoDateTime;
  rules: Array<{ rule: string; raised: number; checked: number }>;
}

/* ------------------------------ referrals ------------------------------ */

export interface ReferralItem {
  id: Uuid;
  status: ReferralStatus;
  /** Masked phone / name of the invited user. */
  referee: { id: Uuid; displayName: string; joinedAt: IsoDateTime };
  referrerBonusCoins: number;
  refereeBonusCoins: number;
  qualifiedAt: IsoDateTime | null;
  paidAt: IsoDateTime | null;
  rejectionReason: ReferralRejectionReason | (string & {}) | null;
  createdAt: IsoDateTime;
}

/** `GET /users/me/referrals` */
export interface MyReferralsResponse {
  code: string;
  /** Ready-to-share text (English + Amharic) containing the code; the client may localise its own. */
  shareText: { en: string; am: string };
  /** Deep link / store URL template the mobile app should share (placeholder until store listing exists). */
  shareUrl: string;
  bonusCoins: { referrer: number; referee: number };
  maxPerDay: number;
  totals: { invited: number; pending: number; paid: number; rejected: number; coinsEarned: number };
  /** Set when this user was referred by someone. */
  referredBy: { status: ReferralStatus; bonusCoins: number; qualifiedAt: IsoDateTime | null } | null;
  referrals: ReferralItem[];
}

export interface AdminReferralsQuery extends PaginationQuery {
  status?: ReferralStatus;
  referrerId?: Uuid;
  refereeId?: Uuid;
}

export interface AdminReferralItem extends ReferralItem {
  referrer: { id: Uuid; phoneNumber: string; fullName: string | null };
  refereePhone: string;
  signupIp: string | null;
  signupDeviceFingerprint: string | null;
}

export interface AdminReferralMetrics {
  total: number;
  byStatus: Record<ReferralStatus, number>;
  bonusCoinsPaid: number;
  bonusEtbPaid: number;
  last7Days: { invited: number; paid: number; rejected: number };
  topReferrers: Array<{ userId: Uuid; phoneNumber: string; fullName: string | null; paid: number }>;
}

/* ------------------------------ data rights ------------------------------ */

export interface DataExportItem {
  id: Uuid;
  status: DataExportStatus;
  requestedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  expiresAt: IsoDateTime | null;
  sizeBytes: number | null;
  /** Presigned link (valid `downloadExpiresInSeconds`) when status is ready. */
  downloadUrl: string | null;
  downloadExpiresInSeconds: number | null;
  error: string | null;
}

/** `POST /users/me/delete-request` */
export interface CreateDeletionRequestDto {
  reason?: string;
}

export interface DeletionRequestItem {
  id: Uuid;
  userId: Uuid;
  status: DeletionRequestStatus;
  reason: string | null;
  requestedAt: IsoDateTime;
  /** Execution date (requestedAt + ACCOUNT_DELETION_GRACE_DAYS); cancellable until then. */
  scheduledFor: IsoDateTime;
  executedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  graceDays: number;
}

export interface AdminDeletionRequestItem extends DeletionRequestItem {
  user: { id: Uuid; phoneNumber: string; fullName: string | null; status: UserStatus; coinBalance: number };
  /** Withdrawals still in flight (execution is blocked while > 0). */
  pendingWithdrawals: number;
  executedBy: Uuid | null;
  cancelledBy: Uuid | null;
  note: string | null;
}

export interface AdminDeletionRequestsQuery extends PaginationQuery {
  status?: DeletionRequestStatus;
}

/* ------------------------------ idempotency ------------------------------ */

/** Error `details` for 409 IDEMPOTENCY_KEY_REUSED. */
export interface IdempotencyConflictDetails {
  key: string;
  /** true when the original request with this key is still running. */
  inProgress: boolean;
}
