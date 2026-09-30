import type {
  ActorType,
  AdvertiserVerificationStatus,
  CampaignStatus,
  CoinAdjustmentStatus,
  FraudResolution,
  FraudSeverity,
  MediaStatus,
  OfferCompletionStatus,
  ReviewStatus,
  UserStatus,
  WithdrawalStatus,
} from '../enums';
import type { BannedTopicKey } from '../constants';
import type { AdminProfile, UserProfile } from './auth';
import type { AdSummary, BannedTopicsChecklist, CampaignAnalytics, CampaignSummary } from './campaigns';
import type {
  DailyPoint,
  DateRangeQuery,
  IsoDateTime,
  Paginated,
  PaginationMeta,
  PaginationQuery,
  Uuid,
} from './common';
import type { AdvertiserLedgerEntry, PaymentItem } from './billing';
import type { LedgerEntry } from './users';
import type { AdminKycSummary, DeletionRequestItem } from './phase4';
import type { WithdrawalApprovalItem, WithdrawalItem } from './withdrawals';

/* ---------- overview / config ---------- */

export interface AdminOverview {
  pendingAdReviews: number;
  pendingCampaignReviews: number;
  pendingAdvertiserVerifications: number;
  withdrawalsAwaitingReview: number;
  withdrawalsPendingPayout: number;
  pendingCoinAdjustments: number;
  openFraudFlags: number;
  openAdReports: number;
  activeUsers: number;
  suspendedUsers: number;
  activeCampaigns: number;
  todayValidCompletions: number;
  todayFlaggedCompletions: number;
  todayPlatformRevenueEtb: number;
  /** Phase 4 queues (single request instead of one per page). */
  pendingKyc: number;
  openAlerts: number;
  pendingDeletionRequests: number;
  adsMediaProcessing: number;
  adsMediaFailed: number;
}

export interface PlatformConfigResponse {
  coinsPerEtb: number;
  minWithdrawalEtb: number;
  largeWithdrawalThresholdEtb: number;
  dailyAdCompletionLimit: number;
  platformTakeRate: number;
  minWatchRatio: number;
  minAge: number;
  heartbeatIntervalSeconds: number;
  dailyWithdrawalRequestLimit: number;
  maxWatchAttemptsPerAdPerDay: number;
  /** Max payout attempts per withdrawal before it stays failed (admin retries count). */
  payoutMaxAttempts: number;
  minCampaignBudgetEtb: number;
  minCostPerActionEtb: number;
  minTopupEtb: number;
  kycRequiredAboveMonthlyEtb: number;
  defaultFrequencyCap: number;
  advertiserImpressionCapPerUserPerDay: number;
  referralBonusCoins: number;
  refereeBonusCoins: number;
  referralMaxPerReferrerPerDay: number;
  accountDeletionGraceDays: number;
  destinationResolveTtlMinutes: number;
  fraud: { flagThreshold: number; rejectThreshold: number; minTrustScoreForFeed: number };
  alerts: {
    payoutFailureRate: number;
    accountsPerDevicePerHour: number;
    spendVelocityMultiplier: number;
    otpRequestsPerIpPerHour: number;
  };
  mocks: {
    sms: boolean;
    payouts: boolean;
    paymentGateway: boolean;
    push: boolean;
    idVerification: boolean;
    alerts: boolean;
    destinationLookup: boolean;
  };
  environment: string;
  version: string;
}

/* ---------- ad review ---------- */

export interface AdReviewItem extends AdSummary {
  campaign: Pick<
    CampaignSummary,
    'id' | 'title' | 'status' | 'targetActionType' | 'costPerActionEtb' | 'budgetEtb'
  >;
  advertiser: { id: Uuid; businessName: string; verificationStatus: AdvertiserVerificationStatus };
  bannedTopicsChecklist: BannedTopicsChecklist | null;
  reviewedBy: Uuid | null;
  /** Free-text note left by the reviewer on approval. */
  reviewNote: string | null;
  openReports: number;
  attentionQuestions: Array<{ id: Uuid; prompt: string; options: string[]; correctIndex: number }>;
  /** The banned-topics checklist definition (same as `BANNED_TOPICS` in this package), for convenience. */
  bannedTopics: ReadonlyArray<{ key: BannedTopicKey; label: string }>;
}

