import { Injectable } from '@nestjs/common';
import { type ActorType, Prisma } from '@prisma/client';
import { ErrorCode, IN_FLIGHT_WITHDRAWAL_STATUSES, normalizeEthiopianPhone } from '@rap/shared';
import { AppException } from '../../../common/errors/app.exception';
import { pageArgs, paginated } from '../../../common/pagination';
import { eachUtcDay, parseDateRange, startOfUtcDay, utcDayKey } from '../../../common/utils';
import { AppConfig } from '../../../config/app-config';
import { SecurityLogger } from '../../../infra/logger/logger.module';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FraudService } from '../../fraud/fraud.service';
import { LedgerService } from '../../ledger/ledger.service';
import { NotificationService } from '../../notifications/notifications.module';
import { AdminUsersService } from './admin-users.service';
import type { AdminActor } from './admin-review.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rolls back a `releaseFlaggedCompletion` transaction when the campaign budget cannot cover the release (#15). */
class CampaignBudgetExhaustedError extends Error {
  constructor() {
    super('campaign budget exhausted');
  }
}

/** Who an audit-log `actor=` / `actorId=` filter resolved to (exposed as `meta.actor`). */
export interface ResolvedActor {
  id: string;
  actorType: ActorType | null;
  label: string;
}

@Injectable()
export class AdminReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly fraud: FraudService,
    private readonly ledger: LedgerService,
    private readonly security: SecurityLogger,
    private readonly notifications: NotificationService,
    private readonly users: AdminUsersService,
  ) {}

  async overview() {
    const today = startOfUtcDay();
    const [
      pendingAds,
      pendingCampaigns,
      pendingAdvertisers,
      wdReview,
      wdPending,
      pendingAdjustments,
      openFlags,
      openReports,
      activeUsers,
      suspended,
      activeCampaigns,
      todayValid,
      todayFlagged,
      todayRevenue,
    ] = await Promise.all([
      this.prisma.ad.count({ where: { reviewStatus: 'pending' } }),
      this.prisma.campaign.count({ where: { status: 'pending_review' } }),
      this.prisma.advertiser.count({ where: { verificationStatus: 'pending' } }),
      this.prisma.withdrawal.count({ where: { status: 'flagged_for_review' } }),
      this.prisma.withdrawal.count({ where: { status: { in: ['pending', 'processing'] } } }),
      this.prisma.coinAdjustmentRequest.count({ where: { status: 'pending_approval' } }),
      this.prisma.fraudFlag.count({ where: { resolved: false } }),
      this.prisma.adReport.count({ where: { status: 'open' } }),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { status: 'suspended' } }),
      this.prisma.campaign.count({ where: { status: 'active' } }),
      this.prisma.adCompletion.count({ where: { status: 'valid', completedAt: { gte: today } } }),
      this.prisma.adCompletion.count({
        where: { status: { in: ['flagged', 'rejected'] }, completedAt: { gte: today } },
      }),
      this.prisma.adCompletion.aggregate({
        where: { status: 'valid', completedAt: { gte: today } },
        _sum: { costEtb: true, rewardEtb: true },
      }),
    ]);
    const [pendingKyc, openAlerts, pendingDeletionRequests, adsProcessing, adsFailed, withdrawalsNeedingManualReview] = await Promise.all([
      this.prisma.kycSubmission.count({ where: { status: 'pending' } }),
      this.prisma.platformAlert.count({ where: { acknowledgedAt: null } }),
      this.prisma.accountDeletionRequest.count({ where: { status: 'pending' } }),
      this.prisma.ad.count({ where: { mediaStatus: 'processing' } }),
      this.prisma.ad.count({ where: { mediaStatus: 'failed' } }),
      this.prisma.withdrawal.count({ where: { status: 'needs_manual_review' } }),
    ]);
    return {
      pendingAdReviews: pendingAds,
      pendingCampaignReviews: pendingCampaigns,
      pendingAdvertiserVerifications: pendingAdvertisers,
      withdrawalsAwaitingReview: wdReview,
      withdrawalsPendingPayout: wdPending,
      pendingCoinAdjustments: pendingAdjustments,
      openFraudFlags: openFlags,
      openAdReports: openReports,
      activeUsers,
      suspendedUsers: suspended,
      activeCampaigns,
      todayValidCompletions: todayValid,
      todayFlaggedCompletions: todayFlagged,
      todayPlatformRevenueEtb: new Prisma.Decimal(todayRevenue._sum.costEtb ?? 0).minus(
        todayRevenue._sum.rewardEtb ?? 0,
      ),
      // Phase 4 queues
      pendingKyc,
      openAlerts,
      pendingDeletionRequests,
      adsMediaProcessing: adsProcessing,
      adsMediaFailed: adsFailed,
      // Phase 5 (#7)
      withdrawalsNeedingManualReview,
    };
  }

  platformConfig() {
    const p = this.config.platform;
    return {
      coinsPerEtb: p.coinsPerEtb,
      minWithdrawalEtb: p.minWithdrawalEtb,
      largeWithdrawalThresholdEtb: p.largeWithdrawalThresholdEtb,
      dailyAdCompletionLimit: p.dailyAdCompletionLimit,
      platformTakeRate: p.platformTakeRate,
      minWatchRatio: p.minWatchRatio,
      minAge: p.minAge,
      heartbeatIntervalSeconds: p.heartbeatIntervalSeconds,
      dailyWithdrawalRequestLimit: p.dailyWithdrawalRequestLimit,
      maxWatchAttemptsPerAdPerDay: p.maxWatchAttemptsPerAdPerDay,
      payoutMaxAttempts: this.config.env.PAYOUT_MAX_ATTEMPTS,
      minCampaignBudgetEtb: p.minCampaignBudgetEtb,
      minCostPerActionEtb: p.minCostPerActionEtb,
      minTopupEtb: p.minTopupEtb,
      kycRequiredAboveMonthlyEtb: p.kycRequiredAboveMonthlyEtb,
      defaultFrequencyCap: p.defaultFrequencyCap,
      advertiserImpressionCapPerUserPerDay: p.advertiserImpressionCapPerUserPerDay,
      referralBonusCoins: p.referralBonusCoins,
      refereeBonusCoins: p.refereeBonusCoins,
      referralMaxPerReferrerPerDay: p.referralMaxPerReferrerPerDay,
      accountDeletionGraceDays: p.accountDeletionGraceDays,
      destinationResolveTtlMinutes: p.destinationResolveTtlMinutes,
      fraud: {
        flagThreshold: this.config.fraud.flagThreshold,
        rejectThreshold: this.config.fraud.rejectThreshold,
        minTrustScoreForFeed: this.config.fraud.minTrustScoreForFeed,
      },
      alerts: {
        payoutFailureRate: this.config.alerts.payoutFailureRate,
        accountsPerDevicePerHour: this.config.alerts.accountsPerDevicePerHour,
        spendVelocityMultiplier: this.config.alerts.spendVelocityMultiplier,
        otpRequestsPerIpPerHour: this.config.alerts.otpRequestsPerIpPerHour,
      },
      mocks: this.config.mocks,
      environment: this.config.env.NODE_ENV,
      version: this.config.env.APP_VERSION,
    };
  }

  /* -------------------------------- revenue -------------------------------- */

  async revenue(range: { from?: string; to?: string }) {
    const { from, to } = parseDateRange(range.from, range.to);
    const takeRate = this.config.platform.platformTakeRate;

    const [
      adTotals,
      surveyTotals,
      topups,
      payoutsDone,
      payoutsPending,
      dailyAds,
      dailySurveys,
      dailyPayouts,
      dailyTopups,
      byAdvertiser,
      byType,
      referralCoins,
      dailyReferrals,
    ] = await Promise.all([
      this.prisma.adCompletion.aggregate({
        where: { status: 'valid', completedAt: { gte: from, lte: to } },
        _sum: { costEtb: true, rewardEtb: true },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        Array<{ cost: Prisma.Decimal | null; reward: Prisma.Decimal | null; count: bigint }>
      >`
        SELECT SUM(c.cost_per_action_etb) AS cost, SUM(s.reward_etb) AS reward, COUNT(*)::bigint AS count
        FROM survey_responses r JOIN surveys s ON s.id = r.survey_id JOIN campaigns c ON c.id = s.campaign_id
        WHERE r.status = 'valid' AND r.completed_at BETWEEN ${from} AND ${to}`,
      this.prisma.advertiserPayment.aggregate({
        where: { status: 'completed', paidAt: { gte: from, lte: to } },
        _sum: { amountEtb: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'completed', processedAt: { gte: from, lte: to } },
        _sum: { amountEtb: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: { in: [...IN_FLIGHT_WITHDRAWAL_STATUSES] } },
        _sum: { amountEtb: true },
      }),
      this.prisma.$queryRaw<
        Array<{ day: Date; cost: Prisma.Decimal | null; reward: Prisma.Decimal | null; count: bigint }>
      >`
        SELECT date_trunc('day', completed_at AT TIME ZONE 'UTC') AS day, SUM(cost_etb) AS cost, SUM(reward_etb) AS reward, COUNT(*)::bigint AS count
        FROM ad_completions WHERE status = 'valid' AND completed_at BETWEEN ${from} AND ${to} GROUP BY 1`,
      this.prisma.$queryRaw<
        Array<{ day: Date; cost: Prisma.Decimal | null; reward: Prisma.Decimal | null; count: bigint }>
      >`
        SELECT date_trunc('day', r.completed_at AT TIME ZONE 'UTC') AS day, SUM(c.cost_per_action_etb) AS cost, SUM(s.reward_etb) AS reward, COUNT(*)::bigint AS count
        FROM survey_responses r JOIN surveys s ON s.id = r.survey_id JOIN campaigns c ON c.id = s.campaign_id
        WHERE r.status = 'valid' AND r.completed_at BETWEEN ${from} AND ${to} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ day: Date; amount: Prisma.Decimal | null }>>`
        SELECT date_trunc('day', processed_at AT TIME ZONE 'UTC') AS day, SUM(amount_etb) AS amount
        FROM withdrawals WHERE status = 'completed' AND processed_at BETWEEN ${from} AND ${to} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ day: Date; amount: Prisma.Decimal | null }>>`
        SELECT date_trunc('day', paid_at AT TIME ZONE 'UTC') AS day, SUM(amount_etb) AS amount
        FROM advertiser_payments WHERE status = 'completed' AND paid_at BETWEEN ${from} AND ${to} GROUP BY 1`,
      this.prisma.$queryRaw<
        Array<{ advertiser_id: string; business_name: string; spend: Prisma.Decimal | null; count: bigint }>
      >`
        SELECT a.id AS advertiser_id, a.business_name, SUM(ac.cost_etb) AS spend, COUNT(*)::bigint AS count
        FROM ad_completions ac JOIN campaigns c ON c.id = ac.campaign_id JOIN advertisers a ON a.id = c.advertiser_id
        WHERE ac.status = 'valid' AND ac.completed_at BETWEEN ${from} AND ${to}
        GROUP BY a.id, a.business_name ORDER BY spend DESC LIMIT 20`,
      this.prisma.$queryRaw<
        Array<{ target_action_type: string; spend: Prisma.Decimal | null; count: bigint }>
      >`
        SELECT c.target_action_type::text AS target_action_type, SUM(ac.cost_etb) AS spend, COUNT(*)::bigint AS count
        FROM ad_completions ac JOIN campaigns c ON c.id = ac.campaign_id
        WHERE ac.status = 'valid' AND ac.completed_at BETWEEN ${from} AND ${to} GROUP BY 1`,
      this.prisma.coinLedger.aggregate({
        where: { sourceType: 'referral', createdAt: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; coins: bigint | null }>>`
        SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day, SUM(amount)::bigint AS coins
        FROM coin_ledger WHERE source_type = 'referral' AND created_at BETWEEN ${from} AND ${to} GROUP BY 1`,
    ]);
    const coinsPerEtb = this.config.platform.coinsPerEtb;
    const referralBonusesEtb = new Prisma.Decimal(referralCoins._sum.amount ?? 0).div(coinsPerEtb).toDecimalPlaces(2);

    const d = (v: Prisma.Decimal | number | null | undefined) => new Prisma.Decimal(v ?? 0);
    const spend = d(adTotals._sum.costEtb).plus(d(surveyTotals[0]?.cost));
    const rewards = d(adTotals._sum.rewardEtb).plus(d(surveyTotals[0]?.reward));
    const surveyCount = Number(surveyTotals[0]?.count ?? 0);

    const daily = new Map<
      string,
      {
        advertiserSpendEtb: number;
        userRewardsEtb: number;
        platformRevenueEtb: number;
        referralBonusesEtb: number;
        payoutsEtb: number;
        topupsEtb: number;
        validCompletions: number;
      }
    >();
    for (const day of eachUtcDay(from, to))
      daily.set(day, {
        advertiserSpendEtb: 0,
        userRewardsEtb: 0,
        platformRevenueEtb: 0,
        referralBonusesEtb: 0,
        payoutsEtb: 0,
        topupsEtb: 0,
        validCompletions: 0,
      });
    const bump = (day: Date, fn: (b: NonNullable<ReturnType<typeof daily.get>>) => void) => {
      const b = daily.get(utcDayKey(new Date(day)));
      if (b) fn(b);
    };
    for (const r of [...dailyAds, ...dailySurveys]) {
      bump(r.day, (b) => {
        b.advertiserSpendEtb += Number(r.cost ?? 0);
        b.userRewardsEtb += Number(r.reward ?? 0);
        b.validCompletions += Number(r.count);
      });
    }
    for (const r of dailyPayouts) bump(r.day, (b) => (b.payoutsEtb += Number(r.amount ?? 0)));
    for (const r of dailyTopups) bump(r.day, (b) => (b.topupsEtb += Number(r.amount ?? 0)));
    for (const r of dailyReferrals) bump(r.day, (b) => (b.referralBonusesEtb += Number(r.coins ?? 0) / coinsPerEtb));
    for (const b of daily.values()) {
      b.platformRevenueEtb = round2(b.advertiserSpendEtb - b.userRewardsEtb);
      b.advertiserSpendEtb = round2(b.advertiserSpendEtb);
      b.userRewardsEtb = round2(b.userRewardsEtb);
      b.payoutsEtb = round2(b.payoutsEtb);
      b.topupsEtb = round2(b.topupsEtb);
      b.referralBonusesEtb = round2(b.referralBonusesEtb);
    }

    const totalSpendNum = spend.toNumber();
    return {
      from,
      to,
      totals: {
        advertiserSpendEtb: spend,
        userRewardsEtb: rewards,
        platformRevenueEtb: spend.minus(rewards),
        referralBonusesEtb,
        netPlatformRevenueEtb: spend.minus(rewards).minus(referralBonusesEtb),
        topupsEtb: d(topups._sum.amountEtb),
        payoutsCompletedEtb: d(payoutsDone._sum.amountEtb),
        payoutsPendingEtb: d(payoutsPending._sum.amountEtb),
        validCompletions: adTotals._count._all + surveyCount,
        takeRate,
      },
      daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
      byAdvertiser: byAdvertiser.map((r) => ({
        advertiserId: r.advertiser_id,
        businessName: r.business_name,
        spendEtb: Number(r.spend ?? 0),
        validCompletions: Number(r.count),
        share: totalSpendNum ? Math.round((Number(r.spend ?? 0) / totalSpendNum) * 10000) / 10000 : 0,
      })),
      byActionType: [
        ...byType.map((r) => ({
          targetActionType: r.target_action_type,
          spendEtb: Number(r.spend ?? 0),
          validCompletions: Number(r.count),
        })),
        ...(surveyCount
          ? [
              {
                targetActionType: 'survey',
                spendEtb: Number(surveyTotals[0]?.cost ?? 0),
                validCompletions: surveyCount,
              },
            ]
          : []),
      ],
    };
  }

  /* -------------------------------- audit log -------------------------------- */

  async auditLog(query: {
    page?: number;
    limit?: number;
    actorId?: string;
    /** Admin email, user phone (any Ethiopian format) or advertiser email; resolved server-side to actorId. */
    actor?: string;
    actorType?: ActorType;
    action?: string;
    targetType?: string;
    targetId?: string;
    q?: string;
    from?: string;
    to?: string;
  }) {
    const p = pageArgs(query);
    let actor: ResolvedActor | null = null;
    if (query.actorId) {
      actor = (await this.lookupActorById(query.actorId)) ?? { id: query.actorId, actorType: null, label: query.actorId };
    } else if (query.actor?.trim()) {
      actor = await this.resolveActorDetail(query.actor.trim());
      // unknown actor => no rows (never silently drop the filter)
      if (!actor) return paginated([], 0, p, { actorResolved: false, actor: null });
    }
    const actorId = actor?.id;
    const where: Prisma.AuditLogWhereInput = {
      actorId,
      actorType: query.actorType,
      targetType: query.targetType,
      targetId: query.targetId,
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q, mode: 'insensitive' } },
              { targetType: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
      this.prisma.auditLog.count({ where }),
    ]);
    const labels = await this.actorLabels(rows);
    return paginated(
      rows.map((r) => ({
        ...r,
        actorEmail: r.actorType === 'admin' && r.actorId ? (labels.get(r.actorId) ?? null) : null,
        actorLabel: r.actorId ? (labels.get(r.actorId) ?? r.actorId) : r.actorType === 'system' ? 'system' : null,
      })),
      total,
      p,
      actor ? { actorResolved: true, actor } : {},
    );
  }

  /** Admin email / advertiser email / user phone -> id. Returns null when nothing matches. */
  async resolveActor(input: string): Promise<string | null> {
    return (await this.resolveActorDetail(input))?.id ?? null;
  }

  /**
   * Admin email / advertiser email / user phone (any Ethiopian format) / uuid -> who it is. A uuid that matches no
   * known account is still accepted as a raw actor id (e.g. a removed admin) with `actorType: null`.
   */
  async resolveActorDetail(input: string): Promise<ResolvedActor | null> {
    if (UUID_RE.test(input)) {
      return (await this.lookupActorById(input)) ?? { id: input, actorType: null, label: input };
    }
    if (input.includes('@')) {
      const email = input.toLowerCase();
      const admin = await this.prisma.adminUser.findUnique({ where: { email }, select: { id: true, email: true } });
      if (admin) return { id: admin.id, actorType: 'admin', label: admin.email ?? email };
      const advertiser = await this.prisma.advertiser.findUnique({
        where: { contactEmail: email },
        select: { id: true, contactEmail: true },
      });
      return advertiser ? { id: advertiser.id, actorType: 'advertiser', label: advertiser.contactEmail ?? email } : null;
    }
    const phone = normalizeEthiopianPhone(input);
    if (phone) {
      const user = await this.prisma.user.findUnique({ where: { phoneNumber: phone }, select: { id: true, phoneNumber: true } });
      return user ? { id: user.id, actorType: 'user', label: user.phoneNumber ?? phone } : null;
    }
    return null;
  }

  /** Which account (admin / user / advertiser) a raw id belongs to, with its human label; null when unknown. */
  private async lookupActorById(id: string): Promise<ResolvedActor | null> {
    const [admin, user, advertiser] = await Promise.all([
      this.prisma.adminUser.findUnique({ where: { id }, select: { id: true, email: true } }),
      this.prisma.user.findUnique({ where: { id }, select: { id: true, phoneNumber: true } }),
      this.prisma.advertiser.findUnique({ where: { id }, select: { id: true, contactEmail: true } }),
    ]);
    if (admin) return { id, actorType: 'admin', label: admin.email ?? id };
    if (user) return { id, actorType: 'user', label: user.phoneNumber ?? id };
    if (advertiser) return { id, actorType: 'advertiser', label: advertiser.contactEmail ?? id };
    return null;
  }

  /** Human labels for the actors of a page of rows: admin email, advertiser email, user phone. */
  private async actorLabels(rows: Array<{ actorType: ActorType; actorId: string | null }>) {
    const idsOf = (type: ActorType) => [...new Set(rows.filter((r) => r.actorType === type && r.actorId).map((r) => r.actorId!))];
    const [adminIds, userIds, advertiserIds] = [idsOf('admin'), idsOf('user'), idsOf('advertiser')];
    const [admins, users, advertisers] = await Promise.all([
      adminIds.length ? this.prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, email: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, phoneNumber: true } }) : [],
      advertiserIds.length
        ? this.prisma.advertiser.findMany({ where: { id: { in: advertiserIds } }, select: { id: true, contactEmail: true } })
        : [],
    ]);
    const labels = new Map<string, string>();
    for (const a of admins) labels.set(a.id, a.email);
    for (const u of users) labels.set(u.id, u.phoneNumber);
    for (const a of advertisers) labels.set(a.id, a.contactEmail);
    return labels;
  }

  /* ------------------------------ fraud actions ------------------------------ */

  /**
   * Dismissing a flag attached to a *flagged* completion means the fraud team confirmed the view was genuine:
   * the completion becomes valid and the reward is credited (single ledger path), charging the campaign.
   */
  async dismissFlag(flagId: string, note: string, actor: AdminActor) {
    const flag = await this.prisma.fraudFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw AppException.notFound('Fraud flag not found');
    await this.fraud.resolveFlag(flagId, 'dismissed', note, { adminId: actor.adminId, ip: actor.ip });
    if (flag.relatedEntityType === 'ad_completion' && flag.relatedEntityId)
      await this.releaseFlaggedCompletion(flag.relatedEntityId, actor);
    return this.fraud.getFlag(flagId);
  }

  async escalateFlag(flagId: string, note: string, actor: AdminActor) {
    const flag = await this.fraud.resolveFlag(flagId, 'escalated', note, {
      adminId: actor.adminId,
      ip: actor.ip,
    });
    if (flag.userId) await this.fraud.adjustTrustScore(this.prisma, flag.userId, -10, 'flag_escalated');
    return this.fraud.getFlag(flagId);
  }

  async suspendUserFromFlag(flagId: string, reason: string, actor: AdminActor) {
    const flag = await this.prisma.fraudFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw AppException.notFound('Fraud flag not found');
    if (!flag.userId)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Flag is not attached to a user');
    if (!flag.resolved)
      await this.fraud.resolveFlag(flagId, 'confirmed', reason, { adminId: actor.adminId, ip: actor.ip });
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: flag.userId },
      select: { status: true },
    });
    if (user.status === 'active') await this.users.moderateUser(flag.userId, 'suspend', reason, actor);
    await this.fraud.recomputeTrustScore(flag.userId, { adminId: actor.adminId });
    return this.fraud.getFlag(flagId);
  }

  private async releaseFlaggedCompletion(completionId: string, actor: AdminActor) {
    const completion = await this.prisma.adCompletion.findUnique({
      where: { id: completionId },
      include: { campaign: true, ad: { select: { title: true } } },
    });
    if (!completion || completion.status !== 'flagged') return;
    const stillOpen = await this.prisma.fraudFlag.count({
      where: { relatedEntityType: 'ad_completion', relatedEntityId: completionId, resolved: false },
    });
    if (stillOpen > 0) return;
    const coins = new Prisma.Decimal(completion.campaign.rewardPerActionEtb)
      .mul(this.config.platform.coinsPerEtb)
      .round()
      .toNumber();
    const credited = await this.prisma.$transaction(async (tx) => {
      // Security audit #15: claim the flagged row atomically so two concurrent resolvers cannot both release it
      // (the ledger idempotency key is the second line of defence, not the first).
      const claimed = await tx.adCompletion.updateMany({
        where: { id: completionId, status: 'flagged' },
        data: { status: 'valid', coinRewardAmount: coins, rewardEtb: completion.campaign.rewardPerActionEtb, costEtb: completion.campaign.costPerActionEtb, rejectionCode: null },
      });
      if (claimed.count === 0) return null;
      const charge = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE campaigns SET spent_etb = spent_etb + ${completion.campaign.costPerActionEtb}, updated_at = NOW()
        WHERE id = ${completion.campaignId}::uuid AND spent_etb + ${completion.campaign.costPerActionEtb} <= budget_etb RETURNING id`;
      if (charge.length === 0) throw new CampaignBudgetExhaustedError();
      const write = await this.ledger.applyEntry(
        {
          userId: completion.userId,
          amount: coins,
          sourceType: 'ad_view',
          sourceId: completionId,
          idempotencyKey: `ad_completion:${completion.watchSessionId}`,
          description: `Reward released after review for "${completion.ad.title}"`,
        },
        tx,
      );
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'completion.released',
          targetType: 'ad_completion',
          targetId: completionId,
          before: { status: 'flagged' },
          after: { status: 'valid', coins, balanceAfter: write.balanceAfter },
          ipAddress: actor.ip,
        },
        tx,
      );
      return write;
    }).catch((err: unknown) => {
      // budget exhausted: the transaction (incl. the status claim) rolled back and the completion stays flagged
      if (err instanceof CampaignBudgetExhaustedError) return null;
      throw err;
    });
    if (credited) {
      this.security.info('fraud.flag_resolved', {
        completionId,
        action: 'completion_released',
        adminId: actor.adminId,
        coins,
      });
      await this.notifications.notify({
        userId: completion.userId,
        type: 'reward_confirmed',
        title: 'Reward confirmed',
        body: `Your reward of ${coins} coins for "${completion.ad.title}" was confirmed after review.`,
        data: { completionId, coins },
      });
    }
  }

  /* --------------------------- app install offers --------------------------- */

  async listAppInstallCompletions(query: {
    page?: number;
    limit?: number;
    status?: 'pending_verification' | 'valid' | 'flagged' | 'rejected';
  }) {
    const p = pageArgs(query);
    const where: Prisma.AppInstallCompletionWhereInput = { status: query.status ?? 'pending_verification' };
    const [rows, total] = await Promise.all([
      this.prisma.appInstallCompletion.findMany({
        where,
        include: { offer: { select: { appName: true } }, user: { select: { phoneNumber: true } } },
        orderBy: { createdAt: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.appInstallCompletion.count({ where }),
    ]);
    return paginated(
      rows.map((c) => ({
        id: c.id,
        offerId: c.offerId,
        appName: c.offer.appName,
        userId: c.userId,
        userPhone: c.user.phoneNumber,
        deviceFingerprint: c.deviceFingerprint,
        proof: c.proof,
        status: c.status,
        coinReward: c.coinReward,
        createdAt: c.createdAt,
      })),
      total,
      p,
    );
  }

  async decideAppInstall(
    id: string,
    decision: 'valid' | 'rejected',
    reason: string | undefined,
    actor: AdminActor,
  ) {
    const c = await this.prisma.appInstallCompletion.findUnique({
      where: { id },
      include: { offer: { include: { campaign: true } } },
    });
    if (!c) throw AppException.notFound('Completion not found');
    if (c.status !== 'pending_verification')
      throw AppException.conflict(ErrorCode.CONFLICT, `Completion is ${c.status}`);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.appInstallCompletion.updateMany({
        where: { id, status: 'pending_verification' },
        data: {
          status: decision,
          verifiedBy: actor.adminId,
          verifiedAt: new Date(),
          rejectionReason: reason,
        },
      });
      if (claimed.count === 0)
        throw AppException.conflict(ErrorCode.CONFLICT, 'Completion decided concurrently');
      if (decision === 'valid') {
        const charge = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE campaigns SET spent_etb = spent_etb + ${c.offer.campaign.costPerActionEtb}, updated_at = NOW()
          WHERE id = ${c.offer.campaignId}::uuid AND spent_etb + ${c.offer.campaign.costPerActionEtb} <= budget_etb RETURNING id`;
        if (charge.length === 0)
          throw AppException.conflict(
            ErrorCode.CAMPAIGN_BUDGET_EXHAUSTED,
            'Campaign budget exhausted; cannot credit',
          );
        await this.ledger.applyEntry(
          {
            userId: c.userId,
            amount: c.coinReward,
            sourceType: 'app_install',
            sourceId: c.id,
            idempotencyKey: `app_install:${c.id}`,
            description: `Install verified: ${c.offer.appName}`,
          },
          tx,
        );
      }
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: `app_install.${decision}`,
          targetType: 'app_install_completion',
          targetId: id,
          before: { status: 'pending_verification' },
          after: { status: decision, reason },
          ipAddress: actor.ip,
        },
        tx,
      );
    });
    await this.notifications.notify({
      userId: c.userId,
      type: decision === 'valid' ? 'reward_confirmed' : 'system',
      title: decision === 'valid' ? 'Install reward confirmed' : 'Install could not be verified',
      body:
        decision === 'valid'
          ? `You earned ${c.coinReward} coins for installing ${c.offer.appName}.`
          : `We could not verify your install of ${c.offer.appName}.${reason ? ` Reason: ${reason}` : ''}`,
      data: { completionId: id },
    });
    return this.prisma.appInstallCompletion.findUniqueOrThrow({ where: { id } });
  }
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
