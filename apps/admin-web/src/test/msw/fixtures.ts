import { BANNED_TOPICS } from '@rap/shared';
import type {
  AdminDeletionRequestItem,
  AdminKycDetail,
  AdminKycSummary,
  AdminMe,
  AdminOverview,
  AdminReferralItem,
  AdminReferralMetrics,
  AuditLogItem,
  AuthTokens,
  CoinAdjustmentItem,
  ImpersonationTokenResponse,
  Paginated,
  PlatformAlertItem,
  PlatformConfigResponse,
} from '@rap/shared';
import type { AdminWithdrawal, AdReview, AlertsMeta } from '@/lib/api/types';

export const BASE = 'http://localhost:3000/api/v1';

export const tokens = (suffix = '1'): AuthTokens => ({
  accessToken: `access-${suffix}`,
  refreshToken: `refresh-${suffix}`,
  expiresIn: 900,
  tokenType: 'Bearer',
});

export const adminSuper: AdminMe = {
  id: 'admin-super',
  email: 'super@rap.et',
  fullName: 'Selam Abraham',
  role: 'super_admin',
  active: true,
  lastLoginAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  roles: ['super_admin'],
  permissions: [
    'ads.review',
    'campaigns.moderate',
    'users.moderate',
    'advertisers.verify',
    'fraud.manage',
    'withdrawals.decide',
    'adjustments.manage',
    'revenue.view',
    'audit.view',
  ],
};

export const adminFinance: AdminMe = {
  ...adminSuper,
  id: 'admin-finance',
  email: 'finance@rap.et',
  fullName: 'Mikias Berhanu',
  role: 'finance',
  roles: ['finance'],
  permissions: ['withdrawals.decide', 'adjustments.manage', 'revenue.view', 'audit.view', 'fraud.manage'],
};

export const adminReviewer: AdminMe = {
  ...adminSuper,
  id: 'admin-reviewer',
  email: 'reviewer@rap.et',
  fullName: 'Dawit Kebede',
  role: 'ad_reviewer',
  roles: ['ad_reviewer'],
  permissions: ['ads.review', 'campaigns.moderate', 'reports.review'],
};

export const adminSupport: AdminMe = {
  ...adminSuper,
  id: 'admin-support',
  email: 'support@rap.et',
  fullName: 'Hanna Tesfaye',
  role: 'support',
  roles: ['support'],
  permissions: ['users.moderate', 'advertisers.verify', 'fraud.manage', 'audit.view'],
};

export const overview: AdminOverview = {
  pendingAdReviews: 3,
  pendingCampaignReviews: 1,
  pendingAdvertiserVerifications: 1,
  withdrawalsAwaitingReview: 3,
  withdrawalsPendingPayout: 5,
  pendingCoinAdjustments: 1,
  openFraudFlags: 15,
  openAdReports: 2,
  activeUsers: 40,
  suspendedUsers: 2,
  activeCampaigns: 4,
  todayValidCompletions: 8,
  todayFlaggedCompletions: 4,
  todayPlatformRevenueEtb: 8.5,
};

export const config: PlatformConfigResponse = {
  coinsPerEtb: 100,
  minWithdrawalEtb: 50,
  largeWithdrawalThresholdEtb: 500,
  dailyAdCompletionLimit: 15,
  platformTakeRate: 0.5,
  minWatchRatio: 0.9,
  minAge: 18,
  heartbeatIntervalSeconds: 10,
  dailyWithdrawalRequestLimit: 3,
  maxWatchAttemptsPerAdPerDay: 3,
  payoutMaxAttempts: 3,
  minCampaignBudgetEtb: 100,
  minCostPerActionEtb: 0.5,
  minTopupEtb: 100,
  kycRequiredAboveMonthlyEtb: 1000,
  defaultFrequencyCap: 1,
  advertiserImpressionCapPerUserPerDay: 3,
  referralBonusCoins: 500,
  refereeBonusCoins: 200,
  referralMaxPerReferrerPerDay: 5,
  accountDeletionGraceDays: 14,
  destinationResolveTtlMinutes: 10,
  fraud: { flagThreshold: 40, rejectThreshold: 80, minTrustScoreForFeed: 20 },
  alerts: { payoutFailureRate: 0.2, accountsPerDevicePerHour: 3, spendVelocityMultiplier: 5, otpRequestsPerIpPerHour: 20 },
  mocks: {
    sms: true,
    payouts: true,
    paymentGateway: true,
    push: true,
    idVerification: true,
    alerts: true,
    destinationLookup: true,
  },
  environment: 'test',
  version: '0.1.0',
};

