import type { WithdrawalReviewReason } from '../constants';
import type { ApprovalDecision, PayoutMethod, WithdrawalStatus } from '../enums';
import type { IsoDateTime, Uuid } from './common';

export interface WithdrawalMethodInfo {
  method: PayoutMethod;
  label: string;
  destinationHint: string;
  destinationKind: 'phone' | 'bank_account';
  /** false when no payout provider is currently configured for this method. */
  available: boolean;
}

export interface WithdrawalConfig {
  minWithdrawalEtb: number;
  coinsPerEtb: number;
  /** Requests at/above this are held for dual admin approval. */
  largeWithdrawalThresholdEtb: number;
  dailyRequestLimit: number;
  methods: WithdrawalMethodInfo[];
  /** English explanation for the wallet screen; localise client-side. */
  conversionNote: string;
}

export interface CreateWithdrawalDto {
  /** ETB with up to 2 decimals, >= minWithdrawalEtb. Converted to coins at coinsPerEtb. */
  amountEtb: number;
  payoutMethod: PayoutMethod;
  /** Phone number (telebirr / CBE Birr) or bank account number. */
  payoutDestination: string;
  /** Account holder name (required for bank). */
  destinationName?: string;
  /** Bank code when payoutMethod is "bank" (Chapa bank id). */
  bankCode?: string;
}

export interface WithdrawalApprovalItem {
  id: Uuid;
  adminId: Uuid;
  adminEmail?: string;
  decision: ApprovalDecision;
  note: string | null;
  createdAt: IsoDateTime;
}

export interface WithdrawalItem {
  id: Uuid;
  userId: Uuid;
  amountEtb: number;
  coinAmount: number;
  payoutMethod: PayoutMethod;
  /** Masked for users (e.g. +2519****1234). */
  payoutDestination: string;
  destinationName: string | null;
  status: WithdrawalStatus;
  /** Why the request is held for review, when status is flagged_for_review. Known values plus a string fallback. */
  reviewReasons: Array<WithdrawalReviewReason | (string & {})>;
  requiresDualApproval: boolean;
  approvalsCount: number;
  failureReason: string | null;
  providerName: string | null;
  providerPayoutId: string | null;
  /** Chapa bank code for bank transfers (null for mobile wallets). */
  bankCode?: string | null;
  /** Payout attempts so far (incremented when the worker starts processing). */
  attempts?: number;
  requestedAt: IsoDateTime;
  processedAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
}
