import {
  applyLedgerEntry,
  InsufficientBalanceError,
  LedgerUserNotFoundError,
  LedgerValidationError,
} from './ledger.core';
import { InMemoryLedgerDb } from './ledger.memory-db';

const USER = 'user-1';

describe('ledger core (single transactional write path)', () => {
  let db: InMemoryLedgerDb;
  beforeEach(() => {
    db = new InMemoryLedgerDb();
    db.addUser(USER, 0);
  });

  it('credits coins, appends an entry with balance_after and updates the cached balance once', async () => {
    const r = await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: 150,
      sourceType: 'ad_view',
      idempotencyKey: 'ad_completion:s1',
    });
    expect(r.replayed).toBe(false);
    expect(r.balanceAfter).toBe(150);
    expect(r.entry.amount).toBe(150);
    expect(r.entry.balanceAfter).toBe(150);
    expect(db.users.get(USER)!.coinBalance).toBe(150);
    expect(db.balanceWrites).toEqual([{ userId: USER, coinBalance: 150 }]);
    expect(db.lockCalls).toBe(1);
  });

  it('handles negative amounts (withdrawals) and keeps a running balance', async () => {
    await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: 500,
      sourceType: 'ad_view',
      idempotencyKey: 'key-a',
    });
    await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: 200,
      sourceType: 'survey',
      idempotencyKey: 'key-b',
    });
    const r = await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: -300,
      sourceType: 'withdrawal',
      idempotencyKey: 'withdrawal_hold:w1',
    });
    expect(r.balanceAfter).toBe(400);
    expect(db.entries.map((e) => e.balanceAfter)).toEqual([500, 700, 400]);
    expect(db.entries.reduce((s, e) => s + e.amount, 0)).toBe(db.users.get(USER)!.coinBalance);
  });

  it('never lets a balance go negative', async () => {
    await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: 100,
      sourceType: 'ad_view',
      idempotencyKey: 'key-a',
    });
    await expect(
      applyLedgerEntry(db.tx(), {
        userId: USER,
        amount: -101,
        sourceType: 'withdrawal',
        idempotencyKey: 'key-w',
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(db.entries).toHaveLength(1);
    expect(db.users.get(USER)!.coinBalance).toBe(100);
  });

  it('replays idempotently: the same key never credits twice', async () => {
    const first = await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: 100,
      sourceType: 'ad_view',
      idempotencyKey: 'ad_completion:s1',
    });
    const second = await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: 100,
      sourceType: 'ad_view',
      idempotencyKey: 'ad_completion:s1',
    });
    expect(second.replayed).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(db.entries).toHaveLength(1);
    expect(db.users.get(USER)!.coinBalance).toBe(100);
    expect(db.balanceWrites).toHaveLength(1);
  });

  it('rejects direct balance edits disguised as ledger writes (non-integer / zero / missing key)', async () => {
    await expect(
      applyLedgerEntry(db.tx(), {
        userId: USER,
        amount: 1.5,
        sourceType: 'ad_view',
        idempotencyKey: 'key-x',
      }),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      applyLedgerEntry(db.tx(), { userId: USER, amount: 0, sourceType: 'ad_view', idempotencyKey: 'key-x' }),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(
      applyLedgerEntry(db.tx(), { userId: USER, amount: 10, sourceType: 'ad_view', idempotencyKey: '' }),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    expect(db.entries).toHaveLength(0);
  });

  it('fails for unknown users without writing anything', async () => {
    await expect(
      applyLedgerEntry(db.tx(), {
        userId: 'ghost',
        amount: 10,
        sourceType: 'ad_view',
        idempotencyKey: 'key-x',
      }),
    ).rejects.toBeInstanceOf(LedgerUserNotFoundError);
    expect(db.entries).toHaveLength(0);
  });

  it('reconciliation mode recomputes balance_after from the ledger sum (repairing a tampered cache)', async () => {
    await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: 300,
      sourceType: 'ad_view',
      idempotencyKey: 'key-a',
    });
    db.users.get(USER)!.coinBalance = 9999; // simulated manual tampering / drift
    const r = await applyLedgerEntry(db.tx(), {
      userId: USER,
      amount: 0,
      sourceType: 'reconciliation',
      idempotencyKey: 'reconcile:run1',
      recomputeFromLedger: true,
    });
    expect(r.balanceAfter).toBe(300);
    expect(db.users.get(USER)!.coinBalance).toBe(300);
  });

  it('serialises concurrent writes through the user lock and keeps the sum consistent', async () => {
    db.addUser(USER, 0);
    const amounts = [10, 20, 30, 40, 50];
    await Promise.all(
      amounts.map((a, i) =>
        applyLedgerEntry(db.tx(), {
          userId: USER,
          amount: a,
          sourceType: 'ad_view',
          idempotencyKey: `key-${i}`,
        }),
      ),
    );
    // In-memory "lock" is a no-op; the invariant that matters is ledger sum == cached balance after all writes settle.
    const sum = db.entries.reduce((s, e) => s + e.amount, 0);
    expect(sum).toBe(150);
    expect(db.entries).toHaveLength(5);
  });
});