export const pendingAd: AdReview = {
  id: 'ad-1',
  campaignId: 'camp-1',
  title: 'Morning Roast - vertical cut',
  description: 'Demo creative',
  mediaUrl: 'https://example.com/video.mp4',
  thumbnailUrl: null,
  mediaType: 'video',
  durationSeconds: 15,
  reviewStatus: 'pending',
  rejectionReason: null,
  reviewedAt: null,
  attentionQuestionsCount: 1,
  mediaStatus: 'ready',
  mediaProbe: null,
  durationDeclaredSeconds: 15,
  durationProbedSeconds: 15,
  mediaError: null,
  mediaProcessedAt: null,
  createdAt: '2026-09-02T14:43:53.008Z',
  campaign: {
    id: 'camp-1',
    title: 'Buna Time - Morning Roast launch',
    status: 'active',
    targetActionType: 'video_view',
    costPerActionEtb: 2,
    budgetEtb: 5000,
  },
  advertiser: { id: 'adv-1', businessName: 'Habesha Coffee Roasters PLC', verificationStatus: 'verified' },
  bannedTopicsChecklist: null,
  reviewedBy: null,
  reviewNote: null,
  openReports: 0,
  attentionQuestions: [
    { id: 'q-1', prompt: 'What was advertised?', options: ['Coffee', 'Tea', 'Juice'], correctIndex: 0 },
  ],
  bannedTopics: BANNED_TOPICS,
};

export const reviewQueue: Paginated<AdReview> = {
  data: [pendingAd, { ...pendingAd, id: 'ad-2', title: 'Eid promo - 15s' }],
  meta: { page: 1, limit: 50, total: 2 },
};

export const largeWithdrawal: AdminWithdrawal = {
  id: 'wd-650',
  userId: 'user-1',
  amountEtb: 650,
  coinAmount: 65000,
  payoutMethod: 'telebirr',
  payoutDestination: '+2519****1233',
  destinationName: null,
  destinationAccountName: 'Rahel Girma',
  destinationVerifiedAt: '2026-09-23T08:43:20.542Z',
  status: 'flagged_for_review',
  reviewReasons: ['large_amount'],
  requiresDualApproval: true,
  approvalsCount: 1,
  failureReason: null,
  providerName: null,
  providerPayoutId: null,
  requestedAt: '2026-09-23T08:45:20.542Z',
  processedAt: null,
  updatedAt: '2026-09-24T07:53:46.027Z',
  user: {
    id: 'user-1',
    phoneNumber: '+251911001233',
    fullName: 'Rahel Girma',
    trustScore: 77,
    status: 'active',
  },
  isFirstWithdrawal: false,
  approvals: [
    {
      id: 'appr-1',
      adminId: 'admin-finance',
      adminEmail: 'finance@rap.et',
      decision: 'approved',
      note: 'Identity verified',
      createdAt: '2026-09-23T09:15:20.542Z',
    },
  ],
  payoutDestinationFull: '+251911001233',
  bankCode: null,
  reviewNote: null,
  processedBy: 'admin-finance',
  attempts: 0,
};

export const pendingAdjustment: CoinAdjustmentItem = {
  id: 'adj-1',
  userId: 'user-2',
  userPhone: '+251911000274',
  amount: 500,
  reason: 'Goodwill credit for video playback failure (ticket #452)',
  reference: 'TICKET-452',
  status: 'pending_approval',
  requestedBy: 'admin-finance',
  requestedByEmail: 'finance@rap.et',
  approvedBy: null,
  approvedByEmail: null,
  rejectedBy: null,
  decisionNote: null,
  ledgerEntryId: null,
  executedAt: null,
  createdAt: '2026-09-24T10:49:57.001Z',
  updatedAt: '2026-09-24T10:49:57.001Z',
};

/* ------------------------------- Phase 4A ------------------------------- */

export const processingAd: AdReview = {
  ...pendingAd,
  id: 'ad-processing',
  title: 'Addis Pay - launch teaser',
  mediaStatus: 'processing',
  mediaProbe: null,
  durationDeclaredSeconds: 20,
  durationProbedSeconds: null,
  thumbnailUrl: null,
};

