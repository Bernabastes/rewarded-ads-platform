import type { LedgerSourceType, Prisma } from '@prisma/client';

/**
 * THE single code path that changes a user's coin balance.
 *
 * Invariants (see ARCHITECTURE.md "Money & coin model"):
 *  1. coin_ledger is append-only (DB trigger blocks UPDATE/DELETE).
 *  2. users.coin_balance is a cache, written ONLY here, inside the same transaction as the ledger row,
 *     after taking a row lock on the user (SELECT ... FOR UPDATE) so concurrent writes serialise.
 *  3. Every business event supplies an idempotency key; replays return the existing entry and never
 *     credit twice (the unique index on idempotency_key is the last line of defence).
 *  4. A balance can never go negative.
 *
 * This is a plain function (no Nest DI) so the seed script and unit tests exercise the exact same logic
 * as LedgerService.
 */

export interface LedgerWriteInput {
  userId: string;
  /** Signed integer coins. */
  amount: number;
  sourceType: LedgerSourceType;
  sourceId?: string | null;
  /** e.g. "ad_completion:<watchSessionId>", "withdrawal_hold:<withdrawalId>" */
  idempotencyKey: string;
  description?: string | null;
  /** Admin who caused the entry (manual adjustments). */
  createdBy?: string | null;
  /** Reconciliation only: set balance_after to SUM(ledger)+amount instead of cached+amount. */
  recomputeFromLedger?: boolean;
}

export interface LedgerEntryRecord {
  id: string;
  userId: string;
  amount: number;
  balanceAfter: number;
  sourceType: LedgerSourceType;
  sourceId: string | null;
  idempotencyKey: string;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface LedgerWriteResult {
  entry: LedgerEntryRecord;
  balanceAfter: number;
  /** True when the idempotency key already existed; nothing was written. */
  replayed: boolean;
}

export class InsufficientBalanceError extends Error {
  constructor(
    readonly userId: string,
    readonly currentBalance: number,
    readonly requested: number,
  ) {
    super(`Insufficient balance: user ${userId} has ${currentBalance} coins, requested ${requested}`);
    this.name = 'InsufficientBalanceError';
  }
}

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerValidationError';
  }
}

export class LedgerUserNotFoundError extends Error {
  constructor(readonly userId: string) {
    super(`User ${userId} not found`);
    this.name = 'LedgerUserNotFoundError';
  }
}

/** Subset of the Prisma transaction client the core needs (keeps unit tests free of a database). */
export type LedgerTx = Pick<Prisma.TransactionClient, '$queryRaw' | 'coinLedger' | 'user'>;

export async function applyLedgerEntry(tx: LedgerTx, input: LedgerWriteInput): Promise<LedgerWriteResult> {
  if (!Number.isInteger(input.amount)) throw new LedgerValidationError('amount must be an integer number of coins');
  if (input.amount === 0 && !input.recomputeFromLedger) throw new LedgerValidationError('amount must be non-zero');
  if (!input.idempotencyKey || input.idempotencyKey.length < 3) {
    throw new LedgerValidationError('idempotencyKey is required');
  }

  // 1. Serialise all balance changes for this user (blocks until concurrent writers commit).
  const rows = await tx.$queryRaw<Array<{ coin_balance: number }>>`
    SELECT coin_balance FROM users WHERE id = ${input.userId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new LedgerUserNotFoundError(input.userId);
  const cachedBalance = Number(rows[0].coin_balance);

  // 2. Idempotency check AFTER the lock so a concurrent duplicate sees the committed entry.
  const existing = await tx.coinLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    return { entry: existing, balanceAfter: existing.balanceAfter, replayed: true };
  }

  // 3. Compute the new balance.
  let balanceAfter: number;
  if (input.recomputeFromLedger) {
    const agg = await tx.coinLedger.aggregate({ where: { userId: input.userId }, _sum: { amount: true } });
    balanceAfter = (agg._sum.amount ?? 0) + input.amount;
  } else {
    balanceAfter = cachedBalance + input.amount;
  }
  if (balanceAfter < 0) throw new InsufficientBalanceError(input.userId, cachedBalance, -input.amount);

  // 4. Append the immutable ledger row.
  const entry = await tx.coinLedger.create({
    data: {
      userId: input.userId,
      amount: input.amount,
      balanceAfter,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      idempotencyKey: input.idempotencyKey,
      description: input.description ?? null,
      createdBy: input.createdBy ?? null,
    },
  });

  // 5. The ONLY write of users.coin_balance in the whole codebase (enforced by ledger.guard.spec.ts).
  await tx.user.update({ where: { id: input.userId }, data: { coinBalance: balanceAfter } });

  return { entry, balanceAfter, replayed: false };
}