export interface AdReviewQueueQuery extends PaginationQuery {
  status?: ReviewStatus;
  /** Filter by media pipeline state (e.g. `failed` to find creatives that need a reprocess). */
  mediaStatus?: MediaStatus;
}

export interface ApproveAdDto {
  /** Every banned topic must be explicitly confirmed absent (all checks true). */
  bannedTopicsChecklist: BannedTopicsChecklist;
  note?: string;
}

export interface RejectAdDto {
  reason: string;
  bannedTopicsChecklist?: BannedTopicsChecklist;
}

/* ---------- users ---------- */

export interface AdminUsersQuery extends PaginationQuery {
  /** Search phone / name. */
  q?: string;
  status?: UserStatus;
  minTrustScore?: number;
  maxTrustScore?: number;
}

export interface AdminUserListItem extends UserProfile {
  deviceId: string | null;
  statusReason: string | null;
  openFlags: number;
  lastLoginAt: IsoDateTime | null;
}

export interface AdminUserDetail extends AdminUserListItem {
  /** Last IP address seen at login (detail endpoint only). */
  lastIp: string | null;
  stats: {
    totalCompletions: number;
    validCompletions: number;
    flaggedCompletions: number;
    rejectedCompletions: number;
    totalEarnedCoins: number;
    totalWithdrawnEtb: number;
    distinctDevices: number;
    distinctIps: number;
  };
  recentLedger: LedgerEntry[];
  flags: FraudFlagItem[];
  withdrawals: WithdrawalItem[];
  /** Latest KYC submission (any status), if any. */
  kyc: AdminKycSummary | null;
  /** Pending deletion request, if any. */
  deletionRequest: DeletionRequestItem | null;
  referralStats: { referred: number; paid: number; bonusCoinsEarned: number };
}

/** `POST /admin/users/:id/impersonate` (support / super_admin) -> short-lived READ-ONLY user token. */
export interface ImpersonateUserDto {
  /** Support-ticket reference or reason; stored in the audit log. */
  reason: string;
}

export interface ImpersonationTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Seconds (10 minutes). No refresh token is issued. */
  expiresIn: number;
  expiresAt: IsoDateTime;
  user: { id: Uuid; phoneNumber: string; fullName: string | null };
  actorAdminId: Uuid;
  /** Always true: every non-GET request with this token fails with 403 IMPERSONATION_READ_ONLY. */
  readOnly: true;
}

export interface UserModerationDto {
  reason: string;
}

/* ---------- advertisers ---------- */

export interface AdminAdvertisersQuery extends PaginationQuery {
  status?: AdvertiserVerificationStatus;
  q?: string;
}

export interface AdminAdvertiserItem {
  id: Uuid;
  businessName: string;
  businessRegistrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  verificationStatus: AdvertiserVerificationStatus;
  verificationNote: string | null;
  verifiedBy: Uuid | null;
  verifiedAt: IsoDateTime | null;
  walletBalanceEtb: number;
  campaignsCount: number;
  lifetimeSpendEtb: number;
  createdAt: IsoDateTime;
}

export interface AdminAdvertiserDetail extends AdminAdvertiserItem {
  campaigns: CampaignSummary[];
}

/** `GET /admin/advertisers/:id/wallet` (finance / support / super_admin). */
export interface AdminAdvertiserWallet {
  advertiser: Pick<AdminAdvertiserItem, 'id' | 'businessName' | 'walletBalanceEtb' | 'verificationStatus'>;
  balanceEtb: number;
  reservedEtb: number;
  lifetimeTopupsEtb: number;
  lifetimeSpendEtb: number;
  ledger: Paginated<AdvertiserLedgerEntry>;
  /** Latest 50 gateway payments. */
  payments: Paginated<Omit<PaymentItem, 'checkoutUrl' | 'returnUrl'>>;
}

