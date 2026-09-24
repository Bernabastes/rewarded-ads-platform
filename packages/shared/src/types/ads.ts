import type { CompletionStatus, MediaType, TargetActionType } from '../enums';
import type { ErrorCode } from '../error-codes';
import type { IsoDateTime, PaginationMeta, Uuid } from './common';

export interface AdFeedItem {
  id: Uuid;
  campaignId: Uuid;
  title: string;
  advertiserName: string;
  mediaType: MediaType;
  mediaUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  /** Coins credited on a valid completion. */
  rewardCoins: number;
  rewardEtb: number;
  /** Estimated time incl. the optional attention question, in seconds. */
  estimatedSeconds: number;
  hasAttentionCheck: boolean;
  targetActionType: TargetActionType;
}

export interface AdFeedMeta extends PaginationMeta {
  dailyLimit: number;
  dailyCompleted: number;
  dailyRemaining: number;
}

export interface AdDetail extends AdFeedItem {
  description: string | null;
  minWatchSeconds: number;
  heartbeatIntervalSeconds: number;
}

export interface StartWatchSessionDto {
  /** Stable device fingerprint hash. Required. */
  deviceFingerprint: string;
  deviceId?: string;
}

export interface AttentionQuestionPublic {
  id: Uuid;
  prompt: string;
  /** Localised prompt when available (Amharic). */
  promptAm: string | null;
  options: string[];
}

export interface WatchSessionResponse {
  sessionId: Uuid;
  adId: Uuid;
  /** Server clock at session start. */
  startedAt: IsoDateTime;
  serverTime: IsoDateTime;
  expectedDurationSeconds: number;
  /** Server will reject completion before this many seconds have elapsed (server-timed). */
  minWatchSeconds: number;
  /** Client must call the heartbeat endpoint roughly this often while playing. */
  heartbeatIntervalSeconds: number;
  /** Session is abandoned/expired if not completed before this time. */
  expiresAt: IsoDateTime;
  rewardCoins: number;
  /** Present when the campaign has attention checks enabled; the answer is required at completion. */
  attentionQuestion: AttentionQuestionPublic | null;
}

export interface HeartbeatDto {
  /** Player position in seconds (informational; the server uses its own clock). */
  positionSeconds?: number;
}

export interface HeartbeatResponse {
  ok: boolean;
  heartbeatCount: number;
  elapsedSeconds: number;
  serverTime: IsoDateTime;
}

export interface CompleteWatchSessionDto {
  /** Index of the chosen option for the attention question, when one was asked. */
  attentionAnswerIndex?: number;
}

export interface AdCompletionResult {
  completionId: Uuid | null;
  sessionId: Uuid;
  status: CompletionStatus;
  /** Coins credited (0 when flagged or rejected). */
  coinReward: number;
  watchDurationSeconds: number;
  /** Cached balance after crediting (null if not credited). */
  newBalance: number | null;
  /** Stable reason when status is rejected or flagged. */
  reasonCode: ErrorCode | null;
  /** Fraud rule ids that fired (informational for support; do not display raw to users). */
  fraudFlags: string[];
  /** True when this response is a replay of an earlier completion of the same session. */
  replayed: boolean;
}
