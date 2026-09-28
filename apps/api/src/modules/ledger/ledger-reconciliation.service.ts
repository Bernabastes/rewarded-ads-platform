import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Queue } from 'bullmq';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_RECONCILIATION } from '../../infra/queue/queue.module';
import { AlertService } from '../alerts/alerts.service';
import { ledgerDriftAlert } from '../alerts/alert.rules';
import { AuditService } from '../audit/audit.service';

export interface LedgerDrift {
  userId: string;
  cachedBalance: number;
  ledgerSum: number;
  lastBalanceAfter: number | null;
}

/**
 * Recomputes every user's balance from the append-only ledger and compares it with the cached
 * users.coin_balance. Any drift means a bug or manual DB tampering: it is logged on the security channel,
 * a CRITICAL fraud flag is opened and the run is stored. The job never "fixes" the cache itself — repairs go
 * through the ledger write path (source_type = reconciliation) so the fix is itself an auditable ledger row.
 */
@Injectable()
export class LedgerReconciliationService {
  private readonly logger = new Logger(LedgerReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly security: SecurityLogger,
    private readonly audit: AuditService,
    private readonly alerts: AlertService,
  ) {}

  async findDrifts(): Promise<{ usersChecked: number; drifts: LedgerDrift[] }> {
    const [countRow] = await this.prisma.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT COUNT(*)::bigint AS count FROM users`;
    const drifts = await this.prisma.$queryRaw<
      Array<{
        user_id: string;
        cached_balance: number;
        ledger_sum: bigint | number;
        last_balance_after: number | null;
      }>
    >`
      SELECT u.id AS user_id,
             u.coin_balance AS cached_balance,
             COALESCE(l.ledger_sum, 0)::bigint AS ledger_sum,
             (SELECT balance_after FROM coin_ledger cl WHERE cl.user_id = u.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_balance_after
      FROM users u
      LEFT JOIN (SELECT user_id, SUM(amount) AS ledger_sum FROM coin_ledger GROUP BY user_id) l ON l.user_id = u.id
      WHERE u.coin_balance <> COALESCE(l.ledger_sum, 0)
    `;
    return {
      usersChecked: Number(countRow?.count ?? 0),
      drifts: drifts.map((d) => ({
        userId: d.user_id,
        cachedBalance: Number(d.cached_balance),
        ledgerSum: Number(d.ledger_sum),
        lastBalanceAfter: d.last_balance_after === null ? null : Number(d.last_balance_after),
      })),
    };
  }

  async run(trigger: 'schedule' | 'manual' = 'schedule') {
    const run = await this.prisma.ledgerReconciliationRun.create({ data: { status: 'running' } });
    try {
      const { usersChecked, drifts } = await this.findDrifts();
      for (const drift of drifts) await this.raiseDrift(drift, run.id);
      await this.prisma.ledgerReconciliationRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          usersChecked,
          driftCount: drifts.length,
          drifts: drifts as unknown as Prisma.InputJsonValue,
          status: drifts.length ? 'drift_detected' : 'ok',
        },
      });
      this.logger.log(
        `Ledger reconciliation (${trigger}): ${usersChecked} users checked, ${drifts.length} drift(s)`,
      );
      return { runId: run.id, usersChecked, driftCount: drifts.length, drifts };
    } catch (err) {
      await this.prisma.ledgerReconciliationRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), status: 'error', error: (err as Error).message },
      });
      throw err;
    }
  }

  private async raiseDrift(drift: LedgerDrift, runId: string) {
    this.security.error('ledger.drift_detected', { ...drift, runId });
    // Money-day alert (Telegram / webhook / log) - deduped per user within ALERT_DEDUPE_MINUTES.
    await this.alerts
      .raise(ledgerDriftAlert({ userId: drift.userId, cachedBalance: drift.cachedBalance, ledgerSum: drift.ledgerSum, runId }))
      .catch((err: Error) => this.logger.error(`Could not raise LEDGER_DRIFT alert: ${err.message}`));
    const open = await this.prisma.fraudFlag.findFirst({
      where: { userId: drift.userId, flagType: 'LEDGER_DRIFT', resolved: false },
      select: { id: true },
    });
    if (open) return;
    await this.prisma.fraudFlag.create({
      data: {
        userId: drift.userId,
        relatedEntityType: 'user',
        relatedEntityId: drift.userId,
        flagType: 'LEDGER_DRIFT',
        severity: 'critical',
        description: `Cached balance ${drift.cachedBalance} differs from ledger sum ${drift.ledgerSum}`,
        metadata: { ...drift, runId } as unknown as Prisma.InputJsonValue,
        trustScoreDelta: 0,
      },
    });
    await this.audit.record({
      actorType: 'system',
      action: 'ledger.drift_detected',
      targetType: 'user',
      targetId: drift.userId,
      after: drift,
      metadata: { runId },
    });
  }
}

@Processor(QUEUE_RECONCILIATION)
export class LedgerReconciliationProcessor extends WorkerHost {
  constructor(private readonly reconciliation: LedgerReconciliationService) {
    super();
  }

  async process(job: Job<{ trigger?: 'schedule' | 'manual' }>) {
    return this.reconciliation.run(job.data?.trigger ?? 'schedule');
  }
}

/** Registers the repeatable reconciliation job on boot (idempotent thanks to the fixed job id). */
@Injectable()
export class LedgerReconciliationScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(LedgerReconciliationScheduler.name);

  constructor(
    @InjectQueue(QUEUE_RECONCILIATION) private readonly queue: Queue,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.env.QUEUES_ENABLED || !this.config.env.RECONCILIATION_ENABLED || this.config.isTest)
      return;
    try {
      await this.queue.upsertJobScheduler(
        'ledger-reconciliation',
        { pattern: this.config.env.RECONCILIATION_CRON },
        { name: 'reconcile', data: { trigger: 'schedule' } },
      );
      this.logger.log(`Ledger reconciliation scheduled: "${this.config.env.RECONCILIATION_CRON}"`);
    } catch (err) {
      this.logger.warn(
        `Could not schedule ledger reconciliation (redis unavailable?): ${(err as Error).message}`,
      );
    }
  }
}
