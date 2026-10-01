import { BullModule, BullRegistrar } from '@nestjs/bullmq';
import { Global, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

export const QUEUE_PAYOUTS = 'payouts';
export const QUEUE_RECONCILIATION = 'reconciliation';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_FRAUD = 'fraud';
export const QUEUE_MEDIA = 'media';
export const QUEUE_ALERTS = 'alerts';
export const QUEUE_DATA_RIGHTS = 'data-rights';

export const ALL_QUEUES = [
  QUEUE_PAYOUTS,
  QUEUE_RECONCILIATION,
  QUEUE_NOTIFICATIONS,
  QUEUE_FRAUD,
  QUEUE_MEDIA,
  QUEUE_ALERTS,
  QUEUE_DATA_RIGHTS,
] as const;

/**
 * Workers (@Processor classes) are registered manually so that processes which only need the HTTP layer
 * (OpenAPI export, tests, or a future API-only deployment with QUEUES_ENABLED=false) never open blocking
 * Redis connections. SCALING.md describes running workers as a separate deployment with the same image.
 */
@Injectable()
export class QueueWorkersBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueWorkersBootstrap.name);

  constructor(
    private readonly registrar: BullRegistrar,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.env.QUEUES_ENABLED || this.config.isTest) {
      this.logger.log('Queue workers disabled (QUEUES_ENABLED=false or test environment)');
      return;
    }
    this.registrar.register();
    this.logger.log(`Queue workers started for: ${ALL_QUEUES.join(', ')}`);
  }
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      extraOptions: { manualRegistration: true },
      useFactory: (config: AppConfig) => {
        const url = new URL(config.env.REDIS_URL);
        return {
          prefix: `${config.env.QUEUE_PREFIX}-bull`,
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            username: url.username || undefined,
            password: url.password ? decodeURIComponent(url.password) : undefined,
            db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : undefined,
            tls: url.protocol === 'rediss:' ? {} : undefined,
            lazyConnect: true,
            maxRetriesPerRequest: null,
            enableOfflineQueue: true,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 24 * 3600, count: 1000 },
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        };
      },
    }),
    ...ALL_QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  providers: [QueueWorkersBootstrap],
  exports: [BullModule],
})
export class QueueModule {}
