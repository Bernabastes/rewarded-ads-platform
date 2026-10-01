import { Injectable, Logger } from '@nestjs/common';
import { type CompletionStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { randomInt } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { addSeconds, secondsUntilEndOfUtcDay, startOfUtcDay, utcDayKey } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { FraudService } from '../fraud/fraud.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationService } from '../notifications/notifications.module';
import { type ReferralOutcome, ReferralsService } from '../referrals/referrals.service';
import { expectedHeartbeats, minWatchSeconds, verifyWatchSession } from './completion.verifier';

export interface CompletionResultView {
  completionId: string | null;
  sessionId: string;
  status: CompletionStatus;
  coinReward: number;
  watchDurationSeconds: number;
  newBalance: number | null;
  reasonCode: ErrorCode | null;
  fraudFlags: string[];
  replayed: boolean;
}

const CAP_STATUSES: CompletionStatus[] = ['valid', 'flagged'];

const adInclude = {
  campaign: { include: { advertiser: { select: { businessName: true } } } },
  _count: { select: { attentionQuestions: true } },
} satisfies Prisma.AdInclude;

type AdWithCampaign = Prisma.AdGetPayload<{ include: typeof adInclude }>;

class SessionAlreadyClaimed extends Error {}

/** Fisher-Yates permutation of [0..n) using crypto randomness (pentest A3a: per-session option order). */
export function shuffledOrder(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Maps the position the client picked in the shuffled list back to the question's original option index. */
export function unshuffleAnswer(answerIndex: number | undefined, storedOrder: unknown): number | undefined {
  if (answerIndex === undefined || answerIndex === null) return undefined;
  if (!Array.isArray(storedOrder)) return answerIndex;
  const original = storedOrder[answerIndex];
  // an out-of-range position is a wrong answer, never an accidental match
  return typeof original === 'number' ? original : -1;
}

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly fraud: FraudService,
    private readonly notifications: NotificationService,
    private readonly security: SecurityLogger,
    private readonly referrals: ReferralsService,
  ) {}

  /* ------------------------------- feed ------------------------------- */

  async feed(userId: string, query: { page?: number; limit?: number }) {
    const p = pageArgs(query);
    const limit = this.config.platform.dailyAdCompletionLimit;
    const [user, todayCompletions] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { trustScore: true } }),
      this.countTodayCompletions(userId),
    ]);
    const meta = {
      dailyLimit: limit,
      dailyCompleted: todayCompletions,
      dailyRemaining: Math.max(0, limit - todayCompletions),
      hiddenByFrequencyCap: 0,
    };

    if (todayCompletions >= limit || user.trustScore < this.config.fraud.minTrustScoreForFeed) {
      return paginated([], 0, p, meta);
    }

    const [idRows, countRow, uncappedRow] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`
        ${this.eligibleAdsSql(userId)} ORDER BY c.reward_per_action_etb DESC, a.created_at DESC LIMIT ${p.take} OFFSET ${p.skip}`,
      this.prisma.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*)::bigint AS count FROM (${this.eligibleAdsSql(userId)}) e`,
      this.prisma.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*)::bigint AS count FROM (${this.eligibleAdsSql(userId, { applyFrequencyCaps: false })}) e`,
    ]);
    const total = Number(countRow[0]?.count ?? 0);
    meta.hiddenByFrequencyCap = Math.max(0, Number(uncappedRow[0]?.count ?? 0) - total);
    const ids = idRows.map((r) => r.id);
    const ads = ids.length
      ? await this.prisma.ad.findMany({ where: { id: { in: ids } }, include: adInclude })
      : [];
    const byId = new Map(ads.map((a) => [a.id, a]));
    const data = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((ad) => this.toFeedItem(ad!));
    return paginated(data, total, p, meta);
  }

  async getAd(userId: string, adId: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId }, include: adInclude });
    if (!ad || ad.reviewStatus !== 'approved' || ad.campaign.status !== 'active') {
      throw AppException.notFound('Ad not available', { code: ErrorCode.AD_NOT_AVAILABLE });
    }
    const completed = await this.prisma.adCompletion.findFirst({
      where: { userId, adId, status: { in: CAP_STATUSES } },
      select: { id: true },
    });
    return {
      ...this.toFeedItem(ad),
      description: ad.description,
      minWatchSeconds: minWatchSeconds(ad.durationSeconds, this.config.platform.minWatchRatio),
      heartbeatIntervalSeconds: this.config.platform.heartbeatIntervalSeconds,
      alreadyCompleted: Boolean(completed),
    };
  }

  /* --------------------------- watch sessions --------------------------- */

  async startWatchSession(
    userId: string,
    adId: string,
    input: { deviceFingerprint: string; deviceId?: string },
    meta: { ip: string; userAgent?: string },
  ) {
    const now = new Date();
    const cfg = this.config.platform;
    const eligible = await this.prisma.$queryRaw<
      Array<{ id: string }>
    >`${this.eligibleAdsSql(userId)} AND a.id = ${adId}::uuid`;
    if (eligible.length === 0) {
      throw AppException.badRequest(ErrorCode.AD_NOT_AVAILABLE, 'This ad is not available to you right now');
    }
    const todayCompletions = await this.countTodayCompletions(userId);
    if (todayCompletions >= cfg.dailyAdCompletionLimit) {
      throw AppException.badRequest(
        ErrorCode.DAILY_LIMIT_REACHED,
        'Daily ad limit reached; come back tomorrow',
        {
          dailyLimit: cfg.dailyAdCompletionLimit,
        },
      );
    }
    const attemptsToday = await this.prisma.adWatchSession.count({
      where: { userId, adId, startedAt: { gte: startOfUtcDay(now) } },
    });
    if (attemptsToday >= cfg.maxWatchAttemptsPerAdPerDay) {
      throw AppException.badRequest(ErrorCode.TOO_MANY_WATCH_ATTEMPTS, 'Too many attempts for this ad today');
    }

    const ad = await this.prisma.ad.findUniqueOrThrow({
      where: { id: adId },
      include: { ...adInclude, attentionQuestions: true },
    });
    const askQuestion = ad.campaign.attentionCheckEnabled && ad.attentionQuestions.length > 0;
    const question = askQuestion ? ad.attentionQuestions[randomInt(0, ad.attentionQuestions.length)] : null;
    // Pentest A3a: options are shown in a fresh random order per session so a wrong guess teaches nothing
    // about the next attempt; the order is stored and the answer index is mapped back on completion.
    const optionOrder = question ? shuffledOrder((question.options as string[]).length) : null;

    const session = await this.prisma.$transaction(async (tx) => {
      // one active session per user: abandon the others so a stale tab cannot be completed later
      await tx.adWatchSession.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'abandoned' },
      });
      return tx.adWatchSession.create({
        data: {
          userId,
          adId,
          startedAt: now,
          expectedDurationSeconds: ad.durationSeconds,
          expiresAt: addSeconds(now, cfg.watchSessionTtlMinutes * 60),
          deviceFingerprint: input.deviceFingerprint,
          deviceId: input.deviceId,
          ipAddress: meta.ip,
          userAgent: meta.userAgent?.slice(0, 300),
          attentionQuestionId: question?.id,
          attentionOptionOrder: optionOrder ?? undefined,
        },
      });
    });
    if (input.deviceId) {
      await this.prisma.user
        .update({ where: { id: userId }, data: { deviceId: input.deviceId } })
        .catch(() => undefined);
    }

    const rewardCoins = this.rewardCoins(ad.campaign.rewardPerActionEtb);
    return {
      sessionId: session.id,
      adId,
      startedAt: session.startedAt,
      serverTime: now,
      expectedDurationSeconds: ad.durationSeconds,
      minWatchSeconds: minWatchSeconds(ad.durationSeconds, cfg.minWatchRatio),
      heartbeatIntervalSeconds: cfg.heartbeatIntervalSeconds,
      expiresAt: session.expiresAt,
      rewardCoins,
      attentionQuestion: question
        ? {
            id: question.id,
            prompt: question.prompt,
            promptAm: question.promptAm,
            options: (optionOrder ?? []).map((originalIndex) => (question.options as string[])[originalIndex]),
          }
        : null,
    };
  }

  async heartbeat(userId: string, sessionId: string) {
    const now = new Date();
    const session = await this.prisma.adWatchSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId)
      throw AppException.notFound('Watch session not found', { code: ErrorCode.WATCH_SESSION_NOT_FOUND });
    if (session.status !== 'active') {
      throw AppException.badRequest(ErrorCode.WATCH_SESSION_NOT_ACTIVE, `Watch session is ${session.status}`);
    }
    if (now > session.expiresAt) {
      await this.prisma.adWatchSession.update({ where: { id: sessionId }, data: { status: 'expired' } });
      throw AppException.badRequest(ErrorCode.WATCH_SESSION_EXPIRED, 'Watch session expired');
    }
    // Only count heartbeats that respect at least half the interval, so spamming cannot inflate the count.
    const minGapMs = (this.config.platform.heartbeatIntervalSeconds * 1000) / 2;
    const counts = !session.lastHeartbeatAt || now.getTime() - session.lastHeartbeatAt.getTime() >= minGapMs;
    const updated = await this.prisma.adWatchSession.update({
      where: { id: sessionId },
      data: { lastHeartbeatAt: now, ...(counts ? { heartbeatCount: { increment: 1 } } : {}) },
      select: { heartbeatCount: true, startedAt: true },
    });
    return {
      ok: true,
      heartbeatCount: updated.heartbeatCount,
      elapsedSeconds: Math.floor((now.getTime() - updated.startedAt.getTime()) / 1000),
      serverTime: now,
    };
  }

  /* ----------------------------- completion ----------------------------- */

  async completeWatchSession(
    userId: string,
    sessionId: string,
    input: { attentionAnswerIndex?: number },
    meta: { ip: string },
  ): Promise<CompletionResultView> {
    const cfg = this.config.platform;
    const session = await this.loadSession(sessionId, userId);

    if (session.status !== 'active') {
      if (session.completion) return this.replayResult(session.completion, session.id, userId);
      throw AppException.badRequest(ErrorCode.WATCH_SESSION_NOT_ACTIVE, `Watch session is ${session.status}`);
    }

    const now = new Date();
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, trustScore: true, createdAt: true, status: true },
    });
    const todayCompletions = await this.countTodayCompletions(userId);

    const verification = verifyWatchSession(
      {
        now,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        adDurationSeconds: session.expectedDurationSeconds,
        heartbeatCount: session.heartbeatCount,
        lastHeartbeatAt: session.lastHeartbeatAt,
        attentionQuestion: session.attentionQuestion
          ? { correctIndex: session.attentionQuestion.correctIndex }
          : null,
        // A3a: the client answers with a position in the shuffled list; map it back to the original index
        attentionAnswerIndex: unshuffleAnswer(input.attentionAnswerIndex, session.attentionOptionOrder),
        todayCompletions,
      },
      {
        minWatchRatio: cfg.minWatchRatio,
        maxWatchRatio: cfg.maxWatchRatio,
        watchGraceSeconds: cfg.watchGraceSeconds,
        heartbeatIntervalSeconds: cfg.heartbeatIntervalSeconds,
        minHeartbeatRatio: cfg.minHeartbeatRatio,
        dailyLimit: cfg.dailyAdCompletionLimit,
      },
    );

    const campaign = session.ad.campaign;
    const rewardCoins = this.rewardCoins(campaign.rewardPerActionEtb);
    const baseData = {
      userId,
      adId: session.adId,
      campaignId: campaign.id,
      watchSessionId: session.id,
      startedAt: session.startedAt,
      completedAt: now,
      watchDurationSeconds: verification.watchDurationSeconds,
      deviceFingerprint: session.deviceFingerprint,
      ipAddress: meta.ip || session.ipAddress,
      attentionAnswerCorrect: verification.attentionAnswerCorrect,
    };

    // --- hard verification failure: record a rejected completion, no fraud scoring needed ---
    if (!verification.ok) {
      const code = verification.code!;
      const result = await this.runClaimed(session.id, userId, async (tx) => {
        await tx.adWatchSession.update({
          where: { id: session.id },
          data: { status: 'rejected', completedAt: now, rejectionCode: code },
        });
        const completion = await tx.adCompletion.create({
          data: {
            ...baseData,
            status: 'rejected',
            rejectionCode: code,
            fraudFlags: [],
            fraudScore: 0,
            coinRewardAmount: 0,
          },
        });
        if (code === ErrorCode.ATTENTION_CHECK_FAILED || code === ErrorCode.DAILY_LIMIT_REACHED) {
          await this.fraud.adjustTrustScore(tx, userId, -2, `completion_${code.toLowerCase()}`);
        }
        return this.toResult(completion, session.id, false);
      });
      this.security.warn('completion.rejected', {
        userId,
        sessionId,
        adId: session.adId,
        code,
        watchDurationSeconds: verification.watchDurationSeconds,
        ip: meta.ip,
      });
      return result;
    }

    // --- fraud scoring on a verified watch ---
    const signals = await this.fraud.collectCompletionSignals({
      user,
      adDurationSeconds: session.expectedDurationSeconds,
      watchDurationSeconds: verification.watchDurationSeconds,
      heartbeatCount: session.heartbeatCount,
      expectedHeartbeats: expectedHeartbeats(verification.minWatchSeconds, cfg.heartbeatIntervalSeconds),
      deviceFingerprint: session.deviceFingerprint,
      ipAddress: meta.ip || session.ipAddress,
      todayCompletions,
    });
    const evaluation = this.fraud.evaluate(signals);
    const flagIds = evaluation.hits.map((h) => h.ruleId);
    let referralOutcome: ReferralOutcome = null;

    const result = await this.runClaimed(session.id, userId, async (tx) => {
      // Serialise per user: lock the row so the daily cap and the (user, ad) uniqueness checks are race-free.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const [todayInTx, duplicate] = await Promise.all([
        tx.adCompletion.count({
          where: { userId, status: { in: CAP_STATUSES }, completedAt: { gte: startOfUtcDay(now) } },
        }),
        tx.adCompletion.findFirst({
          where: { userId, adId: session.adId, status: { in: CAP_STATUSES } },
          select: { id: true },
        }),
      ]);

      let status: CompletionStatus = evaluation.outcome;
      let reasonCode: ErrorCode | null = status === 'rejected' ? ErrorCode.FRAUD_REJECTED : null;
      if (todayInTx >= cfg.dailyAdCompletionLimit) {
        status = 'rejected';
        reasonCode = ErrorCode.DAILY_LIMIT_REACHED;
      } else if (duplicate) {
        status = 'rejected';
        reasonCode = ErrorCode.AD_ALREADY_COMPLETED;
      } else if (status !== 'rejected') {
        // frequency caps (campaign / advertiser per UTC day), re-checked under the user row lock
        const capHit = await this.frequencyCapHit(tx, {
          userId,
          campaignId: campaign.id,
          advertiserId: campaign.advertiserId,
          campaignCap: campaign.frequencyCapPerUserPerDay,
          now,
        });
        if (capHit) {
          status = 'rejected';
          reasonCode = ErrorCode.FREQUENCY_CAP_REACHED;
          this.security.info('frequency_cap.reached', { userId, campaignId: campaign.id, cap: capHit });
        }
      }

      let costEtb = new Prisma.Decimal(0);
      let rewardEtb = new Prisma.Decimal(0);
      if (status === 'valid') {
        const charge = await this.chargeCampaign(tx, campaign.id, campaign.costPerActionEtb);
        if (!charge.ok) {
          status = 'rejected';
          reasonCode = charge.reason;
        } else {
          costEtb = campaign.costPerActionEtb;
          rewardEtb = campaign.rewardPerActionEtb;
        }
      }

      await tx.adWatchSession.update({
        where: { id: session.id },
        data: {
          status: status === 'rejected' ? 'rejected' : 'completed',
          completedAt: now,
          rejectionCode: reasonCode,
        },
      });
      const completion = await tx.adCompletion.create({
        data: {
          ...baseData,
          status,
          rejectionCode: reasonCode,
          fraudFlags: flagIds,
          fraudScore: evaluation.score,
          coinRewardAmount: status === 'valid' ? rewardCoins : 0,
          rewardEtb,
          costEtb,
        },
      });

      let newBalance: number | null = null;
      if (status === 'valid') {
        const write = await this.ledger.applyEntry(
          {
            userId,
            amount: rewardCoins,
            sourceType: 'ad_view',
            sourceId: completion.id,
            idempotencyKey: `ad_completion:${session.id}`,
            description: `Reward for watching "${session.ad.title}"`,
          },
          tx,
        );
        newBalance = write.balanceAfter;
        // Referral bonuses ride on the referee's FIRST valid completion, in this same transaction.
        referralOutcome = await this.referrals.onValidCompletion(tx, {
          userId,
          completionId: completion.id,
          deviceFingerprint: session.deviceFingerprint,
          ipAddress: meta.ip || session.ipAddress,
          now,
        });
        if (referralOutcome?.status === 'paid' && referralOutcome.refereeBonus > 0) {
          newBalance += referralOutcome.refereeBonus;
        }
        if (evaluation.hits.length) {
          // low-score hits on a valid completion are still recorded (informational, no trust penalty)
          await this.fraud.persistHits(tx, userId, 'ad_completion', completion.id, evaluation.hits, {
            ...evaluation,
            trustScoreDelta: 0,
          });
        }
      } else if (
        evaluation.hits.length &&
        (evaluation.outcome === 'flagged' || evaluation.outcome === 'rejected')
      ) {
        await this.fraud.persistHits(tx, userId, 'ad_completion', completion.id, evaluation.hits, evaluation);
      }
      return { ...this.toResult(completion, session.id, false), newBalance };
    });

    await this.afterCompletion(userId, session.adId, session.ad.title, result, meta.ip, evaluation.score);
    if (!result.replayed) await this.referrals.notifyOutcome(referralOutcome, userId);
    return result;
  }

  /* ------------------------------ helpers ------------------------------ */

  /**
   * Atomically claims the active session (UPDATE ... WHERE status = 'active'); if another request already
   * claimed it, the stored result is replayed so a retry can never double-credit.
   */
  private async runClaimed(
    sessionId: string,
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<CompletionResultView>,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const claimed = await tx.adWatchSession.updateMany({
            where: { id: sessionId, status: 'active' },
            data: { status: 'active' },
          });
          if (claimed.count === 0) throw new SessionAlreadyClaimed();
          // Re-check under the row lock taken by updateMany (Postgres locks updated rows until commit).
          return work(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 },
      );
    } catch (err) {
      if (err instanceof SessionAlreadyClaimed) {
        const again = await this.prisma.adWatchSession.findUnique({
          where: { id: sessionId },
          include: { completion: true },
        });
        if (again?.completion) return this.replayResult(again.completion, sessionId, userId);
        throw AppException.badRequest(
          ErrorCode.WATCH_SESSION_NOT_ACTIVE,
          'Watch session is no longer active',
        );
      }
      throw err;
    }
  }

  /** F3: a replay carries the user's CURRENT cached balance (never null) so the client can render it directly. */
  private async replayResult(
    completion: Parameters<AdsService['toResult']>[0],
    sessionId: string,
    userId: string,
  ): Promise<CompletionResultView> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { coinBalance: true } });
    return { ...this.toResult(completion, sessionId, true), newBalance: user?.coinBalance ?? null };
  }

  /** Charges the campaign atomically; pauses it when the budget is exhausted. */
  private async chargeCampaign(
    tx: Prisma.TransactionClient,
    campaignId: string,
    cost: Prisma.Decimal,
  ): Promise<{ ok: true } | { ok: false; reason: ErrorCode }> {
    const rows = await tx.$queryRaw<Array<{ spent_etb: Prisma.Decimal; budget_etb: Prisma.Decimal }>>`
      UPDATE campaigns SET spent_etb = spent_etb + ${cost}, updated_at = NOW()
      WHERE id = ${campaignId}::uuid AND status = 'active' AND spent_etb + ${cost} <= budget_etb
      RETURNING spent_etb, budget_etb`;
    if (rows.length === 0) {
      const c = await tx.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
      return {
        ok: false,
        reason: c?.status === 'active' ? ErrorCode.CAMPAIGN_BUDGET_EXHAUSTED : ErrorCode.CAMPAIGN_NOT_ACTIVE,
      };
    }
    const { spent_etb, budget_etb } = rows[0];
    if (new Prisma.Decimal(budget_etb).minus(spent_etb).lessThan(cost)) {
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: 'paused', pausedReason: 'budget_exhausted' },
      });
      this.logger.log(`Campaign ${campaignId} paused: budget exhausted`);
    }
    return { ok: true };
  }

  private async afterCompletion(
    userId: string,
    adId: string,
    adTitle: string,
    result: CompletionResultView,
    ip: string,
    score: number,
  ) {
    if (result.status !== 'rejected') {
      await this.redis
        .incrWithTtl(`ads:daily:${userId}:${utcDayKey()}`, secondsUntilEndOfUtcDay())
        .catch(() => undefined);
    }
    await this.fraud.recordCompletionVelocity(ip, userId);

    if (result.status === 'valid') {
      await this.notifications.notify({
        userId,
        type: 'reward_confirmed',
        title: 'Reward confirmed',
        body: `You earned ${result.coinReward} coins for watching "${adTitle}".`,
        data: { completionId: result.completionId, adId, coins: result.coinReward },
      });
    } else if (result.status === 'flagged') {
      this.security.warn('completion.flagged', {
        userId,
        adId,
        completionId: result.completionId,
        score,
        flags: result.fraudFlags,
        ip,
      });
      await this.notifications.notify({
        userId,
        type: 'reward_flagged',
        title: 'Reward under review',
        body: 'This reward is being reviewed by our team and will be credited once confirmed.',
        data: { completionId: result.completionId, adId },
      });
    } else {
      this.security.warn('completion.rejected', {
        userId,
        adId,
        completionId: result.completionId,
        code: result.reasonCode,
        score,
        flags: result.fraudFlags,
        ip,
      });
    }
  }

  private async loadSession(sessionId: string, userId: string) {
    const session = await this.prisma.adWatchSession.findUnique({
      where: { id: sessionId },
      include: { ad: { include: { campaign: true } }, attentionQuestion: true, completion: true },
    });
    if (!session || session.userId !== userId) {
      throw AppException.notFound('Watch session not found', { code: ErrorCode.WATCH_SESSION_NOT_FOUND });
    }
    return session;
  }

  async countTodayCompletions(userId: string): Promise<number> {
    return this.prisma.adCompletion.count({
      where: { userId, status: { in: CAP_STATUSES }, completedAt: { gte: startOfUtcDay() } },
    });
  }

  rewardCoins(rewardPerActionEtb: Prisma.Decimal): number {
    return new Prisma.Decimal(rewardPerActionEtb).mul(this.config.platform.coinsPerEtb).round().toNumber();
  }

  private toResult(
    c: {
      id: string;
      status: CompletionStatus;
      coinRewardAmount: number;
      watchDurationSeconds: number;
      rejectionCode: string | null;
      fraudFlags: Prisma.JsonValue;
    },
    sessionId: string,
    replayed: boolean,
  ): CompletionResultView {
    return {
      completionId: c.id,
      sessionId,
      status: c.status,
      coinReward: c.coinRewardAmount,
      watchDurationSeconds: c.watchDurationSeconds,
      newBalance: null,
      reasonCode: (c.rejectionCode as ErrorCode | null) ?? null,
      fraudFlags: Array.isArray(c.fraudFlags) ? (c.fraudFlags as string[]) : [],
      replayed,
    };
  }

  private toFeedItem(ad: AdWithCampaign) {
    const rewardCoins = this.rewardCoins(ad.campaign.rewardPerActionEtb);
    const hasAttentionCheck = ad.campaign.attentionCheckEnabled && ad._count.attentionQuestions > 0;
    return {
      id: ad.id,
      campaignId: ad.campaignId,
      title: ad.title,
      advertiserName: ad.campaign.advertiser.businessName,
      mediaType: ad.mediaType,
      mediaUrl: ad.mediaUrl,
      thumbnailUrl: ad.thumbnailUrl,
      durationSeconds: ad.durationSeconds,
      rewardCoins,
      rewardEtb: ad.campaign.rewardPerActionEtb,
      estimatedSeconds: ad.durationSeconds + (hasAttentionCheck ? 10 : 0),
      hasAttentionCheck,
      targetActionType: ad.campaign.targetActionType,
    };
  }

  /**
   * Eligible = approved, media-ready ad of an active, in-flight, funded video campaign the user has not been
   * credited for, and (unless disabled) under both frequency caps for today: per-campaign
   * (`frequency_cap_per_user_per_day`) and per-advertiser (`ADVERTISER_IMPRESSION_CAP_PER_USER_PER_DAY` distinct ads).
   */
  private eligibleAdsSql(userId: string, options: { applyFrequencyCaps?: boolean } = {}) {
    const caps =
      options.applyFrequencyCaps === false
        ? Prisma.empty
        : Prisma.sql`
        AND (
          SELECT COUNT(*) FROM ad_completions cc
          WHERE cc.campaign_id = c.id AND cc.user_id = ${userId}::uuid
            AND cc.status IN ('valid', 'flagged') AND cc.completed_at >= ${startOfUtcDay()}
        ) < c.frequency_cap_per_user_per_day
        AND (
          SELECT COUNT(DISTINCT ac2.ad_id) FROM ad_completions ac2
          JOIN campaigns c2 ON c2.id = ac2.campaign_id
          WHERE c2.advertiser_id = c.advertiser_id AND ac2.user_id = ${userId}::uuid
            AND ac2.status IN ('valid', 'flagged') AND ac2.completed_at >= ${startOfUtcDay()}
        ) < ${this.config.platform.advertiserImpressionCapPerUserPerDay}`;
    return Prisma.sql`
      SELECT a.id, c.reward_per_action_etb, a.created_at FROM ads a
      JOIN campaigns c ON c.id = a.campaign_id
      WHERE a.review_status = 'approved'
        AND a.media_status IN ('ready', 'duration_corrected')
        AND c.status = 'active'
        AND c.target_action_type = 'video_view'
        AND (c.start_date IS NULL OR c.start_date <= CURRENT_DATE)
        AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
        AND c.spent_etb + c.cost_per_action_etb <= c.budget_etb
        AND NOT EXISTS (
          SELECT 1 FROM ad_completions ac
          WHERE ac.ad_id = a.id AND ac.user_id = ${userId}::uuid AND ac.status IN ('valid', 'flagged'))
        AND NOT EXISTS (
          SELECT 1 FROM ad_completions af
          WHERE af.ad_id = a.id AND af.user_id = ${userId}::uuid AND af.status = 'rejected'
            AND af.rejection_code = ${ErrorCode.ATTENTION_CHECK_FAILED} AND af.completed_at >= ${startOfUtcDay()})
        ${caps}`;
  }

  /**
   * Frequency-cap re-check inside the completion transaction (under the user row lock). Returns the cap that was
   * hit, or null. Counts exclude the completion being written.
   */
  async frequencyCapHit(
    tx: Prisma.TransactionClient,
    input: { userId: string; campaignId: string; advertiserId: string; campaignCap: number; now: Date },
  ): Promise<'campaign' | 'advertiser' | null> {
    const since = startOfUtcDay(input.now);
    const campaignToday = await tx.adCompletion.count({
      where: {
        userId: input.userId,
        campaignId: input.campaignId,
        status: { in: CAP_STATUSES },
        completedAt: { gte: since },
      },
    });
    if (campaignToday >= input.campaignCap) return 'campaign';
    const advertiserAds = await tx.adCompletion.findMany({
      where: {
        userId: input.userId,
        status: { in: CAP_STATUSES },
        completedAt: { gte: since },
        campaign: { advertiserId: input.advertiserId },
      },
      distinct: ['adId'],
      select: { adId: true },
    });
    if (advertiserAds.length >= this.config.platform.advertiserImpressionCapPerUserPerDay) return 'advertiser';
    return null;
  }
}