export const failedMediaAd: AdReview = {
  ...pendingAd,
  id: 'ad-failed',
  title: 'Broken upload',
  mediaStatus: 'failed',
  mediaError: 'ffprobe: moov atom not found',
  mediaProbe: null,
  durationProbedSeconds: null,
};

export const correctedAd: AdReview = {
  ...pendingAd,
  id: 'ad-corrected',
  title: 'Eid promo - 15s (actually 18s)',
  mediaStatus: 'duration_corrected',
  durationSeconds: 18,
  durationDeclaredSeconds: 15,
  durationProbedSeconds: 18,
  mediaProbe: { durationSeconds: 18.2, codec: 'h264', width: 1280, height: 720, bitrate: 1_850_000, container: 'mov,mp4,m4a,3gp,3g2,mj2' },
  mediaProcessedAt: '2026-09-02T14:45:00.000Z',
};

export const kycPending: AdminKycSummary = {
  id: 'kyc-1',
  userId: 'user-kyc-1',
  idType: 'fayda',
  idNumberLast4: '4471',
  fullName: 'Rahel Girma',
  dateOfBirth: '1994-03-12',
  status: 'pending',
  providerName: 'fayda',
  providerResult: { provider: 'fayda', mock: true, found: true, score: 0.97, match: { fullName: true, dateOfBirth: true } },
  reviewedAt: null,
  reason: null,
  createdAt: '2026-09-27T09:12:00.000Z',
  updatedAt: '2026-09-27T09:12:00.000Z',
  user: { id: 'user-kyc-1', phoneNumber: '+251911001233', fullName: 'Rahel Girma', kycTier: 'phone_only', trustScore: 77 },
  reviewedBy: null,
};

export const kycMismatch: AdminKycSummary = {
  ...kycPending,
  id: 'kyc-2',
  userId: 'user-kyc-2',
  idType: 'fayda',
  idNumberLast4: '0099',
  fullName: 'Yonas T.',
  dateOfBirth: '1990-01-01',
  providerResult: { provider: 'fayda', mock: true, found: true, score: 0.4, match: { fullName: false, dateOfBirth: true } },
  createdAt: '2026-09-27T10:00:00.000Z',
  user: { id: 'user-kyc-2', phoneNumber: '+251911001918', fullName: 'Yonas Tadesse', kycTier: 'phone_only', trustScore: 61 },
};

export const kycDetail: AdminKycDetail = {
  ...kycPending,
  documents: {
    front: { url: 'https://storage.example/kyc/front.png?sig=1', expiresInSeconds: 300 },
    back: { url: 'https://storage.example/kyc/back.png?sig=1', expiresInSeconds: 300 },
    selfie: { url: 'https://storage.example/kyc/selfie.png?sig=1', expiresInSeconds: 300 },
  },
  profileMatch: { fullName: true, dateOfBirth: true },
  duplicateIdentityUsers: 0,
};

export const kycMismatchDetail: AdminKycDetail = {
  ...kycMismatch,
  documents: {
    front: { url: 'https://storage.example/kyc/front2.png?sig=1', expiresInSeconds: 300 },
    back: null,
    selfie: { url: 'https://storage.example/kyc/selfie2.png?sig=1', expiresInSeconds: 300 },
  },
  profileMatch: { fullName: false, dateOfBirth: true },
  duplicateIdentityUsers: 1,
};

export const kycQueue: Paginated<AdminKycSummary> = { data: [kycPending, kycMismatch], meta: { page: 1, limit: 50, total: 2 } };

export const alertCritical: PlatformAlertItem = {
  id: 'alert-1',
  type: 'ACCOUNT_MINTING',
  severity: 'critical',
  title: '4 accounts created from one device in the last hour',
  payload: { deviceFingerprint: 'fp-shared-1', accounts: 4, threshold: 3 },
  dedupeKey: 'ACCOUNT_MINTING:fp-shared-1',
  deliveries: [{ notifier: 'log', ok: true }],
  acknowledgedBy: null,
  acknowledgedAt: null,
  createdAt: '2026-09-28T06:00:00.000Z',
};

export const alertWarning: PlatformAlertItem = {
  ...alertCritical,
  id: 'alert-2',
  type: 'OTP_SPIKE',
  severity: 'warning',
  title: '25 OTP requests from 10.0.0.9 in the last hour',
  payload: { ip: '10.0.0.9', requests: 25, threshold: 20 },
  dedupeKey: 'OTP_SPIKE:10.0.0.9',
};

