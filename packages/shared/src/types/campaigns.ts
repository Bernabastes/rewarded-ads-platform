import type { CampaignStatus, MediaStatus, MediaType, ReviewStatus, TargetActionType } from '../enums';
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
  /** Max rewarded completions of this campaign per user per UTC day (1-5; default DEFAULT_FREQUENCY_CAP). */
  frequencyCapPerUserPerDay?: number;
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
  frequencyCapPerUserPerDay: number;
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

/** ffprobe result stored on the ad once the media.process job has run. */
export interface MediaProbe {
  durationSeconds: number;
  codec: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  container: string | null;
}

export interface AdSummary {
  id: Uuid;
  campaignId: Uuid;
  title: string;
  description: string | null;
  /** Playable URL: the 720p H.264 transcode once `mediaStatus` is ready/duration_corrected, else the upload. */
  mediaUrl: string;
  thumbnailUrl: string | null;
  mediaType: MediaType;
  /** Effective duration (probed when the pipeline corrected the declared value). */
  durationSeconds: number;
  reviewStatus: ReviewStatus;
  rejectionReason: string | null;
  reviewedAt: IsoDateTime | null;
  attentionQuestionsCount: number;
  /** processing -> ready | duration_corrected | failed. Approval is refused while processing/failed. */
  mediaStatus: MediaStatus;
  mediaProbe: MediaProbe | null;
  durationDeclaredSeconds: number | null;
  durationProbedSeconds: number | null;
  mediaError: string | null;
  mediaProcessedAt: IsoDateTime | null;
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
