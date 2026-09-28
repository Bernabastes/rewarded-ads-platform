import type { WithdrawalReviewReason } from '../constants';
import type { ApprovalDecision, KycTier, PayoutMethod, WithdrawalStatus } from '../enums';
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
  /** Rolling 30-day payout total above which `phone_only` users must complete KYC (422 KYC_REQUIRED). */
  kycRequiredAboveMonthlyEtb: number;
  /** The requesting user's KYC tier. */
  kycTier: KycTier;
  /** Completed + in-flight payouts in the rolling 30-day window, in ETB. */
  monthlyPayoutTotalEtb: number;
  /** How long a destination lookup (`/withdrawals/destinations/resolve`) stays valid. */
  destinationResolveTtlMinutes: number;
  /** Destinations already used for a successful request (no lookup/OTP needed to reuse). */
  knownDestinations: PayoutDestinationItem[];
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

/** `POST /withdrawals/destinations/resolve` */
export interface ResolveDestinationDto {
  payoutMethod: PayoutMethod;
  payoutDestination: string;
  bankCode?: string;
}

export interface ResolveDestinationResponse {
  /** Account holder name from the payout partner (MOCK: deterministic fake name, `mock: true`). */
  accountName: string;
  /** E.164 phone or cleaned account number - send THIS back as `payoutDestination`. */
  normalizedDestination: string;
  payoutMethod: PayoutMethod;
  provider: string;
  mock: boolean;
  /** true when the user already paid out to this destination (no OTP re-check needed). */
  known: boolean;
  /** true when an OTP re-check (destination_change) is still required before requesting. */
  otpRequired: boolean;
  /** The lookup must be used before this time. */
  validUntil: IsoDateTime;
}

/** `POST /withdrawals/destinations/otp/verify` */
export interface VerifyDestinationOtpDto {
  code: string;
  payoutMethod: PayoutMethod;
  payoutDestination: string;
  bankCode?: string;
}

export interface PayoutDestinationItem {
  id: Uuid;
  payoutMethod: PayoutMethod;
  /** Masked (e.g. +2519****1234). */
  destination: string;
  bankCode: string | null;
  accountName: string | null;
  verifiedAt: IsoDateTime | null;
  otpVerifiedAt: IsoDateTime | null;
  lastUsedAt: IsoDateTime | null;
  useCount: number;
  /** true when lastUsedAt is set (no lookup/OTP needed). */
  known: boolean;
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
  /** Account holder name confirmed by the partner lookup at request time. */
  destinationAccountName: string | null;
  destinationVerifiedAt: IsoDateTime | null;
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