export const alertAcked: PlatformAlertItem = {
  ...alertCritical,
  id: 'alert-3',
  type: 'PAYOUT_FAILURE_RATE',
  severity: 'warning',
  title: 'Payout failure rate 40% in the last hour',
  payload: { completed: 3, failed: 2, rate: 0.4 },
  acknowledgedBy: 'admin-super',
  acknowledgedAt: '2026-09-28T07:00:00.000Z',
};

export const alertsMeta: AlertsMeta = { page: 1, limit: 50, total: 2, openCount: 2, notifiers: [{ name: 'log', mock: true }] };
export const alertsOpen: Paginated<PlatformAlertItem, AlertsMeta> = { data: [alertCritical, alertWarning], meta: alertsMeta };

export const referralMetrics: AdminReferralMetrics = {
  total: 7,
  byStatus: { pending: 2, qualified: 1, paid: 3, rejected: 1 },
  bonusCoinsPaid: 2100,
  bonusEtbPaid: 21,
  last7Days: { invited: 4, paid: 2, rejected: 1 },
  topReferrers: [{ userId: 'user-1', phoneNumber: '+251911000137', fullName: 'Abebe Bikila', paid: 2 }],
};

export const referralRejected: AdminReferralItem = {
  id: 'ref-1',
  status: 'rejected',
  referee: { id: 'user-2740', displayName: 'Mesfin K.', joinedAt: '2026-09-25T10:00:00.000Z' },
  referrerBonusCoins: 500,
  refereeBonusCoins: 200,
  qualifiedAt: null,
  paidAt: null,
  rejectionReason: 'self_referral_device',
  createdAt: '2026-09-25T10:00:00.000Z',
  referrer: { id: 'user-2466', phoneNumber: '+251911002466', fullName: 'Kebede A.' },
  refereePhone: '+251911002740',
  signupIp: '10.0.0.4',
  signupDeviceFingerprint: 'fp-shared-1',
};

export const deletionPending: AdminDeletionRequestItem = {
  id: 'del-1',
  userId: 'user-2192',
  status: 'pending',
  reason: 'Leaving the platform',
  requestedAt: '2026-09-27T12:00:00.000Z',
  scheduledFor: '2026-10-11T12:00:00.000Z',
  executedAt: null,
  cancelledAt: null,
  graceDays: 14,
  user: { id: 'user-2192', phoneNumber: '+251911002192', fullName: 'Selam D.', status: 'active', coinBalance: 1200 },
  pendingWithdrawals: 0,
  executedBy: null,
  cancelledBy: null,
  note: null,
};

export const deletionBlocked: AdminDeletionRequestItem = {
  ...deletionPending,
  id: 'del-2',
  userId: 'user-3000',
  user: { id: 'user-3000', phoneNumber: '+251911003000', fullName: 'Blocked B.', status: 'active', coinBalance: 300 },
  pendingWithdrawals: 2,
};

export const impersonationToken: ImpersonationTokenResponse = {
  accessToken: 'impersonation-token-1',
  tokenType: 'Bearer',
  expiresIn: 600,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  user: { id: 'user-1', phoneNumber: '+251911000137', fullName: 'Abebe Bikila' },
  actorAdminId: 'admin-support',
  readOnly: true,
};

export const auditAdminRow: AuditLogItem = {
  id: 'audit-1',
  actorType: 'admin',
  actorId: 'admin-finance',
  actorEmail: 'finance@rap.et',
  action: 'withdrawal.approved',
  targetType: 'withdrawal',
  targetId: 'wd-650',
  beforeState: { status: 'flagged_for_review' },
  afterState: { status: 'pending' },
  metadata: null,
  ipAddress: '127.0.0.1',
  createdAt: '2026-09-28T08:00:00.000Z',
};

export const auditUserRow: AuditLogItem = {
  id: 'audit-2',
  actorType: 'user',
  actorId: 'user-2192',
  actorEmail: null,
  action: 'deletion_request.created',
  targetType: 'deletion_request',
  targetId: 'del-1',
  beforeState: null,
  afterState: { status: 'pending' },
  metadata: { reason: 'Leaving the platform' },
  ipAddress: '10.0.0.7',
  createdAt: '2026-09-27T12:00:00.000Z',
};