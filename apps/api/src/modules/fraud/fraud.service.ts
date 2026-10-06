import { Injectable } from '@nestjs/common';
import { type FraudResolution, type FraudSeverity, Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { addDays, eachUtcDay, utcDayKey } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import {
  clampTrust,
  COMPLETION_RULES,
  type CompletionSignals,
  computeTrustScore,
  evaluateCompletion,
  type FraudEvaluation,
  type FraudRuleHit,
  type FraudThresholds,
} from './fraud.rules';

export interface CreateFlagInput {
  userId?: string | null;
  relatedEntityType: string;
  relatedEntityId?: string | null;
  flagType: string;
  severity: FraudSeverity;
  description: string;
  metadata?: Record<string, unknown>;
  trustScoreDelta?: number;
}

/**
 * Fraud engine: gathers signals (DB + Redis velocity counters), evaluates rules, persists flags,
 * applies trust-score deltas and emits security-channel events.
 */
@Injectable()
export class FraudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly security: SecurityLogger,
    private readonly audit: AuditService,
  ) {}

  get thresholds(): FraudThresholds {
    return {
      flagThreshold: this.config.fraud.flagThreshold,
      rejectThreshold: this.config.fraud.rejectThreshold,
      deviceSharedAccountsThreshold: this.config.fraud.deviceSharedAccountsThreshold,
      ipCompletionsPerHourThreshold: this.config.fraud.ipCompletionsPerHourThreshold,
      minAccountAgeHoursForFullTrust: this.config.fraud.minAccountAgeHoursForFullTrust,
      minHeartbeatRatio: this.config.platform.minHeartbeatRatio,
    };
  }

  listRules() {
    return COMPLETION_RULES.map((r) => ({
      id: r.id,
      description: r.description,
      severity: r.severity,
      scoreWeight: r.scoreWeight,
      trustScoreDelta: r.trustScoreDelta,
    }));
  }

  /** Collects the velocity/graph signals that need I/O; the pure evaluation happens in fraud.rules.ts. */
  async collectCompletionSignals(input: {
    user: { id: string; trustScore: number; createdAt: Date };
    adDurationSeconds: number;
    watchDurationSeconds: number;
    heartbeatCount: number;
    expectedHeartbeats: number;
    deviceFingerprint: string;
    ipAddress: string;
    todayCompletions: number;
  }): Promise<CompletionSignals> {
    const since30d = addDays(new Date(), -30);
    const since1h = new Date(Date.now() - 3600_000);
    const since7d = addDays(new Date(), -7);

    const [deviceUsers, ipLastHourDb, userLastHour, recentBad] = await Promise.all([
      this.prisma.adWatchSession.findMany({
        where: { deviceFingerprint: input.deviceFingerprint, startedAt: { gte: since30d } },
        distinct: ['userId'],
        select: { userId: true },
        take: 50,
      }),
      this.prisma.adCompletion.count({
        where: { ipAddress: input.ipAddress, completedAt: { gte: since1h } },
      }),
      this.prisma.adCompletion.count({ where: { userId: input.user.id, completedAt: { gte: since1h } } }),
      this.prisma.adCompletion.count({
        where: {
          userId: input.user.id,
          status: { in: ['flagged', 'rejected'] },
          completedAt: { gte: since7d },
        },
      }),
    ]);
    // Phase 5c (New-5 informational): the Redis velocity counter is one of the fraud signals. When Redis is down,
    // closed mode treats the IP velocity as EXCEEDED (the completion is flagged for review - IP_VELOCITY is a
    // medium-weight rule that never rejects on its own), open mode falls back to the DB count only. Both are logged.
    let ipRedis = 0;
    try {
      ipRedis = await this.redis.getNumber(`fraud:ip:${input.ipAddress}:${hourKey()}`);
    } catch (err) {
      const failClosed = this.config.redisFailClosed;
      this.security.error('auth.denylist_unavailable', {
        scope: 'fraud_ip_velocity',
        failMode: failClosed ? 'closed' : 'open',
        userId: input.user.id,
        error: (err as Error).message,
      });
      if (failClosed) ipRedis = this.thresholds.ipCompletionsPerHourThreshold;
    }
    const distinctUsers = new Set(deviceUsers.map((d) => d.userId));
    distinctUsers.add(input.user.id);

    return {
      userId: input.user.id,
      trustScore: input.user.trustScore,
      accountAgeHours: (Date.now() - input.user.createdAt.getTime()) / 3600_000,
      adDurationSeconds: input.adDurationSeconds,
      watchDurationSeconds: input.watchDurationSeconds,
      heartbeatCount: input.heartbeatCount,
      expectedHeartbeats: input.expectedHeartbeats,
      deviceFingerprint: input.deviceFingerprint,
      ipAddress: input.ipAddress,
      todayCompletions: input.todayCompletions,
      dailyLimit: this.config.platform.dailyAdCompletionLimit,
      distinctUsersOnDevice: distinctUsers.size,
      ipCompletionsLastHour: Math.max(ipLastHourDb, ipRedis),
      userCompletionsLastHour: userLastHour,
      recentBadCompletions: recentBad,
    };
  }

  evaluate(signals: CompletionSignals): FraudEvaluation {
    return evaluateCompletion(signals, this.thresholds);
  }

  /** Redis velocity counters (best effort; DB counts remain authoritative). */
  async recordCompletionVelocity(ipAddress: string, userId: string) {
    const key = hourKey();
    await Promise.all([
      this.redis.incrWithTtl(`fraud:ip:${ipAddress}:${key}`, 3700),
      this.redis.incrWithTtl(`fraud:user:${userId}:${key}`, 3700),
    ]).catch(() => undefined);
  }

  /** Persists flags for rule hits (inside the caller's transaction when provided). */
  async persistHits(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
    relatedEntityType: string,
    relatedEntityId: string,
    hits: FraudRuleHit[],
    evaluation: FraudEvaluation,
  ) {
    const created = [];
    for (const hit of hits) {
      created.push(
        await tx.fraudFlag.create({
          data: {
            userId,
            relatedEntityType,
            relatedEntityId,
            flagType: hit.ruleId,
            severity: hit.severity,
            description: hit.description,
            metadata: {
              ...(hit.detail ?? {}),
              score: evaluation.score,
              outcome: evaluation.outcome,
            } as Prisma.InputJsonValue,
            trustScoreDelta: hit.trustScoreDelta,
          },
        }),
      );
    }
    if (evaluation.trustScoreDelta !== 0)
      await this.adjustTrustScore(tx, userId, evaluation.trustScoreDelta, 'completion_rules');
    for (const flag of created) {
      this.security.warn('fraud.flag_created', {
        flagId: flag.id,
        userId,
        flagType: flag.flagType,
        severity: flag.severity,
        relatedEntityType,
        relatedEntityId,
        outcome: evaluation.outcome,
        score: evaluation.score,
      });
    }
    return created;
  }

  async adjustTrustScore(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
    delta: number,
    reason: string,
  ) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { trustScore: true } });
    if (!user) return;
    const next = clampTrust(user.trustScore + delta);
    if (next === user.trustScore) return;
    await tx.user.update({ where: { id: userId }, data: { trustScore: next } });
    this.security.info('fraud.trust_score_changed', {
      userId,
      from: user.trustScore,
      to: next,
      delta,
      reason,
    });
  }

  async createFlag(input: CreateFlagInput, actor?: { adminId?: string; ip?: string }) {
    const flag = await this.prisma.$transaction(async (tx) => {
      const created = await tx.fraudFlag.create({
        data: {
          userId: input.userId ?? null,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId ?? null,
          flagType: input.flagType,
          severity: input.severity,
          description: input.description,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          trustScoreDelta: input.trustScoreDelta ?? 0,
        },
      });
      if (input.userId && input.trustScoreDelta) {
        await this.adjustTrustScore(tx, input.userId, input.trustScoreDelta, `manual_flag:${input.flagType}`);
      }
      await this.audit.record(
        {
          actorType: actor?.adminId ? 'admin' : 'system',
          actorId: actor?.adminId,
          action: 'fraud.flag_created',
          targetType: 'fraud_flag',
          targetId: created.id,
          after: created,
          ipAddress: actor?.ip,
        },
        tx,
      );
      return created;
    });
    this.security.warn('fraud.flag_created', {
      flagId: flag.id,
      userId: flag.userId,
      flagType: flag.flagType,
      severity: flag.severity,
      manual: true,
      adminId: actor?.adminId,
    });
    return flag;
  }

  async resolveFlag(
    flagId: string,
    resolution: FraudResolution,
    note: string,
    admin: { adminId: string; ip?: string },
  ) {
    const flag = await this.prisma.fraudFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw AppException.notFound('Fraud flag not found');
    if (flag.resolved) throw AppException.conflict(ErrorCode.FLAG_ALREADY_RESOLVED, 'Flag already resolved');

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.fraudFlag.update({
        where: { id: flagId },
        data: {
          resolved: true,
          resolution,
          resolvedBy: admin.adminId,
          resolvedAt: new Date(),
          resolutionNote: note,
        },
      });
      // Dismissal reverses the trust penalty this flag applied.
      if (resolution === 'dismissed' && flag.userId && flag.trustScoreDelta !== 0) {
        await this.adjustTrustScore(
          tx,
          flag.userId,
          -flag.trustScoreDelta,
          `flag_dismissed:${flag.flagType}`,
        );
      }
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: admin.adminId,
          action: `fraud.flag_${resolution}`,
          targetType: 'fraud_flag',
          targetId: flagId,
          before: flag,
          after: u,
          ipAddress: admin.ip,
        },
        tx,
      );
      return u;
    });
    this.security.info('fraud.flag_resolved', {
      flagId,
      resolution,
      adminId: admin.adminId,
      userId: flag.userId,
    });
    return updated;
  }

  async recomputeTrustScore(userId: string, actor?: { adminId?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { trustScore: true, status: true },
    });
    if (!user) throw AppException.notFound('User not found');
    const [validCompletions, completedWithdrawals, flags] = await Promise.all([
      this.prisma.adCompletion.count({ where: { userId, status: 'valid' } }),
      this.prisma.withdrawal.count({ where: { userId, status: 'completed' } }),
      this.prisma.fraudFlag.groupBy({
        by: ['severity'],
        where: { userId, OR: [{ resolved: false }, { resolution: { in: ['escalated', 'confirmed'] } }] },
        _count: { _all: true },
      }),
    ]);
    const openFlagsBySeverity: Partial<Record<FraudSeverity, number>> = {};
    for (const f of flags) openFlagsBySeverity[f.severity] = f._count._all;
    const next = computeTrustScore({
      validCompletions,
      completedWithdrawals,
      openFlagsBySeverity,
      status: user.status,
    });
    if (next !== user.trustScore) {
      await this.prisma.user.update({ where: { id: userId }, data: { trustScore: next } });
      this.security.info('fraud.trust_score_changed', {
        userId,
        from: user.trustScore,
        to: next,
        delta: next - user.trustScore,
        reason: 'recompute',
        adminId: actor?.adminId,
      });
    }
    return {
      userId,
      trustScore: next,
      inputs: { validCompletions, completedWithdrawals, openFlagsBySeverity },
    };
  }

  async listFlags(query: {
    page?: number;
    limit?: number;
    severity?: FraudSeverity;
    resolved?: boolean;
    userId?: string;
    flagType?: string;
    relatedEntityType?: string;
  }) {
    const p = pageArgs(query);
    const where: Prisma.FraudFlagWhereInput = {
      severity: query.severity,
      resolved: query.resolved,
      userId: query.userId,
      flagType: query.flagType,
      relatedEntityType: query.relatedEntityType,
    };
    const [rows, total] = await Promise.all([
      this.prisma.fraudFlag.findMany({
        where,
        orderBy: [{ resolved: 'asc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: { user: { select: { phoneNumber: true } } },
      }),
      this.prisma.fraudFlag.count({ where }),
    ]);
    return paginated(
      rows.map(({ user, ...f }) => ({ ...f, userPhone: user?.phoneNumber ?? null })),
      total,
      p,
    );
  }

  async getFlag(id: string) {
    const flag = await this.prisma.fraudFlag.findUnique({
      where: { id },
      include: { user: { select: { phoneNumber: true } } },
    });
    if (!flag) throw AppException.notFound('Fraud flag not found');
    const { user, ...rest } = flag;
    return { ...rest, userPhone: user?.phoneNumber ?? null };
  }

  async metrics() {
    const now = new Date();
    const since7d = addDays(now, -7);
    const [raw, flagged, rejected, openBySeverity, byType, suspended, banned, lowTrust, drifts, dailyRows] =
      await Promise.all([
        this.prisma.adCompletion.count({ where: { completedAt: { gte: since7d } } }),
        this.prisma.adCompletion.count({ where: { completedAt: { gte: since7d }, status: 'flagged' } }),
        this.prisma.adCompletion.count({ where: { completedAt: { gte: since7d }, status: 'rejected' } }),
        this.prisma.fraudFlag.groupBy({
          by: ['severity'],
          where: { resolved: false },
          _count: { _all: true },
        }),
        this.prisma.fraudFlag.groupBy({
          by: ['flagType'],
          where: { createdAt: { gte: since7d } },
          _count: { _all: true },
          orderBy: { _count: { flagType: 'desc' } },
          take: 10,
        }),
        this.prisma.user.count({ where: { status: 'suspended' } }),
        this.prisma.user.count({ where: { status: 'banned' } }),
        this.prisma.user.count({ where: { trustScore: { lt: 30 }, status: 'active' } }),
        this.prisma.fraudFlag.count({ where: { flagType: 'LEDGER_DRIFT', resolved: false } }),
        this.prisma.$queryRaw<Array<{ day: Date; status: string; count: bigint }>>`
        SELECT date_trunc('day', completed_at AT TIME ZONE 'UTC') AS day, status::text AS status, COUNT(*)::bigint AS count
        FROM ad_completions WHERE completed_at >= ${since7d}
        GROUP BY 1, 2 ORDER BY 1`,
      ]);
    const openFlagsBySeverity: Record<FraudSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const row of openBySeverity) openFlagsBySeverity[row.severity] = row._count._all;

    const dailyMap = new Map<
      string,
      { rawCompletions: number; flaggedCompletions: number; rejectedCompletions: number }
    >();
    for (const day of eachUtcDay(since7d, now))
      dailyMap.set(day, { rawCompletions: 0, flaggedCompletions: 0, rejectedCompletions: 0 });
    for (const row of dailyRows) {
      const key = utcDayKey(new Date(row.day));
      const bucket = dailyMap.get(key) ?? {
        rawCompletions: 0,
        flaggedCompletions: 0,
        rejectedCompletions: 0,
      };
      const n = Number(row.count);
      bucket.rawCompletions += n;
      if (row.status === 'flagged') bucket.flaggedCompletions += n;
      if (row.status === 'rejected') bucket.rejectedCompletions += n;
      dailyMap.set(key, bucket);
    }

    return {
      weekly: {
        rawCompletions: raw,
        flaggedCompletions: flagged,
        rejectedCompletions: rejected,
        flaggedRate: raw ? Math.round(((flagged + rejected) / raw) * 10000) / 10000 : 0,
      },
      openFlagsBySeverity,
      flagsByType: byType.map((t) => ({ flagType: t.flagType, count: t._count._all })),
      suspendedUsers: suspended,
      bannedUsers: banned,
      lowTrustUsers: lowTrust,
      ledgerDriftsDetected: drifts,
      daily: [...dailyMap.entries()].map(([date, v]) => ({ date, ...v })),
    };
  }
}

function hourKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 13);
}
