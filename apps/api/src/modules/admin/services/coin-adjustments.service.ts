import { Injectable } from '@nestjs/common';
import { type CoinAdjustmentStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../../common/errors/app.exception';
import { pageArgs, paginated } from '../../../common/pagination';
import { SecurityLogger } from '../../../infra/logger/logger.module';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { LedgerService } from '../../ledger/ledger.service';
import { NotificationService } from '../../notifications/notifications.module';
import type { AdminActor } from './admin-review.service';

const include = {
  user: { select: { phoneNumber: true } },
  requester: { select: { email: true } },
  approver: { select: { email: true } },
} satisfies Prisma.CoinAdjustmentRequestInclude;

/**
 * Manual coin adjustments as a real two-step workflow:
 *   1. admin A creates a request (pending_approval) — nothing is credited yet;
 *   2. a DIFFERENT admin B approves — the ledger write happens exactly once, atomically with the status change;
 *   or B rejects / A cancels. Every step is audited.
 */
@Injectable()
export class CoinAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    private readonly notifications: NotificationService,
  ) {}

  async list(query: { page?: number; limit?: number; status?: CoinAdjustmentStatus; userId?: string }) {
    const p = pageArgs(query);
    const where: Prisma.CoinAdjustmentRequestWhereInput = { status: query.status, userId: query.userId };
    const [rows, total] = await Promise.all([
      this.prisma.coinAdjustmentRequest.findMany({ where, include, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: p.skip, take: p.take }),
      this.prisma.coinAdjustmentRequest.count({ where }),
    ]);
    return paginated(rows.map((r) => this.toItem(r)), total, p);
  }

  async get(id: string) {
    const r = await this.prisma.coinAdjustmentRequest.findUnique({ where: { id }, include });
    if (!r) throw AppException.notFound('Adjustment request not found');
    return this.toItem(r);
  }

  async create(dto: { userId: string; amount: number; reason: string; reference?: string }, actor: AdminActor) {
    if (!Number.isInteger(dto.amount) || dto.amount === 0) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'amount must be a non-zero integer');
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, coinBalance: true } });
    if (!user) throw AppException.notFound('User not found');
    if (dto.amount < 0 && user.coinBalance + dto.amount < 0) {
      throw AppException.unprocessable(ErrorCode.INSUFFICIENT_BALANCE, 'Deduction exceeds the user balance', { coinBalance: user.coinBalance });
    }
    const request = await this.prisma.$transaction(async (tx) => {
      const r = await tx.coinAdjustmentRequest.create({ data: { userId: dto.userId, amount: dto.amount, reason: dto.reason.trim(), reference: dto.reference?.trim(), requestedBy: actor.adminId }, include });
      await this.audit.record({ actorType: 'admin', actorId: actor.adminId, action: 'coin_adjustment.requested', targetType: 'coin_adjustment_request', targetId: r.id, after: { userId: dto.userId, amount: dto.amount, reason: dto.reason, status: r.status }, ipAddress: actor.ip }, tx);
      return r;
    });
    this.security.info('adjustment.requested', { requestId: request.id, userId: dto.userId, amount: dto.amount, requestedBy: actor.adminId });
    return this.toItem(request);
  }

  async approve(id: string, note: string | undefined, actor: AdminActor) {
    const r = await this.prisma.coinAdjustmentRequest.findUnique({ where: { id } });
    if (!r) throw AppException.notFound('Adjustment request not found');
    if (r.status !== 'pending_approval') throw AppException.conflict(ErrorCode.ADJUSTMENT_NOT_PENDING, `Request is ${r.status}`);
    if (r.requestedBy === actor.adminId) {
      this.security.warn('adjustment.self_approval_blocked', { requestId: id, adminId: actor.adminId });
      throw AppException.forbidden(ErrorCode.ADJUSTMENT_SELF_APPROVAL_FORBIDDEN, 'The requesting admin cannot approve their own adjustment');
    }

    const executed = await this.prisma.$transaction(async (tx) => {
      // Claim atomically so two concurrent approvals cannot both execute.
      const claimed = await tx.coinAdjustmentRequest.updateMany({
        where: { id, status: 'pending_approval' },
        data: { status: 'executed', approvedBy: actor.adminId, decisionNote: note, executedAt: new Date() },
      });
      if (claimed.count === 0) throw AppException.conflict(ErrorCode.ADJUSTMENT_NOT_PENDING, 'Request was decided concurrently');
      const write = await this.ledger.applyEntry(
        { userId: r.userId, amount: r.amount, sourceType: 'admin_adjustment', sourceId: r.id, idempotencyKey: `adjustment:${r.id}`, description: r.reason, createdBy: r.requestedBy },
        tx,
      );
      const updated = await tx.coinAdjustmentRequest.update({ where: { id }, data: { ledgerEntryId: write.entry.id }, include });
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'coin_adjustment.approved',
          targetType: 'coin_adjustment_request',
          targetId: id,
          before: { status: 'pending_approval', approvedBy: null },
          after: { status: 'executed', approvedBy: actor.adminId, requestedBy: r.requestedBy, amount: r.amount, ledgerEntryId: write.entry.id, balanceAfter: write.balanceAfter, note },
          ipAddress: actor.ip,
        },
        tx,
      );
      return { updated, balanceAfter: write.balanceAfter };
    });

    this.security.info('adjustment.executed', { requestId: id, userId: r.userId, amount: r.amount, requestedBy: r.requestedBy, approvedBy: actor.adminId, balanceAfter: executed.balanceAfter });
    await this.notifications.notify({
      userId: r.userId,
      type: 'system',
      title: r.amount > 0 ? 'Coins added to your balance' : 'Balance adjustment',
      body: r.amount > 0 ? `${r.amount} coins were added to your balance: ${r.reason}` : `${-r.amount} coins were deducted from your balance: ${r.reason}`,
      data: { adjustmentId: id, amount: r.amount },
    });
    return this.toItem(executed.updated);
  }

  async reject(id: string, reason: string, actor: AdminActor) {
    const r = await this.prisma.coinAdjustmentRequest.findUnique({ where: { id } });
    if (!r) throw AppException.notFound('Adjustment request not found');
    if (r.status !== 'pending_approval') throw AppException.conflict(ErrorCode.ADJUSTMENT_NOT_PENDING, `Request is ${r.status}`);
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.coinAdjustmentRequest.updateMany({ where: { id, status: 'pending_approval' }, data: { status: 'rejected', rejectedBy: actor.adminId, decisionNote: reason } });
      if (claimed.count === 0) throw AppException.conflict(ErrorCode.ADJUSTMENT_NOT_PENDING, 'Request was decided concurrently');
      await this.audit.record({ actorType: 'admin', actorId: actor.adminId, action: 'coin_adjustment.rejected', targetType: 'coin_adjustment_request', targetId: id, before: { status: 'pending_approval' }, after: { status: 'rejected', reason }, ipAddress: actor.ip }, tx);
      return tx.coinAdjustmentRequest.findUniqueOrThrow({ where: { id }, include });
    });
    return this.toItem(updated);
  }

  async cancel(id: string, actor: AdminActor) {
    const r = await this.prisma.coinAdjustmentRequest.findUnique({ where: { id } });
    if (!r) throw AppException.notFound('Adjustment request not found');
    if (r.status !== 'pending_approval') throw AppException.conflict(ErrorCode.ADJUSTMENT_NOT_PENDING, `Request is ${r.status}`);
    if (r.requestedBy !== actor.adminId) throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Only the requesting admin can cancel');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.coinAdjustmentRequest.updateMany({ where: { id, status: 'pending_approval' }, data: { status: 'cancelled', decisionNote: 'Cancelled by requester' } });
      await this.audit.record({ actorType: 'admin', actorId: actor.adminId, action: 'coin_adjustment.cancelled', targetType: 'coin_adjustment_request', targetId: id, before: { status: 'pending_approval' }, after: { status: 'cancelled' }, ipAddress: actor.ip }, tx);
      return tx.coinAdjustmentRequest.findUniqueOrThrow({ where: { id }, include });
    });
    return this.toItem(updated);
  }

  private toItem(r: Prisma.CoinAdjustmentRequestGetPayload<{ include: typeof include }>) {
    return {
      id: r.id,
      userId: r.userId,
      userPhone: r.user.phoneNumber,
      amount: r.amount,
      reason: r.reason,
      reference: r.reference,
      status: r.status,
      requestedBy: r.requestedBy,
      requestedByEmail: r.requester.email,
      approvedBy: r.approvedBy,
      approvedByEmail: r.approver?.email ?? null,
      rejectedBy: r.rejectedBy,
      decisionNote: r.decisionNote,
      ledgerEntryId: r.ledgerEntryId,
      executedAt: r.executedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
