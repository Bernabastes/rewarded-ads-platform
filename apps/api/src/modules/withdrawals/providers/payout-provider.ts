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

/** Result of a partner account-name lookup (destination verification before a withdrawal). */
export interface ResolvedAccount {
  accountName: string;
  normalizedDestination: string;
  raw?: unknown;
}

export class DestinationNotFoundError extends Error {
  constructor(message = 'No account found for this destination') {
    super(message);
    this.name = 'DestinationNotFoundError';
  }
}

/**
 * Payout partner abstraction (spec §9). The platform never holds user funds: every withdrawal is executed by a
 * licensed partner through one of these implementations. `initiatePayout`/`checkStatus` match the spec signature;
 * the trailing `options` argument is optional metadata (bank code / account name) some partners require.
 * `resolveAccount` performs the partner's account-name enquiry used for destination verification.
 */
export interface PayoutProvider {
  readonly name: string;
  readonly isMock: boolean;
  readonly supportedMethods: readonly PayoutMethod[];
  isAvailable(): boolean;
  initiatePayout(
    userId: string,
    amountEtb: number,
    destination: string,
    options?: PayoutOptions,
  ): Promise<PayoutResult>;
  checkStatus(payoutId: string): Promise<PayoutStatus>;
  resolveAccount(method: PayoutMethod, destination: string, bankCode?: string): Promise<ResolvedAccount>;
}

export const PAYOUT_PROVIDERS = Symbol('PAYOUT_PROVIDERS');

/** Ethiopian names used by the MOCK account lookup so demo flows show a realistic, deterministic holder name. */
const MOCK_FIRST_NAMES = [
  'Abebe', 'Almaz', 'Bekele', 'Chaltu', 'Dawit', 'Eyerusalem', 'Fikru', 'Genet', 'Hanna', 'Kebede',
  'Lidya', 'Mekdes', 'Nardos', 'Robel', 'Selam', 'Tigist', 'Yohannes', 'Zewditu', 'Meron', 'Samuel',
];
const MOCK_LAST_NAMES = [
  'Tesfaye', 'Bekele', 'Girma', 'Alemu', 'Haile', 'Kassa', 'Mulugeta', 'Tadesse', 'Worku', 'Yimer',
  'Desta', 'Getachew', 'Assefa', 'Negash', 'Mengistu', 'Abera',
];

/** Deterministic fake account holder name for a destination (same input => same name across calls/providers). */
export function mockAccountName(destination: string): string {
  let hash = 0;
  for (const ch of destination) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  const first = MOCK_FIRST_NAMES[hash % MOCK_FIRST_NAMES.length];
  const last = MOCK_LAST_NAMES[Math.floor(hash / MOCK_FIRST_NAMES.length) % MOCK_LAST_NAMES.length];
  return `${first} ${last}`;
}

/** Destinations ending in 0000 are treated as unknown accounts in MOCK mode so the failure path can be demoed. */
export function mockDestinationExists(destination: string): boolean {
  return !destination.endsWith('0000');
}

/** Shared deterministic mock behaviour: async "processing" then completed/failed by configurable failure rate. */
export function mockPayoutId(prefix: string): string {
  return `MOCK-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function mockPayoutStatus(
  payoutId: string,
  processingSeconds: number,
  failureRate: number,
  now = Date.now(),
): PayoutStatus {
  const parts = payoutId.split('-');
  const createdAt = Number(parts[2]);
  if (!Number.isFinite(createdAt)) return { status: 'failed', failureReason: 'Unknown mock payout id' };
  if (now - createdAt < processingSeconds * 1000) return { status: 'processing', raw: { mock: true } };
  // deterministic per id so repeated polls agree
  let hash = 0;
  for (const ch of payoutId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const failed = hash % 1000 < Math.round(failureRate * 1000);
  return failed
    ? {
        status: 'failed',
        failureReason: 'MOCK: partner rejected the transfer (simulated failure)',
        raw: { mock: true },
      }
    : { status: 'completed', raw: { mock: true, settledAt: new Date(now).toISOString() } };
}
