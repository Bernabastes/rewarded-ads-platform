/**
 * In-memory implementation of the slice of the Prisma transaction client used by the ledger core, so the exact
 * production code path (row lock -> idempotency check -> balance math -> append -> cache update) runs without Postgres.
 */
import { randomUUID } from 'node:crypto';
import type { LedgerEntryRecord, LedgerTx } from './ledger.core';

export class InMemoryLedgerDb {
  users = new Map<string, { coinBalance: number }>();
  entries: LedgerEntryRecord[] = [];
  balanceWrites: Array<{ userId: string; coinBalance: number }> = [];
  lockCalls = 0;

  addUser(id: string, coinBalance = 0) {
    this.users.set(id, { coinBalance });
  }

  tx(): LedgerTx {
    return {
      $queryRaw: (async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        this.lockCalls++;
        const userId = String(values[0]);
        const user = this.users.get(userId);
        return user ? [{ coin_balance: user.coinBalance }] : [];
      }) as unknown as LedgerTx['$queryRaw'],
      coinLedger: {
        findUnique: async ({ where }: { where: { idempotencyKey: string } }) =>
          this.entries.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null,
        create: async ({ data }: { data: Omit<LedgerEntryRecord, 'id' | 'createdAt'> }) => {
          if (this.entries.some((e) => e.idempotencyKey === data.idempotencyKey)) {
            const err = new Error('Unique constraint failed on idempotency_key') as Error & { code: string };
            err.code = 'P2002';
            throw err;
          }
          const entry: LedgerEntryRecord = {
            id: randomUUID(),
            createdAt: new Date(),
            ...data,
          } as LedgerEntryRecord;
          this.entries.push(entry);
          return entry;
        },
        aggregate: async ({ where }: { where: { userId: string } }) => ({
          _sum: {
            amount: this.entries.filter((e) => e.userId === where.userId).reduce((s, e) => s + e.amount, 0),
          },
        }),
      } as unknown as LedgerTx['coinLedger'],
      user: {
        update: async ({ where, data }: { where: { id: string }; data: { coinBalance: number } }) => {
          const user = this.users.get(where.id);
          if (!user) throw new Error('user not found');
          user.coinBalance = data.coinBalance;
          this.balanceWrites.push({ userId: where.id, coinBalance: data.coinBalance });
          return { id: where.id, coinBalance: data.coinBalance };
        },
      } as unknown as LedgerTx['user'],
    };
  }
}
