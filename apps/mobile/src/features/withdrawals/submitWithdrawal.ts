import type { CreateWithdrawalDto, WithdrawalItem } from '@rap/shared';
import { ErrorCode } from '@rap/shared';

import { isApiError } from '@/api/errors';

export interface SubmitWithdrawalDeps {
  create(dto: CreateWithdrawalDto, idempotencyKey: string): Promise<WithdrawalItem>;
  /** Newest-first page of the user's withdrawals, used to find a request that is still being created. */
  listRecent(): Promise<WithdrawalItem[]>;
  newKey(): string;
  sleep?(ms: number): Promise<void>;
  now?(): number;
  /** Poll attempts while the original request is `inProgress` (default 6 x 1.5 s). */
  pollAttempts?: number;
  pollIntervalMs?: number;
}

export type SubmitWithdrawalResult =
  | { outcome: 'created'; item: WithdrawalItem; key: string }
  /** The first request with this key was still running; we found it in the list instead of re-posting. */
  | { outcome: 'found_in_progress'; item: WithdrawalItem; key: string };

/** A minute of slack when matching a just-created request against the list. */
const MATCH_WINDOW_MS = 10 * 60_000;

export function matchesIntent(item: WithdrawalItem, dto: CreateWithdrawalDto, intentStartedAt: number): boolean {
  if (item.amountEtb !== dto.amountEtb || item.payoutMethod !== dto.payoutMethod) return false;
  const requested = new Date(item.requestedAt).getTime();
  return Number.isFinite(requested) && requested >= intentStartedAt - MATCH_WINDOW_MS;
}

/**
 * `POST /withdrawals` with the idempotency protocol:
 *  - the same key is reused for every retry of the same intent (network errors, 5xx);
 *  - `409 IDEMPOTENCY_KEY_REUSED { inProgress: true }` → the first request is still running: poll the
 *    list until the new item appears instead of posting again;
 *  - `409 IDEMPOTENCY_KEY_REUSED { inProgress: false }` → the key was already used with a different payload
 *    (client bug or stale key): retry once with a fresh key;
 *  - every other error is rethrown untouched (4xx are not memoised server-side, so the key stays valid).
 */
export async function submitWithdrawal(
  deps: SubmitWithdrawalDeps,
  dto: CreateWithdrawalDto,
  key: string,
  intentStartedAt: number = (deps.now ?? Date.now)(),
): Promise<SubmitWithdrawalResult> {
  try {
    const item = await deps.create(dto, key);
    return { outcome: 'created', item, key };
  } catch (error) {
    if (!isApiError(error) || error.code !== ErrorCode.IDEMPOTENCY_KEY_REUSED) throw error;
    const details = error.details as { inProgress?: boolean } | undefined;
    if (details?.inProgress) {
      const found = await pollForIntent(deps, dto, intentStartedAt);
      if (found) return { outcome: 'found_in_progress', item: found, key };
      throw error;
    }
    const freshKey = deps.newKey();
    const item = await deps.create(dto, freshKey);
    return { outcome: 'created', item, key: freshKey };
  }
}

async function pollForIntent(
  deps: SubmitWithdrawalDeps,
  dto: CreateWithdrawalDto,
  intentStartedAt: number,
): Promise<WithdrawalItem | null> {
  const attempts = deps.pollAttempts ?? 6;
  const interval = deps.pollIntervalMs ?? 1500;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let i = 0; i < attempts; i++) {
    const items = await deps.listRecent().catch(() => [] as WithdrawalItem[]);
    const match = items.find((item) => matchesIntent(item, dto, intentStartedAt));
    if (match) return match;
    await sleep(interval);
  }
  return null;
}

/**
 * One idempotency key per user intent: the key is created lazily for a payload signature and kept
 * while the payload is unchanged (so a retry after a network error replays the same request);
 * changing the amount / destination or a success starts a new intent.
 */
export function createIntentKeys(newKey: () => string) {
  let current: { signature: string; key: string; startedAt: number } | null = null;
  return {
    keyFor(dto: CreateWithdrawalDto, now: number = Date.now()): { key: string; startedAt: number } {
      const signature = JSON.stringify([dto.amountEtb, dto.payoutMethod, dto.payoutDestination, dto.bankCode ?? null]);
      if (!current || current.signature !== signature) current = { signature, key: newKey(), startedAt: now };
      return { key: current.key, startedAt: current.startedAt };
    },
    /** Adopt the key the submitter ended up using (after an `inProgress: false` conflict). */
    replaceKey(key: string) {
      if (current) current = { ...current, key };
    },
    reset() {
      current = null;
    },
  };
}
