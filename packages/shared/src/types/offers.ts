import type { OfferCompletionStatus, OfferType } from '../enums';
import type { IsoDateTime, Uuid } from './common';

export interface OfferListItem {
  id: Uuid;
  type: OfferType;
  campaignId: Uuid;
  title: string;
  description: string | null;
  advertiserName: string;
  rewardCoins: number;
  rewardEtb: number;
  estimatedMinutes: number;
  iconUrl: string | null;
  /** Whether the current user already has a completion for this offer. */
  completionStatus: OfferCompletionStatus | null;
}

export type SurveyQuestionType = 'single_choice' | 'multi_choice' | 'rating' | 'text';

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  prompt: string;
  promptAm?: string;
  options?: string[];
  required: boolean;
  /** For rating questions. */
  min?: number;
  max?: number;
}

export interface SurveyDetail extends OfferListItem {
  type: 'survey';
  questions: SurveyQuestion[];
}

export interface SurveyAnswer {
  questionId: string;
  /** string for text/single_choice (option index as string or text), string[] for multi_choice, number for rating. */
  value: string | string[] | number;
}

export interface CompleteSurveyDto {
  answers: SurveyAnswer[];
}

export interface AppInstallOfferDetail extends OfferListItem {
  type: 'app_install';
  appName: string;
  packageName: string | null;
  storeUrl: string;
  /** Instructions shown to the user (e.g. "install and open the app once"). */
  instructions: string | null;
}

export interface CompleteAppInstallDto {
  deviceFingerprint: string;
  /** Optional client-side proof (e.g. attribution token); stored for manual verification. */
  proof?: string;
}

export interface OfferCompletionResult {
  completionId: Uuid;
  offerId: Uuid;
  type: OfferType;
  status: OfferCompletionStatus;
  coinReward: number;
  newBalance: number | null;
  message: string;
}

export interface OfferCompletionHistoryItem {
  id: Uuid;
  offerId: Uuid;
  type: OfferType;
  title: string;
  status: OfferCompletionStatus;
  coinReward: number;
  createdAt: IsoDateTime;
}
