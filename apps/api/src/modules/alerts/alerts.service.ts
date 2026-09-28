import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type AlertSeverity, Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { type Job, Queue } from 'bullmq';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { parseDateRange } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_ALERTS } from '../../infra/queue/queue.module';
import { AuditService } from '../audit/audit.service';
import {
  evaluateAccountMinting,
  evaluateOtpSpike,
  evaluatePayoutFailureRate,
  evaluateSpendVelocity,
  type RuleAlert,
} from './alert.rules';
import { ALERT_NOTIFIERS, type Notifier } from './notifiers';

/**
 * Money-day alerting (Feature 5). `raise()` persists a platform_alerts row (deduped per key within
 * ALERT_DEDUPE_MINUTES), mirrors it on the security log channel and fans it out to every configured Notifier
 * (Telegram / Slack-compatible webhook / log). `runRules()` evaluates the scheduled rules; ledger drift is raised
 * directly by the reconciliation job.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly security: SecurityLogger,
    private readonly audit: AuditService,
    @Inject(ALERT_NOTIFIERS) private readonly notifiers: Notifier[],
  ) {}

  describeNotifiers() {
    return this.notifiers.map((n) => ({ name: n.name, mock: n.isMock }));
  }

  /** Persist + deliver. Returns null when suppressed by dedupe. */
  async raise(alert: RuleAlert, now = new Date()) {
    if (alert.dedupeKey) {
      const since = new Date(now.getTime() - this.config.alerts.dedupeMinutes * 60_000);
      const recent = await this.prisma.platformAlert.findFirst({
        where: { dedupeKey: alert.dedupeKey, createdAt: { gte: since } },
        select: { id: true },
      });
      if (recent) return null;
    }
    const row = await this.prisma.platformAlert.create({
      data: {
        type: alert.type,
        severity: alert.severity,
        title: alert.title,
        payload: alert.payload as Prisma.InputJsonValue,
        dedupeKey: alert.dedupeKey,
      },
    });
    const logFn = alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warn' : 'info';
    this.security[logFn]('alert.raised', {
      alertId: row.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      ...alert.payload,
    });
    const deliveries = await Promise.all(
      this.notifiers.map((n) =>
        n.send({ ...row, payload: alert.payload, createdAt: row.createdAt }).catch((err: Error) => ({
          notifier: n.name,
          ok: false,
          error: err.message,
        })),
      ),
    );
    for (const d of deliveries) {
      if (!d.ok) this.security.warn('alert.delivery_failed', { alertId: row.id, notifier: d.notifier, error: d.error });
    }
    return this.prisma.platformAlert.update({
      where: { id: row.id },
      data: { deliveries: deliveries as unknown as Prisma.InputJsonValue },
    });
  }

  /* ------------------------------ scheduled rules ------------------------------ */

  async runRules(now = new Date()) {
    const a = this.config.alerts;
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const results: Array<{ rule: string; raised: number; checked: number }> = [];

    // 1. payout failure rate (last hour)
    const [completed, failed] = await Promise.all([
      this.prisma.withdrawal.count({ where: { status: 'completed', processedAt: { gte: hourAgo } } }),
      this.prisma.withdrawal.count({ where: { status: 'failed', processedAt: { gte: hourAgo } } }),
    ]);
    const payoutAlert = evaluatePayoutFailureRate(
      { completed, failed },
      { threshold: a.payoutFailureRate, minSample: a.payoutMinSample },
    );
    results.push({ rule: 'payout_failure_rate', checked: completed + failed, raised: await this.raiseAll(payoutAlert ? [payoutAlert] : [], now) });

    // 2. account minting per signup device fingerprint (last hour)
    const minted = await this.prisma.$queryRaw<Array<{ fingerprint: string; accounts: bigint }>>`
      SELECT signup_device_fingerprint AS fingerprint, COUNT(*)::bigint AS accounts
      FROM users
      WHERE signup_device_fingerprint IS NOT NULL AND created_at >= ${hourAgo}
      GROUP BY signup_device_fingerprint
      HAVING COUNT(*) > ${a.accountsPerDevicePerHour}`;
    const mintingAlerts = evaluateAccountMinting(
      minted.map((m) => ({ fingerprint: m.fingerprint, accounts: Number(m.accounts) })),
      { accountsPerDevicePerHour: a.accountsPerDevicePerHour },
    );
    results.push({ rule: 'account_minting', checked: minted.length, raised: await this.raiseAll(mintingAlerts, now) });

    // 3. campaign spend velocity
    const spend = await this.prisma.$queryRaw<
      Array<{ campaign_id: string; title: string; advertiser_name: string; last_hour: Prisma.Decimal; trailing: Prisma.Decimal }>
    >`
      SELECT c.id AS campaign_id, c.title, adv.business_name AS advertiser_name,
             COALESCE(SUM(CASE WHEN ac.completed_at >= ${hourAgo} THEN ac.cost_etb ELSE 0 END), 0) AS last_hour,
             COALESCE(SUM(CASE WHEN ac.completed_at < ${hourAgo} THEN ac.cost_etb ELSE 0 END), 0) AS trailing
      FROM campaigns c
      JOIN advertisers adv ON adv.id = c.advertiser_id
      JOIN ad_completions ac ON ac.campaign_id = c.id AND ac.status = 'valid' AND ac.completed_at >= ${weekAgo}
      GROUP BY c.id, c.title, adv.business_name
      HAVING SUM(CASE WHEN ac.completed_at >= ${hourAgo} THEN ac.cost_etb ELSE 0 END) >= ${a.spendVelocityMinEtb}`;
    const spendAlerts = evaluateSpendVelocity(
      spend.map((s) => ({
        campaignId: s.campaign_id,
        title: s.title,
        advertiserName: s.advertiser_name,
        lastHourEtb: Number(s.last_hour),
        trailing7dEtb: Number(s.trailing),
      })),
      { multiplier: a.spendVelocityMultiplier, minEtb: a.spendVelocityMinEtb },
    );
    results.push({ rule: 'spend_velocity', checked: spend.length, raised: await this.raiseAll(spendAlerts, now) });

    // 4. OTP request spike per IP (last hour)
    const otp = await this.prisma.otpCode.groupBy({
      by: ['ipAddress'],
      where: { createdAt: { gte: hourAgo }, ipAddress: { not: null } },
      _count: { _all: true },
      having: { ipAddress: { _count: { gt: a.otpRequestsPerIpPerHour } } },
    });
    const otpAlerts = evaluateOtpSpike(
      otp.map((o) => ({ ip: o.ipAddress ?? 'unknown', requests: o._count._all })),
      { requestsPerIpPerHour: a.otpRequestsPerIpPerHour },
    );
    results.push({ rule: 'otp_spike', checked: otp.length, raised: await this.raiseAll(otpAlerts, now) });

    this.logger.log(`Alert rules evaluated: ${results.map((r) => `${r.rule}=${r.raised}`).join(' ')}`);
    return { ranAt: now, rules: results };
  }

  private async raiseAll(alerts: RuleAlert[], now: Date): Promise<number> {
    let raised = 0;
    for (const alert of alerts) if (await this.raise(alert, now)) raised++;
    return raised;
  }

  /* ------------------------------ admin API ------------------------------ */

  async list(query: {
    page?: number;
    limit?: number;
    type?: string;
    severity?: AlertSeverity;
    acknowledged?: boolean;
    from?: string;
    to?: string;
  }) {
    const p = pageArgs(query);
    const range = query.from || query.to ? parseDateRange(query.from, query.to, 30) : null;
    const where: Prisma.PlatformAlertWhereInput = {
      type: query.type,
      severity: query.severity,
      acknowledgedAt: query.acknowledged === undefined ? undefined : query.acknowledged ? { not: null } : null,
      ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}),
    };
    const [rows, total, open] = await Promise.all([
      this.prisma.platformAlert.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
      this.prisma.platformAlert.count({ where }),
      this.prisma.platformAlert.count({ where: { acknowledgedAt: null } }),
    ]);
    return paginated(rows, total, p, { openCount: open, notifiers: this.describeNotifiers() });
  }

  async acknowledge(id: string, actor: { adminId: string; ip?: string }) {
    const alert = await this.prisma.platformAlert.findUnique({ where: { id } });
    if (!alert) throw AppException.notFound('Alert not found');
    if (alert.acknowledgedAt) {
      throw AppException.conflict(ErrorCode.ALERT_ALREADY_ACKNOWLEDGED, 'Alert already acknowledged');
    }
    const updated = await this.prisma.platformAlert.update({
      where: { id },
      data: { acknowledgedBy: actor.adminId, acknowledgedAt: new Date() },
    });
    await this.audit.record({
      actorType: 'admin',
      actorId: actor.adminId,
      action: 'alert.acknowledged',
      targetType: 'platform_alert',
      targetId: id,
      before: { acknowledgedAt: null },
      after: { acknowledgedAt: updated.acknowledgedAt },
      ipAddress: actor.ip,
    });
    this.security.info('alert.acknowledged', { alertId: id, adminId: actor.adminId, type: alert.type });
    return updated;
  }
}

@Processor(QUEUE_ALERTS)
export class AlertRulesProcessor extends WorkerHost {
  constructor(private readonly alerts: AlertService) {
    super();
  }

  async process(_job: Job) {
    return this.alerts.runRules();
  }
}

@Injectable()
export class AlertRulesScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AlertRulesScheduler.name);

  constructor(
    @InjectQueue(QUEUE_ALERTS) private readonly queue: Queue,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.env.QUEUES_ENABLED || !this.config.alerts.enabled || this.config.isTest) return;
    try {
      await this.queue.upsertJobScheduler(
        'alert-rules',
        { pattern: this.config.alerts.cron },
        { name: 'run-rules', data: { trigger: 'schedule' } },
      );
      this.logger.log(`Alert rules scheduled: "${this.config.alerts.cron}"`);
    } catch (err) {
      this.logger.warn(`Could not schedule alert rules (redis unavailable?): ${(err as Error).message}`);
    }
  }
}
