import { BANNED_TOPICS } from '@rap/shared';
import type {
  AdminMe,
  AdminOverview,
  AuthTokens,
  CoinAdjustmentItem,
  Paginated,
  PlatformConfigResponse,
} from '@rap/shared';
import type { AdminWithdrawal, AdReview } from '@/lib/api/types';

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
  fraud: { flagThreshold: 40, rejectThreshold: 80, minTrustScoreForFeed: 20 },
  mocks: { sms: true, payouts: true, paymentGateway: true, push: true },
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
