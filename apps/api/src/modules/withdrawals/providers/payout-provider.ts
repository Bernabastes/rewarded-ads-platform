import type { PayoutMethod } from '@prisma/client';

export type PayoutState = 'pending' | 'processing' | 'completed' | 'failed';

export interface PayoutResult {
  /** Provider-side identifier used for status polling. */
  providerPayoutId: string;
  status: PayoutState;
  message?: string;
  raw?: unknown;
}

export interface PayoutStatus {
  status: PayoutState;
  failureReason?: string;
  raw?: unknown;
}

export interface PayoutOptions {
  /** Our withdrawal id, sent as the idempotent client reference. */
  reference: string;
  accountName?: string;
  bankCode?: string;
}

/**
 * Payout partner abstraction (spec §9). The platform never holds user funds: every withdrawal is executed by a
 * licensed partner through one of these implementations. `initiatePayout`/`checkStatus` match the spec signature;
 * the trailing `options` argument is optional metadata (bank code / account name) some partners require.
 */
export interface PayoutProvider {
  readonly name: string;
  readonly isMock: boolean;
  readonly supportedMethods: readonly PayoutMethod[];
  isAvailable(): boolean;
  initiatePayout(userId: string, amountEtb: number, destination: string, options?: PayoutOptions): Promise<PayoutResult>;
  checkStatus(payoutId: string): Promise<PayoutStatus>;
}

export const PAYOUT_PROVIDERS = Symbol('PAYOUT_PROVIDERS');

/** Shared deterministic mock behaviour: async "processing" then completed/failed by configurable failure rate. */
export function mockPayoutId(prefix: string): string {
  return `MOCK-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function mockPayoutStatus(payoutId: string, processingSeconds: number, failureRate: number, now = Date.now()): PayoutStatus {
  const parts = payoutId.split('-');
  const createdAt = Number(parts[2]);
  if (!Number.isFinite(createdAt)) return { status: 'failed', failureReason: 'Unknown mock payout id' };
  if (now - createdAt < processingSeconds * 1000) return { status: 'processing', raw: { mock: true } };
  // deterministic per id so repeated polls agree
  let hash = 0;
  for (const ch of payoutId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const failed = hash % 1000 < Math.round(failureRate * 1000);
  return failed
    ? { status: 'failed', failureReason: 'MOCK: partner rejected the transfer (simulated failure)', raw: { mock: true } }
    : { status: 'completed', raw: { mock: true, settledAt: new Date(now).toISOString() } };
}
