/**
 * Local widening of the `@rap/shared` admin types for fields the API returns but the
 * shared contract does not (yet) declare. Kept in one place so the gap is easy to close upstream.
 */
import type {
  AdminAdvertiserDetail,
  AdminCampaignItem,
  AdminUserDetail,
  AdminWithdrawalItem,
  AdReviewItem,
  AdSummary,
  BANNED_TOPICS,
  CampaignAnalytics,
} from '@rap/shared';

export type AdReview = AdReviewItem & {
  reviewNote?: string | null;
  bannedTopics?: typeof BANNED_TOPICS;
};

export type AdminWithdrawal = AdminWithdrawalItem & {
  bankCode?: string | null;
  attempts?: number;
};

export type AdminUser = AdminUserDetail & {
  lastIp?: string | null;
};

export type AdminCampaign = AdminCampaignItem;

export type AdminCampaignDetail = AdminCampaignItem & {
  ads: AdSummary[];
  analytics: CampaignAnalytics;
};

export type AdminAdvertiser = AdminAdvertiserDetail;
