import { Global, Injectable, Module } from '@nestjs/common';
import { type AdvertiserLedgerEntryType, Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface WalletWriteInput {
  advertiserId: string;
  /** Signed ETB amount (2 decimals). */
  amountEtb: Prisma.Decimal | number | string;
  entryType: AdvertiserLedgerEntryType;
  referenceType?: string;
  referenceId?: string | null;
  idempotencyKey: string;
  description?: string;
}

/**
 * Advertiser prepaid wallet. Same discipline as the coin ledger: append-only rows, cached balance written
 * only here inside a row-locked transaction, idempotency keys, never negative.
 * (Advertiser balances are a normal B2B receivable/prepayment — distinct from never holding USER funds.)
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async applyEntry(input: WalletWriteInput, tx?: Prisma.TransactionClient) {
    const run = async (t: Prisma.TransactionClient) => {
      const amount = new Prisma.Decimal(input.amountEtb).toDecimalPlaces(2);
      if (amount.isZero())
        throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Wallet amount must be non-zero');

      const rows = await t.$queryRaw<Array<{ wallet_balance_etb: Prisma.Decimal }>>`
        SELECT wallet_balance_etb FROM advertisers WHERE id = ${input.advertiserId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw AppException.notFound('Advertiser not found');

      const existing = await t.advertiserWalletLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { entry: existing, balanceAfterEtb: existing.balanceAfterEtb, replayed: true };

      const balanceAfter = new Prisma.Decimal(rows[0].wallet_balance_etb).plus(amount);
      if (balanceAfter.isNegative()) {
        throw AppException.unprocessable(
          ErrorCode.INSUFFICIENT_WALLET_BALANCE,
          'Insufficient wallet balance',
          {
            balanceEtb: Number(rows[0].wallet_balance_etb),
            requiredEtb: amount.abs().toNumber(),
          },
        );
      }
      const entry = await t.advertiserWalletLedger.create({
        data: {
          advertiserId: input.advertiserId,
          amountEtb: amount,
          balanceAfterEtb: balanceAfter,
          entryType: input.entryType,
          referenceType: input.referenceType,
          referenceId: input.referenceId ?? null,
          idempotencyKey: input.idempotencyKey,
          description: input.description,
        },
      });
      // The ONLY write of advertisers.wallet_balance_etb.
      await t.advertiser.update({
        where: { id: input.advertiserId },
        data: { walletBalanceEtb: balanceAfter },
      });
      return { entry, balanceAfterEtb: balanceAfter, replayed: false };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  async getBalance(advertiserId: string) {
    const [adv, reserved, topups, spend] = await Promise.all([
      this.prisma.advertiser.findUnique({ where: { id: advertiserId }, select: { walletBalanceEtb: true } }),
      this.prisma.campaign.aggregate({
        where: { advertiserId, status: { in: ['pending_review', 'active', 'paused'] } },
        _sum: { budgetReservedEtb: true, spentEtb: true },
      }),
      this.prisma.advertiserWalletLedger.aggregate({
        where: { advertiserId, entryType: 'topup' },
        _sum: { amountEtb: true },
      }),
      this.prisma.campaign.aggregate({ where: { advertiserId }, _sum: { spentEtb: true } }),
    ]);
    if (!adv) throw AppException.notFound('Advertiser not found');
    const reservedEtb = new Prisma.Decimal(reserved._sum.budgetReservedEtb ?? 0).minus(
      reserved._sum.spentEtb ?? 0,
    );
    return {
      balanceEtb: adv.walletBalanceEtb,
      currency: 'ETB' as const,
      reservedEtb: reservedEtb.isNegative() ? new Prisma.Decimal(0) : reservedEtb,
      lifetimeTopupsEtb: topups._sum.amountEtb ?? new Prisma.Decimal(0),
      lifetimeSpendEtb: spend._sum.spentEtb ?? new Prisma.Decimal(0),
    };
  }

  async listEntries(advertiserId: string, query: { page?: number; limit?: number }) {
    const p = pageArgs(query);
    const [rows, total] = await Promise.all([
      this.prisma.advertiserWalletLedger.findMany({
        where: { advertiserId },
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        select: {
          id: true,
          amountEtb: true,
          balanceAfterEtb: true,
          entryType: true,
          referenceType: true,
          referenceId: true,
          description: true,
          createdAt: true,
        },
      }),
      this.prisma.advertiserWalletLedger.count({ where: { advertiserId } }),
    ]);
    return paginated(rows, total, p);
  }
}

@Global()
@Module({ providers: [WalletService], exports: [WalletService] })
export class WalletModule {}
