import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type DeletionRequestStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { type Job, Queue } from 'bullmq';
import { gzipSync } from 'node:zlib';
import { AppException } from '../../common/errors/app.exception';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { pageArgs, paginated } from '../../common/pagination';
import { addDays, sha256 } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_DATA_RIGHTS } from '../../infra/queue/queue.module';
import { PRIVATE_PREFIX, StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import { NotificationService } from '../notifications/notifications.module';
import { serializeValue } from '../../common/interceptors/serialize.interceptor';

const IN_FLIGHT_WITHDRAWALS = ['pending', 'processing', 'flagged_for_review'] as const;

/**
 * Data-subject rights (Feature 10b):
 *  - Export: async job builds a gzipped JSON archive of everything we hold about the user, stores it under the
 *    private prefix and notifies with a presigned link (DATA_EXPORT_URL_TTL_SECONDS; archive kept
 *    DATA_EXPORT_RETENTION_DAYS).
 *  - Deletion: request -> grace period (ACCOUNT_DELETION_GRACE_DAYS, cancellable) -> execute. Execution ANONYMISES
 *    PII (phone, name, DOB, device ids, IPs, push tokens, notifications, consents, KYC documents) but KEEPS the
 *    coin ledger, completions, withdrawals and audit rows: they are financial records the platform must retain
 *    (advertiser billing evidence, payout reconciliation, fraud investigations) and they no longer identify a person
 *    once the user row is anonymised. Blocked while withdrawals are in flight (money would be orphaned).
 */
@Injectable()
export class DataRightsService {
  private readonly logger = new Logger(DataRightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    private readonly notifications: NotificationService,
    private readonly tokens: TokenService,
    private readonly idempotency: IdempotencyInterceptor,
    @InjectQueue(QUEUE_DATA_RIGHTS) private readonly queue: Queue,
  ) {}

  /* ------------------------------ data export ------------------------------ */

  async requestExport(userId: string, ip: string) {
    const inProgress = await this.prisma.dataExportRequest.findFirst({
      where: { userId, status: { in: ['pending', 'processing'] } },
    });
    if (inProgress) {
      throw AppException.conflict(ErrorCode.DATA_EXPORT_IN_PROGRESS, 'An export is already being prepared', {
        exportId: inProgress.id,
      });
    }
    const req = await this.prisma.dataExportRequest.create({ data: { userId } });
    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      action: 'data_export.requested',
      targetType: 'data_export_request',
      targetId: req.id,
      ipAddress: ip,
    });
    this.security.info('data_rights.export_requested', { userId, exportId: req.id, ip });
    if (this.config.env.QUEUES_ENABLED && !this.config.isTest) {
      await this.queue
        .add('export', { exportId: req.id }, { jobId: `export-${req.id}` })
        .catch((err: Error) => this.logger.error(`Could not enqueue export ${req.id}: ${err.message}`));
    }
    return this.toExportItem(req);
  }

  async getExport(userId: string, id: string) {
    const req = await this.prisma.dataExportRequest.findFirst({ where: { id, userId } });
    if (!req) throw AppException.notFound('Export not found');
    return this.toExportItem(req);
  }

  async listExports(userId: string) {
    const rows = await this.prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take: 10,
    });
    return { data: await Promise.all(rows.map((r) => this.toExportItem(r))) };
  }

  /** Worker: build the archive. */
  async buildExport(exportId: string) {
    const req = await this.prisma.dataExportRequest.findUnique({ where: { id: exportId } });
    if (!req || req.status === 'ready') return;
    await this.prisma.dataExportRequest.update({ where: { id: exportId }, data: { status: 'processing' } });
    try {
      const data = await this.collectUserData(req.userId);
      const body = gzipSync(Buffer.from(JSON.stringify(serializeValue(data), null, 2)));
      const key = `${PRIVATE_PREFIX}/exports/${req.userId}/${exportId}.json.gz`;
      await this.storage.upload(key, body, 'application/gzip');
      const expiresAt = addDays(new Date(), this.config.env.DATA_EXPORT_RETENTION_DAYS);
      await this.prisma.dataExportRequest.update({
        where: { id: exportId },
        data: { status: 'ready', storageKey: key, sizeBytes: body.length, completedAt: new Date(), expiresAt },
      });
      this.security.info('data_rights.export_ready', { userId: req.userId, exportId, sizeBytes: body.length });
      await this.notifications.notify({
        userId: req.userId,
        type: 'data_export',
        title: 'Your data export is ready',
        body: `Open the app to download your data (available for ${this.config.env.DATA_EXPORT_RETENTION_DAYS} days).`,
        data: { exportId },
      });
    } catch (err) {
      await this.prisma.dataExportRequest.update({
        where: { id: exportId },
        data: { status: 'failed', error: (err as Error).message.slice(0, 500), completedAt: new Date() },
      });
      throw err;
    }
  }

  /** Everything we hold about a user, grouped by table (PII + financial history). */
  async collectUserData(userId: string) {
    const [user, ledger, completions, withdrawals, sessions, notifications, consents, kyc, referrals, reports, offers] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
        this.prisma.coinLedger.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        this.prisma.adCompletion.findMany({ where: { userId }, orderBy: { completedAt: 'asc' } }),
        this.prisma.withdrawal.findMany({ where: { userId }, orderBy: { requestedAt: 'asc' } }),
        this.prisma.adWatchSession.findMany({ where: { userId }, orderBy: { startedAt: 'asc' }, take: 5000 }),
        this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        this.prisma.userConsent.findMany({ where: { userId } }),
        this.prisma.kycSubmission.findMany({
          where: { userId },
          select: { id: true, idType: true, idNumberLast4: true, fullName: true, dateOfBirth: true, status: true, reason: true, createdAt: true, reviewedAt: true },
        }),
        this.prisma.referral.findMany({ where: { OR: [{ referrerId: userId }, { refereeId: userId }] } }),
        this.prisma.adReport.findMany({ where: { userId } }),
        this.prisma.surveyResponse.findMany({ where: { userId } }),
      ]);
    const { passwordHash: _pw, ...profile } = user;
    return {
      exportedAt: new Date(),
      profile,
      coinLedger: ledger,
      adCompletions: completions,
      withdrawals: withdrawals.map((w) => ({ ...w, providerStatusRaw: undefined })),
      watchSessions: sessions,
      notifications,
      consents,
      kycSubmissions: kyc,
      referrals,
      adReports: reports,
      surveyResponses: offers,
    };
  }

  private async toExportItem(r: {
    id: string;
    status: string;
    requestedAt: Date;
    completedAt: Date | null;
    expiresAt: Date | null;
    sizeBytes: number | null;
    storageKey: string | null;
    error: string | null;
  }) {
    const ttl = this.config.env.DATA_EXPORT_URL_TTL_SECONDS;
    const ready = r.status === 'ready' && r.storageKey && (!r.expiresAt || r.expiresAt > new Date());
    const link = ready ? await this.storage.presignDownload(r.storageKey!, ttl) : null;
    return {
      id: r.id,
      status: r.status,
      requestedAt: r.requestedAt,
      completedAt: r.completedAt,
      expiresAt: r.expiresAt,
      sizeBytes: r.sizeBytes,
      downloadUrl: link?.url ?? null,
      downloadExpiresInSeconds: link ? ttl : null,
      error: r.error,
    };
  }

  /* ------------------------------ deletion requests ------------------------------ */

  async requestDeletion(userId: string, reason: string | undefined, ip: string) {
    const [pending, inFlight] = await Promise.all([
      this.prisma.accountDeletionRequest.findFirst({ where: { userId, status: 'pending' } }),
      this.prisma.withdrawal.count({ where: { userId, status: { in: [...IN_FLIGHT_WITHDRAWALS] } } }),
    ]);
    if (pending) {
      throw AppException.conflict(ErrorCode.DELETION_REQUEST_PENDING, 'A deletion request is already pending', {
        requestId: pending.id,
        scheduledFor: pending.scheduledFor,
      });
    }
    if (inFlight > 0) {
      throw AppException.conflict(
        ErrorCode.DELETION_BLOCKED_PENDING_WITHDRAWALS,
        'Wait for your pending withdrawals to finish before requesting deletion',
        { pendingWithdrawals: inFlight },
      );
    }
    const graceDays = this.config.platform.accountDeletionGraceDays;
    const req = await this.prisma.accountDeletionRequest.create({
      data: { userId, reason, scheduledFor: addDays(new Date(), graceDays), ipAddress: ip },
    });
    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      action: 'account_deletion.requested',
      targetType: 'account_deletion_request',
      targetId: req.id,
      after: { scheduledFor: req.scheduledFor, reason },
      ipAddress: ip,
    });
    this.security.info('data_rights.deletion_requested', { userId, requestId: req.id, scheduledFor: req.scheduledFor });
    await this.notifications.notify({
      userId,
      type: 'account_deletion',
      title: 'Account deletion scheduled',
      body: `Your account will be deleted on ${req.scheduledFor.toISOString().slice(0, 10)}. Sign in before then and cancel if you change your mind.`,
      data: { requestId: req.id, scheduledFor: req.scheduledFor },
    });
    return this.toDeletionItem(req);
  }

  async myDeletionRequest(userId: string) {
    const req = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
    return req ? this.toDeletionItem(req) : null;
  }

  async cancelOwnDeletion(userId: string, ip: string) {
    const req = await this.prisma.accountDeletionRequest.findFirst({ where: { userId, status: 'pending' } });
    if (!req) throw AppException.notFound('No pending deletion request');
    return this.cancel(req.id, { actorType: 'user', actorId: userId, ip });
  }

  async cancel(id: string, actor: { actorType: 'user' | 'admin'; actorId: string; ip?: string; note?: string }) {
    const req = await this.prisma.accountDeletionRequest.findUnique({ where: { id } });
    if (!req) throw AppException.notFound('Deletion request not found');
    if (req.status !== 'pending') {
      throw AppException.conflict(ErrorCode.DELETION_REQUEST_NOT_PENDING, `Request is already ${req.status}`);
    }
    const updated = await this.prisma.accountDeletionRequest.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: actor.actorType === 'admin' ? actor.actorId : null,
        note: actor.note,
      },
    });
    await this.audit.record({
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'account_deletion.cancelled',
      targetType: 'account_deletion_request',
      targetId: id,
      before: { status: 'pending' },
      after: { status: 'cancelled', note: actor.note },
      ipAddress: actor.ip,
    });
    this.security.info('data_rights.deletion_cancelled', { userId: req.userId, requestId: id, by: actor.actorType });
    return this.toDeletionItem(updated);
  }

  /** Execute now (admin) or when due (job). Anonymises PII; keeps financial/audit records. */
  async execute(id: string, actor: { actorType: 'admin' | 'system'; actorId?: string; ip?: string; note?: string }) {
    const req = await this.prisma.accountDeletionRequest.findUnique({ where: { id }, include: { user: true } });
    if (!req) throw AppException.notFound('Deletion request not found');
    if (req.status !== 'pending') {
      throw AppException.conflict(ErrorCode.DELETION_REQUEST_NOT_PENDING, `Request is already ${req.status}`);
    }
    const inFlight = await this.prisma.withdrawal.count({
      where: { userId: req.userId, status: { in: [...IN_FLIGHT_WITHDRAWALS] } },
    });
    if (inFlight > 0) {
      throw AppException.conflict(
        ErrorCode.DELETION_BLOCKED_PENDING_WITHDRAWALS,
        'The user still has withdrawals in flight; resolve them first',
        { pendingWithdrawals: inFlight },
      );
    }
    const kycDocs = await this.prisma.kycSubmission.findMany({
      where: { userId: req.userId },
      select: { documentFrontKey: true, documentBackKey: true, selfieKey: true },
    });
    const exports = await this.prisma.dataExportRequest.findMany({
      where: { userId: req.userId, storageKey: { not: null } },
      select: { storageKey: true },
    });
    const anonymized = anonymizedUserData(req.userId);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.accountDeletionRequest.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'executed', executedAt: new Date(), executedBy: actor.actorId ?? null, note: actor.note },
      });
      if (claimed.count === 0) throw AppException.conflict(ErrorCode.DELETION_REQUEST_NOT_PENDING, 'Request changed state');
      await tx.user.update({ where: { id: req.userId }, data: anonymized });
      await tx.devicePushToken.deleteMany({ where: { userId: req.userId } });
      await tx.notification.deleteMany({ where: { userId: req.userId } });
      await tx.refreshToken.updateMany({
        where: { subjectType: 'user', subjectId: req.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.adWatchSession.updateMany({
        where: { userId: req.userId },
        data: { deviceFingerprint: 'anonymized', deviceId: null, ipAddress: '0.0.0.0', userAgent: null },
      });
      await tx.payoutDestination.deleteMany({ where: { userId: req.userId } });
      await tx.kycSubmission.updateMany({
        where: { userId: req.userId },
        data: { fullName: 'anonymized', documentFrontKey: 'deleted', documentBackKey: null, selfieKey: 'deleted', providerResult: Prisma.JsonNull },
      });
      // withdrawals keep amounts/status (financial record) but lose the destination details
      await tx.withdrawal.updateMany({
        where: { userId: req.userId },
        data: { payoutDestination: 'anonymized', destinationName: null, destinationAccountName: null },
      });
      await this.audit.record(
        {
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'account_deletion.executed',
          targetType: 'user',
          targetId: req.userId,
          before: { phoneNumber: sha256(req.user.phoneNumber), status: req.user.status },
          after: { status: 'deleted', anonymizedAt: anonymized.anonymizedAt, retained: ['coin_ledger', 'ad_completions', 'withdrawals', 'audit_log'] },
          ipAddress: actor.ip,
        },
        tx,
      );
    });
    await this.tokens.invalidateAccessTokens('user', req.userId, 'account_deleted');
    for (const doc of kycDocs) {
      for (const key of [doc.documentFrontKey, doc.documentBackKey, doc.selfieKey]) if (key) await this.storage.delete(key);
    }
    for (const e of exports) if (e.storageKey) await this.storage.delete(e.storageKey);
    this.security.warn('data_rights.deletion_executed', { userId: req.userId, requestId: id, by: actor.actorType });
    return this.toDeletionItem(await this.prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id } }));
  }

  /** Hourly job: execute due requests, expire old exports, purge expired idempotency keys. */
  async runDue(now = new Date()) {
    const due = await this.prisma.accountDeletionRequest.findMany({
      where: { status: 'pending', scheduledFor: { lte: now } },
      select: { id: true },
    });
    let executed = 0;
    let blocked = 0;
    for (const r of due) {
      try {
        await this.execute(r.id, { actorType: 'system' });
        executed++;
      } catch (err) {
        blocked++;
        this.logger.warn(`Deletion ${r.id} not executed: ${(err as Error).message}`);
      }
    }
    const expiredExports = await this.prisma.dataExportRequest.findMany({
      where: { status: 'ready', expiresAt: { lt: now }, storageKey: { not: null } },
    });
    for (const e of expiredExports) {
      if (e.storageKey) await this.storage.delete(e.storageKey);
      await this.prisma.dataExportRequest.update({ where: { id: e.id }, data: { storageKey: null } });
    }
    const purgedKeys = await this.idempotency.purgeExpired(now);
    this.logger.log(`Data-rights job: ${executed} deletions executed, ${blocked} blocked, ${expiredExports.length} exports expired, ${purgedKeys} idempotency keys purged`);
    return { executed, blocked, expiredExports: expiredExports.length, purgedKeys };
  }

  /* ------------------------------ admin API ------------------------------ */

  async adminList(query: { page?: number; limit?: number; status?: DeletionRequestStatus }) {
    const p = pageArgs(query);
    const where: Prisma.AccountDeletionRequestWhereInput = { status: query.status ?? 'pending' };
    const [rows, total] = await Promise.all([
      this.prisma.accountDeletionRequest.findMany({
        where,
        include: { user: { select: { id: true, phoneNumber: true, fullName: true, status: true, coinBalance: true } } },
        orderBy: { scheduledFor: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.accountDeletionRequest.count({ where }),
    ]);
    const pendingCounts = rows.length
      ? await this.prisma.withdrawal.groupBy({
          by: ['userId'],
          where: { userId: { in: rows.map((r) => r.userId) }, status: { in: [...IN_FLIGHT_WITHDRAWALS] } },
          _count: { _all: true },
        })
      : [];
    return paginated(
      rows.map((r) => ({
        ...this.toDeletionItem(r),
        user: r.user,
        pendingWithdrawals: pendingCounts.find((c) => c.userId === r.userId)?._count._all ?? 0,
        executedBy: r.executedBy,
        cancelledBy: r.cancelledBy,
        note: r.note,
      })),
      total,
      p,
    );
  }

  toDeletionItem(r: {
    id: string;
    userId: string;
    status: string;
    reason: string | null;
    requestedAt: Date;
    scheduledFor: Date;
    executedAt: Date | null;
    cancelledAt: Date | null;
  }) {
    return {
      id: r.id,
      userId: r.userId,
      status: r.status,
      reason: r.reason,
      requestedAt: r.requestedAt,
      scheduledFor: r.scheduledFor,
      executedAt: r.executedAt,
      cancelledAt: r.cancelledAt,
      graceDays: this.config.platform.accountDeletionGraceDays,
    };
  }
}

/** Pure: the `users` update that removes every personal identifier while keeping the row (FK target for records). */
export function anonymizedUserData(userId: string, now = new Date()) {
  return {
    phoneNumber: `deleted:${userId}`,
    fullName: null,
    dateOfBirth: null,
    deviceId: null,
    lastIp: null,
    signupIp: null,
    signupDeviceFingerprint: null,
    referralCode: null,
    passwordHash: null,
    notificationPrefs: { rewards: false, withdrawals: false, offers: false },
    status: 'deleted' as const,
    statusReason: 'account_deleted',
    anonymizedAt: now,
  };
}

@Processor(QUEUE_DATA_RIGHTS)
export class DataRightsProcessor extends WorkerHost {
  constructor(private readonly service: DataRightsService) {
    super();
  }

  async process(job: Job<{ exportId?: string; trigger?: string }>) {
    if (job.name === 'export' && job.data.exportId) return this.service.buildExport(job.data.exportId);
    return this.service.runDue();
  }
}

@Injectable()
export class DataRightsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DataRightsScheduler.name);

  constructor(
    @InjectQueue(QUEUE_DATA_RIGHTS) private readonly queue: Queue,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap() {
    if (!this.config.env.QUEUES_ENABLED || this.config.isTest) return;
    try {
      await this.queue.upsertJobScheduler(
        'data-rights-due',
        { pattern: this.config.env.DATA_RIGHTS_CRON },
        { name: 'run-due', data: { trigger: 'schedule' } },
      );
      this.logger.log(`Data-rights job scheduled: "${this.config.env.DATA_RIGHTS_CRON}"`);
    } catch (err) {
      this.logger.warn(`Could not schedule data-rights job: ${(err as Error).message}`);
    }
  }
}
