/**
 * Local aliases over the `@rap/shared` admin types. The fields this file used to add locally
 * (`reviewNote`, `bannedTopics`, `bankCode`, `attempts`, `lastIp`, campaign detail `ads`/`analytics`) are now
 * declared upstream; the aliases are kept so feature code does not churn.
 */
import type {
  AdminAdvertiserDetail,
  AdminCampaignDetail as SharedAdminCampaignDetail,
  AdminCampaignItem,
  AdminUserDetail,
  AdminWithdrawalItem,
  AdReviewItem,
} from '@rap/shared';

export type AdReview = AdReviewItem;

export type AdminWithdrawal = AdminWithdrawalItem;

export type AdminUser = AdminUserDetail;

export type AdminCampaign = AdminCampaignItem;

export type AdminCampaignDetail = SharedAdminCampaignDetail;

export type AdminAdvertiser = AdminAdvertiserDetail;
