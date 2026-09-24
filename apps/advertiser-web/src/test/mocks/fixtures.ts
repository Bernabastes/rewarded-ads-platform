import type {
  AdvertiserOverview,
  AdvertiserProfile,
  AuthTokens,
  CampaignAnalytics,
  CampaignDetail,
  CampaignSummary,
  InvoiceItem,
  PaymentItem,
  WalletBalanceResponse,
} from '@rap/shared';

export const tokensFixture: AuthTokens = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  expiresIn: 900,
  tokenType: 'Bearer',
};

export const profileFixture: AdvertiserProfile = {
  id: 'adv-1',
  businessName: 'Habesha Coffee Roasters PLC',
  businessRegistrationNumber: 'MT/AA/2/0012345/2015',
  contactEmail: 'ads@habesha-coffee.et',
  contactPhone: '+251911000001',
  verificationStatus: 'verified',
  verificationNote: null,
  walletBalanceEtb: 12000,
  createdAt: '2026-08-01T10:00:00.000Z',
};

export const pendingProfileFixture: AdvertiserProfile = {
  ...profileFixture,
  id: 'adv-2',
  businessName: 'Sheger Fashion',
  contactEmail: 'hello@shegerfashion.et',
  verificationStatus: 'pending',
  walletBalanceEtb: 0,
};

export const campaignFixture: CampaignSummary = {
  id: 'camp-1',
  advertiserId: 'adv-1',
  title: 'ቡና ታይም — Morning Roast launch',
  description: 'Launch of the new morning roast.',
  status: 'active',
  targetActionType: 'video_view',
  budgetEtb: 5000,
  spentEtb: 1250,
  remainingEtb: 3750,
  costPerActionEtb: 2,
  rewardPerActionEtb: 1,
  rewardCoins: 100,
  attentionCheckEnabled: true,
  startDate: '2026-09-01',
  endDate: null,
  pausedReason: null,
  rejectionReason: null,
  adsCount: 2,
  approvedAdsCount: 1,
  rawCompletions: 700,
  validCompletions: 625,
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
};

export const draftCampaignFixture: CampaignSummary = {
  ...campaignFixture,
  id: 'camp-2',
  title: 'Holiday draft',
  status: 'draft',
  spentEtb: 0,
  remainingEtb: 2000,
  budgetEtb: 2000,
  adsCount: 0,
  approvedAdsCount: 0,
  rawCompletions: 0,
  validCompletions: 0,
};

export const campaignDetailFixture: CampaignDetail = {
  ...campaignFixture,
  ads: [
    {
      id: 'ad-1',
      campaignId: 'camp-1',
      title: 'Morning Roast — 30s spot',
      description: null,
      mediaUrl: 'http://localhost:9000/rap-media/creatives/ad-1.mp4',
      thumbnailUrl: null,
      mediaType: 'video',
      durationSeconds: 30,
      reviewStatus: 'approved',
      rejectionReason: null,
      reviewedAt: '2026-09-01T10:00:00.000Z',
      attentionQuestionsCount: 1,
      createdAt: '2026-08-30T10:00:00.000Z',
    },
    {
      id: 'ad-2',
      campaignId: 'camp-1',
      title: 'Old cut',
      description: null,
      mediaUrl: 'http://localhost:9000/rap-media/creatives/ad-2.mp4',
      thumbnailUrl: null,
      mediaType: 'video',
      durationSeconds: 15,
      reviewStatus: 'rejected',
      rejectionReason: 'Text unreadable on small screens.',
      reviewedAt: '2026-09-02T10:00:00.000Z',
      attentionQuestionsCount: 0,
      createdAt: '2026-08-30T10:00:00.000Z',
    },
  ],
};

function daily(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    return { date, spendEtb: 40 + i * 3, validCompletions: 20 + i, rawViews: 30 + i * 2 };
  });
}

export const overviewFixture: AdvertiserOverview = {
  activeCampaigns: 2,
  totalCampaigns: 4,
  totalSpendEtb: 3105,
  walletBalanceEtb: 12000,
  totalRawViews: 1590,
  totalValidCompletions: 1248,
  totalFlaggedCompletions: 122,
  estimatedReach: 830,
  daily: daily(14),
};

export const emptyOverviewFixture: AdvertiserOverview = {
  activeCampaigns: 0,
  totalCampaigns: 0,
  totalSpendEtb: 0,
  walletBalanceEtb: 0,
  totalRawViews: 0,
  totalValidCompletions: 0,
  totalFlaggedCompletions: 0,
  estimatedReach: 0,
  daily: [],
};

export const analyticsFixture: CampaignAnalytics = {
  campaignId: 'camp-1',
  from: '2026-08-25T00:00:00.000Z',
  to: '2026-09-24T00:00:00.000Z',
  totals: {
    rawViews: 800,
    rawCompletions: 700,
    validCompletions: 625,
    flaggedCompletions: 50,
    rejectedCompletions: 25,
    fraudFilteredRate: 75 / 700,
    spendEtb: 1250,
    budgetEtb: 5000,
    remainingEtb: 3750,
    uniqueUsers: 410,
  },
  daily: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
    rawViews: 50 + i,
    rawCompletions: 45 + i,
    validCompletions: 40 + i,
    flaggedCompletions: 3,
    rejectedCompletions: 2,
    spendEtb: 80 + i * 2,
  })),
};

export const walletFixture: WalletBalanceResponse = {
  balanceEtb: 12000,
  currency: 'ETB',
  reservedEtb: 5000,
  lifetimeTopupsEtb: 20000,
  lifetimeSpendEtb: 3000,
};

export const paymentFixture: PaymentItem = {
  id: 'pay-1',
  txRef: 'RAP-TEST-1',
  gateway: 'chapa',
  amountEtb: 1000,
  currency: 'ETB',
  status: 'pending',
  checkoutUrl: 'http://localhost:3000/api/v1/billing/mock-checkout/RAP-TEST-1',
  gatewayReference: null,
  paidAt: null,
  createdAt: '2026-09-24T09:00:00.000Z',
};

export const invoiceFixture: InvoiceItem = {
  id: 'inv-1',
  invoiceNumber: 'INV-2026-0001',
  status: 'paid',
  subtotalEtb: 1000,
  vatEtb: 0,
  totalEtb: 1000,
  currency: 'ETB',
  lineItems: [
    {
      description: 'Advertising wallet top-up (RAP-TEST-1)',
      quantity: 1,
      unitPriceEtb: 1000,
      totalEtb: 1000,
    },
  ],
  paymentId: 'pay-1',
  issuedAt: '2026-09-24T09:05:00.000Z',
  paidAt: '2026-09-24T09:05:00.000Z',
};
