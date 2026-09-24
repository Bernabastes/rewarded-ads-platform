import type { CampaignStatus, MediaType, ReviewStatus, TargetActionType } from '../enums';
import type { BannedTopicKey } from '../constants';
import type { DailyPoint, IsoDate, IsoDateTime, Uuid } from './common';

export interface CreateCampaignDto {
  title: string;
  description?: string;
  /** Total budget in ETB (>= 100). Reserved from the wallet when the campaign is submitted. */
  budgetEtb: number;
  /** What the advertiser pays per valid action (>= 0.5 ETB). User reward = cost * (1 - take rate). */
  costPerActionEtb: number;
  targetActionType: TargetActionType;
  startDate?: IsoDate;
  endDate?: IsoDate;
  /** Ask a one-question attention check after each ad (default true). */
  attentionCheckEnabled?: boolean;
}

export type UpdateCampaignDto = Partial<CreateCampaignDto>;

export interface CampaignSummary {
  id: Uuid;
  advertiserId: Uuid;
  title: string;
  description: string | null;
  status: CampaignStatus;
  targetActionType: TargetActionType;
  budgetEtb: number;
  spentEtb: number;
  remainingEtb: number;
  costPerActionEtb: number;
  rewardPerActionEtb: number;
  rewardCoins: number;
  attentionCheckEnabled: boolean;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  pausedReason: string | null;
  rejectionReason: string | null;
  adsCount: number;
  approvedAdsCount: number;
  rawCompletions: number;
  validCompletions: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface BannedTopicsChecklist {
  /** key -> true means "checked: the ad does NOT contain this topic". */
  checks: Record<BannedTopicKey, boolean>;
  notes?: string;
}

export interface AttentionQuestionInput {
  prompt: string;
  promptAm?: string;
  /** 2..4 options. */
  options: string[];
  correctIndex: number;
}

export interface CreateAdDto {
  title: string;
  description?: string;
  /** Storage key returned by the presign endpoint, OR a publicly reachable URL (mediaUrl). */
  storageKey?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  mediaType: MediaType;
  /** 5..120 seconds. Images are treated as a fixed-duration view. */
  durationSeconds: number;
  attentionQuestions?: AttentionQuestionInput[];
}

export interface AdSummary {
  id: Uuid;
  campaignId: Uuid;
  title: string;
  description: string | null;
  mediaUrl: string;
  thumbnailUrl: string | null;
  mediaType: MediaType;
  durationSeconds: number;
  reviewStatus: ReviewStatus;
  rejectionReason: string | null;
  reviewedAt: IsoDateTime | null;
  attentionQuestionsCount: number;
  createdAt: IsoDateTime;
}

export interface CampaignDetail extends CampaignSummary {
  ads: AdSummary[];
}

export interface PresignUploadDto {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface PresignUploadResponse {
  method: 'PUT';
  uploadUrl: string;
  headers: Record<string, string>;
  storageKey: string;
  /** URL the media will be served from after upload. */
  publicUrl: string;
  expiresInSeconds: number;
}

export interface CampaignAnalyticsTotals {
  /** All watch sessions started. */
  rawViews: number;
  /** All completion attempts (valid + flagged + rejected). */
  rawCompletions: number;
  validCompletions: number;
  flaggedCompletions: number;
  rejectedCompletions: number;
  /** flagged+rejected / rawCompletions, 0..1 */
  fraudFilteredRate: number;
  spendEtb: number;
  budgetEtb: number;
  remainingEtb: number;
  uniqueUsers: number;
}

export interface CampaignAnalyticsDailyPoint extends DailyPoint {
  rawViews: number;
  rawCompletions: number;
  validCompletions: number;
  flaggedCompletions: number;
  rejectedCompletions: number;
  spendEtb: number;
}

export interface CampaignAnalytics {
  campaignId: Uuid;
  from: IsoDateTime;
  to: IsoDateTime;
  totals: CampaignAnalyticsTotals;
  daily: CampaignAnalyticsDailyPoint[];
}

export interface AdvertiserOverview {
  activeCampaigns: number;
  totalCampaigns: number;
  totalSpendEtb: number;
  walletBalanceEtb: number;
  totalRawViews: number;
  totalValidCompletions: number;
  totalFlaggedCompletions: number;
  /** Distinct users reached by valid completions. */
  estimatedReach: number;
  daily: Array<DailyPoint & { spendEtb: number; validCompletions: number; rawViews: number }>;
}
