import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { type NotificationType, Prisma } from '@prisma/client';
import { type Job, Queue } from 'bullmq';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PUSH_ADAPTER, type PushAdapter } from '../../infra/push/push.module';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.module';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const PREF_BY_TYPE: Record<NotificationType, 'rewards' | 'withdrawals' | 'offers' | null> = {
  reward_confirmed: 'rewards',
  reward_flagged: 'rewards',
  withdrawal_status: 'withdrawals',
  new_offer: 'offers',
  account_status: null,
  system: null,
};

/**
 * Persists notifications (always, so the in-app inbox is complete) and dispatches push delivery through
 * the notifications queue, honouring the user's notification preferences.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
  ) {}

  async notify(input: NotifyInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    if (this.config.env.QUEUES_ENABLED && !this.config.isTest) {
      this.queue
        .add('push', { notificationId: notification.id }, { jobId: `push-${notification.id}` })
        .catch((err) => this.logger.warn(`Could not enqueue push for ${notification.id}: ${err.message}`));
    }
    return notification;
  }

  async list(userId: string, query: { page?: number; limit?: number }) {
    const p = pageArgs(query);
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        select: { id: true, type: true, title: true, body: true, data: true, readAt: true, pushStatus: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);
    return paginated(rows, total, p);
  }

  async markRead(userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw AppException.notFound('Notification not found');
    return this.prisma.notification.update({ where: { id }, data: { readAt: n.readAt ?? new Date() } });
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async registerPushToken(userId: string, token: string, platform: 'android' | 'ios' | 'web', deviceId?: string) {
    return this.prisma.devicePushToken.upsert({
      where: { token },
      create: { userId, token, platform, deviceId },
      update: { userId, platform, deviceId, lastSeenAt: new Date() },
    });
  }

  async removePushToken(userId: string, token: string) {
    await this.prisma.devicePushToken.deleteMany({ where: { userId, token } });
  }
}

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_ADAPTER) private readonly push: PushAdapter,
  ) {
    super();
  }

  async process(job: Job<{ notificationId: string }>) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: job.data.notificationId },
      include: { user: { select: { notificationPrefs: true, pushTokens: { select: { token: true } } } } },
    });
    if (!notification || notification.pushStatus !== 'pending') return;

    const prefKey = PREF_BY_TYPE[notification.type];
    const prefs = (notification.user.notificationPrefs ?? {}) as Record<string, boolean>;
    const tokens = notification.user.pushTokens.map((t) => t.token);
    if ((prefKey && prefs[prefKey] === false) || tokens.length === 0) {
      await this.prisma.notification.update({ where: { id: notification.id }, data: { pushStatus: 'skipped' } });
      return;
    }

    const results = await this.push.send(tokens, {
      title: notification.title,
      body: notification.body,
      data: Object.fromEntries(
        Object.entries((notification.data as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)]),
      ),
    });
    const invalid = results.filter((r) => r.invalidToken).map((r) => r.token);
    if (invalid.length) await this.prisma.devicePushToken.deleteMany({ where: { token: { in: invalid } } });
    const anyOk = results.some((r) => r.ok);
    await this.prisma.notification.update({
      where: { id: notification.id },
      data: { pushStatus: anyOk ? 'sent' : 'failed', sentAt: anyOk ? new Date() : null },
    });
    this.logger.debug(`Push ${notification.id}: ${anyOk ? 'sent' : 'failed'} via ${this.push.name}`);
  }
}

@Module({
  providers: [NotificationService, NotificationProcessor],
  exports: [NotificationService],
})
export class NotificationsModule {}
