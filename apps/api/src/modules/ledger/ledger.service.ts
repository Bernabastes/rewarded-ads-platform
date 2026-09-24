import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  applyLedgerEntry,
  InsufficientBalanceError,
  LedgerUserNotFoundError,
  LedgerValidationError,
  type LedgerWriteInput,
  type LedgerWriteResult,
} from './ledger.core';

/**
 * Nest-facing wrapper around the ledger core. All coin credits/debits in the API go through `applyEntry`.
 * Pass the caller's transaction client to make the ledger write atomic with the business record
 * (ad completion, withdrawal, adjustment).
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly security: SecurityLogger,
  ) {}

  async applyEntry(input: LedgerWriteInput, tx?: Prisma.TransactionClient): Promise<LedgerWriteResult> {
    try {
      const result = tx
        ? await applyLedgerEntry(tx, input)
        : await this.prisma.$transaction((t) => applyLedgerEntry(t, input), {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          });
      if (!result.replayed) {
        this.security.info('ledger.write', {
          userId: input.userId,
          amount: input.amount,
          balanceAfter: result.balanceAfter,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          idempotencyKey: input.idempotencyKey,
          createdBy: input.createdBy ?? null,
        });
      }
      return result;
    } catch (err) {
      throw this.translate(err, input);
    }
  }

  translate(err: unknown, input: LedgerWriteInput): unknown {
    if (err instanceof InsufficientBalanceError) {
      this.security.warn('ledger.insufficient_balance', {
        userId: input.userId,
        currentBalance: err.currentBalance,
        requested: err.requested,
        sourceType: input.sourceType,
      });
      return AppException.unprocessable(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient coin balance', {
        currentBalance: err.currentBalance,
        requested: err.requested,
      });
    }
    if (err instanceof LedgerValidationError)
      return AppException.badRequest(ErrorCode.VALIDATION_ERROR, err.message);
    if (err instanceof LedgerUserNotFoundError) return AppException.notFound('User not found');
    return err;
  }

  /** Cached balance plus an integrity checksum against the ledger (cheap SUM on an indexed column). */
  async getBalance(userId: string) {
    const [user, agg] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { coinBalance: true } }),
      this.prisma.coinLedger.aggregate({ where: { userId }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    if (!user) throw AppException.notFound('User not found');
    const ledgerSum = agg._sum.amount ?? 0;
    const coinsPerEtb = this.config.platform.coinsPerEtb;
    return {
      coinBalance: user.coinBalance,
      etbEquivalent: Math.round((user.coinBalance / coinsPerEtb) * 100) / 100,
      coinsPerEtb,
      ledgerChecksum: { entries: agg._count._all, ledgerSum, consistent: ledgerSum === user.coinBalance },
      conversionNote: `${coinsPerEtb} coins = 1 ETB. Coins convert to Birr at withdrawal; the minimum withdrawal is ${this.config.platform.minWithdrawalEtb} ETB.`,
    };
  }

  async listEntries(userId: string, query: { page?: number; limit?: number }) {
    const p = pageArgs(query);
    const [rows, total] = await Promise.all([
      this.prisma.coinLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        select: {
          id: true,
          amount: true,
          balanceAfter: true,
          sourceType: true,
          sourceId: true,
          description: true,
          createdAt: true,
        },
      }),
      this.prisma.coinLedger.count({ where: { userId } }),
    ]);
    return paginated(rows, total, p);
  }
}
