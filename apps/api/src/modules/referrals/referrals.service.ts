import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ReferralStatus } from '@prisma/client';
import { ErrorCode, REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from '@rap/shared';
import { randomInt } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { maskDestination, startOfUtcDay } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FraudService } from '../fraud/fraud.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationService } from '../notifications/notifications.module';

export const REFERRAL_REJECTION = {
  selfDevice: 'self_referral_device',
  selfIp: 'self_referral_ip',
  referrerDailyCap: 'referrer_daily_cap',
  referrerInactive: 'referrer_inactive',
} as const;

export const REFERRAL_FLAG_TYPE = 'REFERRAL_SELF_REFERRAL';

export interface QualifyingCompletion {
  userId: string;
  completionId: string;
  deviceFingerprint: string;
  ipAddress: string;
  now?: Date;
}

export type ReferralOutcome =
  | { status: 'paid'; referralId: string; referrerId: string; referrerBonus: number; refereeBonus: number }
  | { status: 'qualified'; referralId: string; referrerId: string; reason: string }
  | { status: 'rejected'; referralId: string; referrerId: string; reason: string }
  | null;

const referralInclude = {
  referee: { select: { id: true, phoneNumber: true, fullName: true, createdAt: true } },
  referrer: { select: { id: true, phoneNumber: true, fullName: true } },
} satisfies Prisma.ReferralInclude;

type ReferralRow = Prisma.ReferralGetPayload<{ include: typeof referralInclude }>;

