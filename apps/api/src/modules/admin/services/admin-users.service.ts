import { Injectable } from '@nestjs/common';
import { type AdvertiserVerificationStatus, Prisma, type UserStatus } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../../common/errors/app.exception';
import { pageArgs, paginated } from '../../../common/pagination';
import { SecurityLogger } from '../../../infra/logger/logger.module';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TokenService } from '../../auth/token.service';
import { CampaignsService } from '../../campaigns/campaigns.service';
import { NotificationService } from '../../notifications/notifications.module';
import { toUserProfile } from '../../users/user.mapper';
import { WithdrawalsService } from '../../withdrawals/withdrawals.service';
import type { AdminActor } from './admin-review.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationService,
    private readonly campaigns: CampaignsService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  /* -------------------------------- users -------------------------------- */

  async listUsers(query: { page?: number; limit?: number; q?: string; status?: UserStatus; minTrustScore?: number; maxTrustScore?: number }) {
    const p = pageArgs(query);
    const where: Prisma.UserWhereInput = {
      status: query.status,
      trustScore: query.minTrustScore !== undefined || query.maxTrustScore !== undefined ? { gte: query.minTrustScore, lte: query.maxTrustScore } : undefined,
      ...(query.q ? { OR: [{ phoneNumber: { contains: query.q.replace(/\s+/g, '') } }, { fullName: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { _count: { select: { fraudFlags: { where: { resolved: false } } } } } }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(
      rows.map((u) => ({ ...toUserProfile(u), deviceId: u.deviceId, statusReason: u.statusReason, openFlags: u._count.fraudFlags, lastLoginAt: u.lastLoginAt })),
      total,
      p,
    );
  }

  async getUser(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { _count: { select: { fraudFlags: { where: { resolved: false } } } } } });
    if (!u) throw AppException.notFound('User not found');
    const [byStatus, earned, withdrawn, devices, ips, recentLedger, flags, withdrawals] = await Promise.all([
      this.prisma.adCompletion.groupBy({ by: ['status'], where: { userId: id }, _count: { _all: true } }),
      this.prisma.coinLedger.aggregate({ where: { userId: id, amount: { gt: 0 }, sourceType: { in: ['ad_view', 'survey', 'app_install'] } }, _sum: { amount: true } }),
      this.prisma.withdrawal.aggregate({ where: { userId: id, status: 'completed' }, _sum: { amountEtb: true } }),
      this.prisma.adWatchSession.findMany({ where: { userId: id }, distinct: ['deviceFingerprint'], select: { deviceFingerprint: true } }),
      this.prisma.adWatchSession.findMany({ where: { userId: id }, distinct: ['ipAddress'], select: { ipAddress: true } }),
      this.prisma.coinLedger.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, amount: true, balanceAfter: true, sourceType: true, sourceId: true, description: true, createdAt: true } }),
      this.prisma.fraudFlag.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.withdrawal.findMany({ where: { userId: id }, orderBy: { requestedAt: 'desc' }, take: 20, include: { _count: { select: { approvals: true } } } }),
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    return {
      ...toUserProfile(u),
      deviceId: u.deviceId,
      statusReason: u.statusReason,
      openFlags: u._count.fraudFlags,
      lastLoginAt: u.lastLoginAt,
      lastIp: u.lastIp,
      stats: {
        totalCompletions: byStatus.reduce((n, b) => n + b._count._all, 0),
        validCompletions: count('valid'),
        flaggedCompletions: count('flagged'),
        rejectedCompletions: count('rejected'),
        totalEarnedCoins: earned._sum.amount ?? 0,
        totalWithdrawnEtb: withdrawn._sum.amountEtb ?? new Prisma.Decimal(0),
        distinctDevices: devices.length,
        distinctIps: ips.length,
      },
      recentLedger,
      flags: flags.map((f) => ({ ...f, userPhone: u.phoneNumber })),
      withdrawals: withdrawals.map((w) => this.withdrawals.toUserView(w, w._count.approvals)),
    };
  }

  async moderateUser(id: string, action: 'suspend' | 'ban' | 'reinstate', reason: string, actor: AdminActor) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw AppException.notFound('User not found');
    const target: UserStatus = action === 'suspend' ? 'suspended' : action === 'ban' ? 'banned' : 'active';
    if (u.status === target) throw AppException.conflict(ErrorCode.USER_INVALID_STATE, `User is already ${target}`);
    if (action === 'reinstate' && u.status === 'active') throw AppException.conflict(ErrorCode.USER_INVALID_STATE, 'User is active');

    const updated = await this.prisma.$transaction(async (tx) => {
      const nu = await tx.user.update({ where: { id }, data: { status: target, statusReason: action === 'reinstate' ? null : reason } });
      if (target !== 'active') {
        await tx.adWatchSession.updateMany({ where: { userId: id, status: 'active' }, data: { status: 'abandoned' } });
        await tx.refreshToken.updateMany({ where: { subjectType: 'user', subjectId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.record(
        { actorType: 'admin', actorId: actor.adminId, action: `user.${action}`, targetType: 'user', targetId: id, before: { status: u.status, statusReason: u.statusReason }, after: { status: target, reason }, ipAddress: actor.ip },
        tx,
      );
      return nu;
    });
    this.security.warn('admin.moderation', { action: `user.${action}`, userId: id, adminId: actor.adminId, reason });
    if (target === 'active') {
      await this.notifications.notify({ userId: id, type: 'account_status', title: 'Account reinstated', body: 'Your account has been reinstated. Welcome back!', data: { status: 'active' } });
    }
    return { ...toUserProfile(updated), statusReason: updated.statusReason };
  }

  /* ----------------------------- advertisers ----------------------------- */

  async listAdvertisers(query: { page?: number; limit?: number; status?: AdvertiserVerificationStatus; q?: string }) {
    const p = pageArgs(query);
    const where: Prisma.AdvertiserWhereInput = {
      verificationStatus: query.status,
      ...(query.q ? { OR: [{ businessName: { contains: query.q, mode: 'insensitive' } }, { contactEmail: { contains: query.q, mode: 'insensitive' } }, { businessRegistrationNumber: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.advertiser.findMany({ where, orderBy: [{ verificationStatus: 'asc' }, { createdAt: 'desc' }], skip: p.skip, take: p.take, include: { _count: { select: { campaigns: true } }, campaigns: { select: { spentEtb: true } } } }),
      this.prisma.advertiser.count({ where }),
    ]);
    return paginated(rows.map((a) => this.toAdvertiserItem(a)), total, p);
  }

  async getAdvertiser(id: string) {
    const a = await this.prisma.advertiser.findUnique({
      where: { id },
      include: { _count: { select: { campaigns: true } }, campaigns: { include: { _count: { select: { ads: true } }, ads: { select: { reviewStatus: true } } }, orderBy: { createdAt: 'desc' } } },
    });
    if (!a) throw AppException.notFound('Advertiser not found');
    return { ...this.toAdvertiserItem(a), campaigns: a.campaigns.map((c) => this.campaigns.toSummary(c)) };
  }

  async decideAdvertiser(id: string, decision: 'verified' | 'rejected', note: string | undefined, actor: AdminActor) {
    if (decision === 'rejected' && !note?.trim()) throw AppException.badRequest(ErrorCode.REJECTION_REASON_REQUIRED, 'A rejection reason is required');
    const a = await this.prisma.advertiser.findUnique({ where: { id } });
    if (!a) throw AppException.notFound('Advertiser not found');
    if (a.verificationStatus === decision) throw AppException.conflict(ErrorCode.CONFLICT, `Advertiser is already ${decision}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.advertiser.update({ where: { id }, data: { verificationStatus: decision, verificationNote: note, verifiedBy: actor.adminId, verifiedAt: new Date() } });
      await this.audit.record(
        { actorType: 'admin', actorId: actor.adminId, action: `advertiser.${decision}`, targetType: 'advertiser', targetId: id, before: { verificationStatus: a.verificationStatus }, after: { verificationStatus: decision, note }, ipAddress: actor.ip },
        tx,
      );
    });
    return this.getAdvertiser(id);
  }

  private toAdvertiserItem(a: Prisma.AdvertiserGetPayload<{ include: { _count: { select: { campaigns: true } }; campaigns: { select: { spentEtb: true } } } }> | Prisma.AdvertiserGetPayload<{ include: { _count: { select: { campaigns: true } }; campaigns: true } }>) {
    return {
      id: a.id,
      businessName: a.businessName,
      businessRegistrationNumber: a.businessRegistrationNumber,
      contactEmail: a.contactEmail,
      contactPhone: a.contactPhone,
      verificationStatus: a.verificationStatus,
      verificationNote: a.verificationNote,
      verifiedBy: a.verifiedBy,
      verifiedAt: a.verifiedAt,
      walletBalanceEtb: a.walletBalanceEtb,
      campaignsCount: a._count.campaigns,
      lifetimeSpendEtb: a.campaigns.reduce((sum, c) => sum.plus(c.spentEtb), new Prisma.Decimal(0)),
      createdAt: a.createdAt,
    };
  }

  /** Used by the guard-free token revocation path when banning via fraud actions. */
  revokeSessions(userId: string) {
    return this.tokens.revokeAllForSubject('user', userId);
  }
}