export interface VerifyAdvertiserDto {
  note?: string;
}

export interface RejectDto {
  reason: string;
}

/* ---------- campaigns ---------- */

export interface AdminCampaignsQuery extends PaginationQuery {
  status?: CampaignStatus;
  advertiserId?: Uuid;
}

export interface AdminCampaignItem extends CampaignSummary {
  advertiser: { id: Uuid; businessName: string };
}

/** `GET /admin/campaigns/:id`: summary + creatives + 30-day analytics. */
export interface AdminCampaignDetail extends AdminCampaignItem {
  ads: AdSummary[];
  analytics: CampaignAnalytics;
}

/* ---------- fraud ---------- */

export interface FraudFlagItem {
  id: Uuid;
  userId: Uuid | null;
  userPhone?: string | null;
  relatedEntityType: string;
  relatedEntityId: Uuid | null;
  flagType: string;
  severity: FraudSeverity;
  description: string;
  metadata: Record<string, unknown> | null;
  trustScoreDelta: number;
  resolved: boolean;
  resolution: FraudResolution | null;
  resolvedBy: Uuid | null;
  resolvedAt: IsoDateTime | null;
  resolutionNote: string | null;
  createdAt: IsoDateTime;
}

export interface FraudFlagsQuery extends PaginationQuery {
  severity?: FraudSeverity;
  resolved?: boolean;
  userId?: Uuid;
  flagType?: string;
  relatedEntityType?: string;
}

export interface FraudMetrics {
  /** Rolling 7 UTC days. */
  weekly: {
    rawCompletions: number;
    flaggedCompletions: number;
    rejectedCompletions: number;
    /** (flagged + rejected) / raw, 0..1 */
    flaggedRate: number;
  };
  openFlagsBySeverity: Record<FraudSeverity, number>;
  flagsByType: Array<{ flagType: string; count: number }>;
  suspendedUsers: number;
  bannedUsers: number;
  lowTrustUsers: number;
  ledgerDriftsDetected: number;
  daily: Array<
    DailyPoint & { rawCompletions: number; flaggedCompletions: number; rejectedCompletions: number }
  >;
}

export interface ResolveFlagDto {
  note: string;
}

export interface CreateFraudFlagDto {
  userId?: Uuid;
  relatedEntityType: string;
  relatedEntityId?: Uuid;
  flagType: string;
  severity: FraudSeverity;
  description: string;
  trustScoreDelta?: number;
  metadata?: Record<string, unknown>;
}

export interface ResolveFraudFlagDto {
  resolution: FraudResolution;
  note: string;
}

export interface FraudRuleInfo {
  id: string;
  description: string;
  severity: FraudSeverity;
  scoreWeight: number;
  trustScoreDelta: number;
}

/* ---------- withdrawals ---------- */

export interface AdminWithdrawalsQuery extends PaginationQuery {
  status?: WithdrawalStatus;
  userId?: Uuid;
}

export interface AdminWithdrawalItem extends WithdrawalItem {
  user: { id: Uuid; phoneNumber: string; fullName: string | null; trustScore: number; status: UserStatus };
  isFirstWithdrawal: boolean;
  approvals: WithdrawalApprovalItem[];
  /** Unmasked destination for finance staff. */
  payoutDestinationFull: string;
  bankCode: string | null;
  attempts: number;
  reviewNote: string | null;
  processedBy: Uuid | null;
}

export interface ApproveWithdrawalDto {
  note?: string;
}

/* ---------- coin adjustments ---------- */

export interface CreateCoinAdjustmentDto {
  userId: Uuid;
  /** Signed coins; non-zero. */
  amount: number;
  reason: string;
  /** Free-form reference (ticket id, etc.). */
  reference?: string;
}