/**
 * Referral programme. A referee signs up with a code (stored on FIRST login only); nothing is credited until the
 * referee's first `valid` ad completion, when both bonuses are written through the single ledger function INSIDE
 * the completion transaction (source_type `referral`). Fraud guards (shared device / IP with the referrer) reject
 * the referral and flag both accounts; a per-referrer daily cap withholds the bonus without flagging.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly fraud: FraudService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    private readonly notifications: NotificationService,
  ) {}

  /* ------------------------------ codes ------------------------------ */

  static generateCode(): string {
    let code = '';
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
      code += REFERRAL_CODE_ALPHABET[randomInt(0, REFERRAL_CODE_ALPHABET.length)];
    }
    return code;
  }

  static normalizeCode(raw: string): string {
    return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** Returns the user's code, generating (and persisting) one if the account predates the programme. */
  async ensureCode(userId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<string> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (!user) throw AppException.notFound('User not found');
    if (user.referralCode) return user.referralCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = ReferralsService.generateCode();
      try {
        await tx.user.update({ where: { id: userId }, data: { referralCode: code } });
        return code;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    throw new Error('Could not allocate a unique referral code');
  }

  /** Resolves a referral code to the referrer (400 REFERRAL_CODE_INVALID when unknown). */
  async resolveReferrer(rawCode: string): Promise<{ id: string; status: string }> {
    const code = ReferralsService.normalizeCode(rawCode);
    const referrer = code
      ? await this.prisma.user.findUnique({ where: { referralCode: code }, select: { id: true, status: true } })
      : null;
    if (!referrer || referrer.status === 'deleted') {
      throw AppException.badRequest(ErrorCode.REFERRAL_CODE_INVALID, 'This referral code is not valid', { code });
    }
    return referrer;
  }

  /** Records a pending referral for a brand-new account (call inside the signup transaction). */
  async applyOnSignup(
    tx: Prisma.TransactionClient,
    input: { refereeId: string; referrerId: string; code: string; ip?: string; deviceFingerprint?: string },
  ) {
    if (input.refereeId === input.referrerId) {
      throw AppException.badRequest(ErrorCode.REFERRAL_SELF_NOT_ALLOWED, 'You cannot refer yourself');
    }
    const existing = await tx.referral.findUnique({ where: { refereeId: input.refereeId } });
    if (existing) {
      throw AppException.conflict(ErrorCode.REFERRAL_ALREADY_APPLIED, 'A referral code was already applied');
    }
    const referral = await tx.referral.create({
      data: {
        referrerId: input.referrerId,
        refereeId: input.refereeId,
        code: ReferralsService.normalizeCode(input.code),
        signupIp: input.ip,
        signupDeviceFingerprint: input.deviceFingerprint,
      },
    });
    this.security.info('referral.applied', {
      referralId: referral.id,
      referrerId: input.referrerId,
      refereeId: input.refereeId,
      ip: input.ip,
    });
    return referral;
  }

  /* ------------------------------ qualification ------------------------------ */

  /**
   * Called inside the ad-completion transaction after a VALID completion was written. Idempotent: only a
   * `pending` referral whose referee has no earlier valid completion can qualify, and the ledger keys are unique.
   */
  async onValidCompletion(tx: Prisma.TransactionClient, c: QualifyingCompletion): Promise<ReferralOutcome> {
    const now = c.now ?? new Date();
    const referral = await tx.referral.findUnique({ where: { refereeId: c.userId } });
    if (!referral || referral.status !== 'pending') return null;

    const earlier = await tx.adCompletion.count({
      where: { userId: c.userId, status: 'valid', id: { not: c.completionId } },
    });
    if (earlier > 0) return null; // not the first valid completion (defensive; status would not be pending)

    const referrer = await tx.user.findUnique({
      where: { id: referral.referrerId },
      select: { id: true, status: true, signupDeviceFingerprint: true, signupIp: true, lastIp: true },
    });
    if (!referrer) return null;

    const fraudReason = await this.selfReferralReason(tx, referral, referrer, c);
    if (fraudReason) return this.rejectForFraud(tx, referral, referrer.id, fraudReason, c, now);

    if (referrer.status !== 'active') {
      return this.withhold(tx, referral, referrer.id, REFERRAL_REJECTION.referrerInactive, c, now);
    }
    const paidToday = await tx.referral.count({
      where: { referrerId: referrer.id, status: 'paid', paidAt: { gte: startOfUtcDay(now) } },
    });
    if (paidToday >= this.config.platform.referralMaxPerReferrerPerDay) {
      return this.withhold(tx, referral, referrer.id, REFERRAL_REJECTION.referrerDailyCap, c, now);
    }

    const referrerBonus = this.config.platform.referralBonusCoins;
    const refereeBonus = this.config.platform.refereeBonusCoins;
    // Single ledger write path for both bonuses; keys are unique per referral so a replay can never double-credit.
    if (referrerBonus > 0) {
      await this.ledger.applyEntry(
        {
          userId: referrer.id,
          amount: referrerBonus,
          sourceType: 'referral',
          sourceId: referral.id,
          idempotencyKey: `referral_referrer:${referral.id}`,
          description: 'Referral bonus: your friend completed their first ad',
        },
        tx,
      );
    }
    if (refereeBonus > 0) {
      await this.ledger.applyEntry(
        {
          userId: c.userId,
          amount: refereeBonus,
          sourceType: 'referral',
          sourceId: referral.id,
          idempotencyKey: `referral_referee:${referral.id}`,
          description: 'Welcome bonus for joining with a referral code',
        },
        tx,
      );
    }
    await tx.referral.update({
      where: { id: referral.id },
      data: {
        status: 'paid',
        referrerBonusCoins: referrerBonus,
        refereeBonusCoins: refereeBonus,
        qualifyingCompletionId: c.completionId,
        qualifiedAt: now,
        paidAt: now,
      },
    });
    await this.audit.record(
      {
        actorType: 'system',
        action: 'referral.paid',
        targetType: 'referral',
        targetId: referral.id,
        before: { status: 'pending' },
        after: { status: 'paid', referrerBonus, refereeBonus, completionId: c.completionId },
      },
      tx,
    );
    this.security.info('referral.paid', {
      referralId: referral.id,
      referrerId: referrer.id,
      refereeId: c.userId,
      referrerBonus,
      refereeBonus,
    });
    return { status: 'paid', referralId: referral.id, referrerId: referrer.id, referrerBonus, refereeBonus };
  }

  /** After the completion transaction committed: notify both parties (best effort). */
  async notifyOutcome(outcome: ReferralOutcome, refereeId: string) {
    if (!outcome || outcome.status !== 'paid') return;
    await Promise.all([
      this.notifications.notify({
        userId: outcome.referrerId,
        type: 'referral',
        title: 'Referral bonus earned',
        body: `Your friend completed their first ad. ${outcome.referrerBonus} coins were added to your balance.`,
        data: { referralId: outcome.referralId, coins: outcome.referrerBonus },
      }),
      outcome.refereeBonus > 0
        ? this.notifications.notify({
            userId: refereeId,
            type: 'referral',
            title: 'Welcome bonus',
            body: `You received ${outcome.refereeBonus} bonus coins for joining with a referral code.`,
            data: { referralId: outcome.referralId, coins: outcome.refereeBonus },
          })
        : Promise.resolve(),
    ]).catch((err) => this.logger.warn(`Referral notifications failed: ${(err as Error).message}`));
  }

  private async selfReferralReason(
    tx: Prisma.TransactionClient,
    referral: { signupDeviceFingerprint: string | null; signupIp: string | null },
    referrer: { id: string; signupDeviceFingerprint: string | null; signupIp: string | null; lastIp: string | null },
    c: QualifyingCompletion,
  ): Promise<string | null> {
    const refereeDevices = [referral.signupDeviceFingerprint, c.deviceFingerprint].filter(
      (v): v is string => Boolean(v),
    );
    const refereeIps = [referral.signupIp, c.ipAddress].filter((v): v is string => Boolean(v));

    if (refereeDevices.length) {
      if (referrer.signupDeviceFingerprint && refereeDevices.includes(referrer.signupDeviceFingerprint)) {
        return REFERRAL_REJECTION.selfDevice;
      }
      const sharedDevice = await tx.adWatchSession.findFirst({
        where: { userId: referrer.id, deviceFingerprint: { in: refereeDevices } },
        select: { id: true },
      });
      if (sharedDevice) return REFERRAL_REJECTION.selfDevice;
    }
    if (refereeIps.length) {
      const referrerIps = [referrer.signupIp, referrer.lastIp].filter((v): v is string => Boolean(v));
      if (referrerIps.some((ip) => refereeIps.includes(ip))) return REFERRAL_REJECTION.selfIp;
      const sharedIp = await tx.adWatchSession.findFirst({
        where: { userId: referrer.id, ipAddress: { in: refereeIps } },
        select: { id: true },
      });
      if (sharedIp) return REFERRAL_REJECTION.selfIp;
    }
    return null;
  }

  private async rejectForFraud(
    tx: Prisma.TransactionClient,
    referral: { id: string; referrerId: string; refereeId: string },
    referrerId: string,
    reason: string,
    c: QualifyingCompletion,
    now: Date,
  ): Promise<ReferralOutcome> {
    await tx.referral.update({
      where: { id: referral.id },
      data: { status: 'rejected', rejectionReason: reason, qualifyingCompletionId: c.completionId, qualifiedAt: now },
    });
    for (const userId of [referral.referrerId, referral.refereeId]) {
      await tx.fraudFlag.create({
        data: {
          userId,
          relatedEntityType: 'referral',
          relatedEntityId: referral.id,
          flagType: REFERRAL_FLAG_TYPE,
          severity: 'medium',
          description: `Referral rejected: ${reason.replace(/_/g, ' ')} (referrer ${referral.referrerId}, referee ${referral.refereeId})`,
          metadata: { reason, completionId: c.completionId, deviceFingerprint: c.deviceFingerprint, ip: c.ipAddress },
          trustScoreDelta: -5,
        },
      });
      await this.fraud.adjustTrustScore(tx, userId, -5, `referral_${reason}`);
    }
    await this.audit.record(
      {
        actorType: 'system',
        action: 'referral.rejected',
        targetType: 'referral',
        targetId: referral.id,
        before: { status: 'pending' },
        after: { status: 'rejected', reason },
      },
      tx,
    );
    this.security.warn('referral.rejected', {
      referralId: referral.id,
      referrerId,
      refereeId: referral.refereeId,
      reason,
      ip: c.ipAddress,
    });
    return { status: 'rejected', referralId: referral.id, referrerId, reason };
  }

  private async withhold(
    tx: Prisma.TransactionClient,
    referral: { id: string; refereeId: string },
    referrerId: string,
    reason: string,
    c: QualifyingCompletion,
    now: Date,
  ): Promise<ReferralOutcome> {
    await tx.referral.update({
      where: { id: referral.id },
      data: { status: 'qualified', rejectionReason: reason, qualifyingCompletionId: c.completionId, qualifiedAt: now },
    });
    await this.audit.record(
      {
        actorType: 'system',
        action: 'referral.bonus_withheld',
        targetType: 'referral',
        targetId: referral.id,
        after: { status: 'qualified', reason },
      },
      tx,
    );
    this.security.info('referral.bonus_withheld', { referralId: referral.id, referrerId, reason });
    return { status: 'qualified', referralId: referral.id, referrerId, reason };
  }

  /* ------------------------------ user API ------------------------------ */

  async myReferrals(userId: string) {
    const code = await this.ensureCode(userId);
    const [rows, referredBy] = await Promise.all([
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        include: referralInclude,
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.referral.findUnique({ where: { refereeId: userId } }),
    ]);
    const p = this.config.platform;
    const shareUrl = this.config.env.REFERRAL_SHARE_URL.replace('{code}', code);
    const count = (s: ReferralStatus) => rows.filter((r) => r.status === s).length;
    return {
      code,
      shareText: {
        en: `Join me on Gize and earn Birr for watching ads. Use my code ${code} when you sign up: ${shareUrl}`,
        am: `Gize ላይ ማስታወቂያ እየተመለከቱ ብር ያግኙ። ሲመዘገቡ ኮዴን ${code} ይጠቀሙ፦ ${shareUrl}`,
      },
      shareUrl,
      bonusCoins: { referrer: p.referralBonusCoins, referee: p.refereeBonusCoins },
      maxPerDay: p.referralMaxPerReferrerPerDay,
      totals: {
        invited: rows.length,
        pending: count('pending'),
        paid: count('paid'),
        rejected: count('rejected'),
        coinsEarned: rows.reduce((sum, r) => sum + r.referrerBonusCoins, 0),
      },
      referredBy: referredBy
        ? { status: referredBy.status, bonusCoins: referredBy.refereeBonusCoins, qualifiedAt: referredBy.qualifiedAt }
        : null,
      referrals: rows.map((r) => this.toItem(r)),
    };
  }

  /* ------------------------------ admin API ------------------------------ */

  async adminList(query: {
    page?: number;
    limit?: number;
    status?: ReferralStatus;
    referrerId?: string;
    refereeId?: string;
  }) {
    const p = pageArgs(query);
    const where: Prisma.ReferralWhereInput = {
      status: query.status,
      referrerId: query.referrerId,
      refereeId: query.refereeId,
    };
    const [rows, total] = await Promise.all([
      this.prisma.referral.findMany({
        where,
        include: referralInclude,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.referral.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({
        ...this.toItem(r),
        referrer: r.referrer,
        refereePhone: r.referee.phoneNumber,
        signupIp: r.signupIp,
        signupDeviceFingerprint: r.signupDeviceFingerprint,
      })),
      total,
      p,
    );
  }

  async adminMetrics() {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [byStatus, paidAgg, recent, top] = await Promise.all([
      this.prisma.referral.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.referral.aggregate({
        where: { status: 'paid' },
        _sum: { referrerBonusCoins: true, refereeBonusCoins: true },
      }),
      this.prisma.referral.findMany({ where: { createdAt: { gte: since } }, select: { status: true } }),
      this.prisma.referral.groupBy({
        by: ['referrerId'],
        where: { status: 'paid' },
        _count: { _all: true },
        orderBy: { _count: { referrerId: 'desc' } },
        take: 5,
      }),
    ]);
    const topUsers = top.length
      ? await this.prisma.user.findMany({
          where: { id: { in: top.map((t) => t.referrerId) } },
          select: { id: true, phoneNumber: true, fullName: true },
        })
      : [];
    const statusCount = (s: ReferralStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const coinsPaid = (paidAgg._sum.referrerBonusCoins ?? 0) + (paidAgg._sum.refereeBonusCoins ?? 0);
    return {
      total: byStatus.reduce((n, b) => n + b._count._all, 0),
      byStatus: {
        pending: statusCount('pending'),
        qualified: statusCount('qualified'),
        paid: statusCount('paid'),
        rejected: statusCount('rejected'),
      },
      bonusCoinsPaid: coinsPaid,
      bonusEtbPaid: Math.round((coinsPaid / this.config.platform.coinsPerEtb) * 100) / 100,
      last7Days: {
        invited: recent.length,
        paid: recent.filter((r) => r.status === 'paid').length,
        rejected: recent.filter((r) => r.status === 'rejected').length,
      },
      topReferrers: top.map((t) => {
        const u = topUsers.find((x) => x.id === t.referrerId);
        return {
          userId: t.referrerId,
          phoneNumber: u?.phoneNumber ?? '',
          fullName: u?.fullName ?? null,
          paid: t._count._all,
        };
      }),
    };
  }

  /** Referral bonuses credited in a period (platform cost line for the revenue dashboard), in coins. */
  async bonusCoinsBetween(from: Date, to: Date): Promise<number> {
    const agg = await this.prisma.coinLedger.aggregate({
      where: { sourceType: 'referral', createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  async referralStatsForUser(userId: string) {
    const [rows, paidAgg] = await Promise.all([
      this.prisma.referral.groupBy({ by: ['status'], where: { referrerId: userId }, _count: { _all: true } }),
      this.prisma.referral.aggregate({
        where: { referrerId: userId, status: 'paid' },
        _sum: { referrerBonusCoins: true },
      }),
    ]);
    return {
      referred: rows.reduce((n, r) => n + r._count._all, 0),
      paid: rows.find((r) => r.status === 'paid')?._count._all ?? 0,
      bonusCoinsEarned: paidAgg._sum.referrerBonusCoins ?? 0,
    };
  }

  private toItem(r: ReferralRow) {
    return {
      id: r.id,
      status: r.status,
      referee: {
        id: r.referee.id,
        displayName: r.referee.fullName?.split(' ')[0] ?? maskDestination(r.referee.phoneNumber),
        joinedAt: r.referee.createdAt,
      },
      referrerBonusCoins: r.referrerBonusCoins,
      refereeBonusCoins: r.refereeBonusCoins,
      qualifiedAt: r.qualifiedAt,
      paidAt: r.paidAt,
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt,
    };
  }
}