export interface CoinAdjustmentItem {
  id: Uuid;
  userId: Uuid;
  userPhone?: string;
  amount: number;
  reason: string;
  reference: string | null;
  status: CoinAdjustmentStatus;
  requestedBy: Uuid;
  requestedByEmail?: string;
  approvedBy: Uuid | null;
  approvedByEmail?: string | null;
  rejectedBy: Uuid | null;
  decisionNote: string | null;
  ledgerEntryId: Uuid | null;
  executedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AdminCoinAdjustmentsQuery extends PaginationQuery {
  status?: CoinAdjustmentStatus;
  userId?: Uuid;
}

export interface DecideCoinAdjustmentDto {
  note?: string;
}

/* ---------- revenue ---------- */

export interface RevenueOverview {
  from: IsoDateTime;
  to: IsoDateTime;
  totals: {
    advertiserSpendEtb: number;
    userRewardsEtb: number;
    platformRevenueEtb: number;
    /** Referral bonuses credited in the period (platform cost, not funded by advertisers). */
    referralBonusesEtb: number;
    /** platformRevenueEtb - referralBonusesEtb. */
    netPlatformRevenueEtb: number;
    topupsEtb: number;
    payoutsCompletedEtb: number;
    payoutsPendingEtb: number;
    validCompletions: number;
    takeRate: number;
  };
  daily: Array<
    DailyPoint & {
      advertiserSpendEtb: number;
      userRewardsEtb: number;
      platformRevenueEtb: number;
      referralBonusesEtb: number;
      payoutsEtb: number;
      topupsEtb: number;
    }
  >;
  byAdvertiser: Array<{
    advertiserId: Uuid;
    businessName: string;
    spendEtb: number;
    validCompletions: number;
    share: number;
  }>;
  byActionType: Array<{ targetActionType: string; spendEtb: number; validCompletions: number }>;
}

export type RevenueQuery = DateRangeQuery;

/* ---------- audit log ---------- */

export interface AuditLogItem {
  id: Uuid;
  actorType: ActorType;
  actorId: Uuid | null;
  /** Admin email (admins only; kept for compatibility). Prefer `actorLabel`. */
  actorEmail?: string | null;
  /** Human label resolved server-side: admin email, user phone, advertiser email, "system" (or the raw id). */
  actorLabel: string | null;
  action: string;
  targetType: string;
  targetId: Uuid | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: IsoDateTime;
}

export interface AuditLogQuery extends PaginationQuery, DateRangeQuery {
  actorId?: Uuid;
  /**
   * Admin email, advertiser email, user phone (any Ethiopian format) or uuid, resolved server-side. When it
   * matches nobody the page is empty and `meta.actorResolved === false` (the filter is never dropped).
   */
  actor?: string;
  actorType?: ActorType;
  action?: string;
  targetType?: string;
  targetId?: Uuid;
  q?: string;
}

export interface AuditLogMeta extends PaginationMeta {
  /** Present when `actor=` was used: false means the actor could not be resolved. */
  actorResolved?: boolean;
}

/* ---------- ad reports / offers ---------- */

export interface AdminAdReportItem {
  id: Uuid;
  adId: Uuid;
  adTitle: string;
  userId: Uuid;
  reason: string;
  details: string | null;
  status: string;
  reviewedBy: Uuid | null;
  reviewedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface ReviewAdReportDto {
  /** "reviewed" keeps the ad live; "dismissed" marks the report as not actionable. */
  outcome: 'reviewed' | 'dismissed';
  note?: string;
  /** When true the ad is pulled (review_status -> rejected) with the given reason. */
  rejectAd?: boolean;
  rejectionReason?: string;
}

export interface AdminAppInstallCompletionItem {
  id: Uuid;
  offerId: Uuid;
  appName: string;
  userId: Uuid;
  userPhone: string;
  deviceFingerprint: string;
  proof: string | null;
  status: OfferCompletionStatus;
  coinReward: number;
  createdAt: IsoDateTime;
}

/** GET /admin/me � identical to the dmin object returned by POST /auth/admin/login. */
export type AdminMe = AdminProfile;
