import { Global, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../../config/app-config';

/**
 * Thin ioredis wrapper with the counter helpers used for rate limiting and fraud velocity checks.
 * Connects lazily so boot never blocks on Redis (health/ready reports the real state).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly config: AppConfig) {
    this.client = new Redis(config.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      keyPrefix: `${config.env.QUEUE_PREFIX}:`,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
  }

  /** Increment a counter and set its TTL on first increment. Returns the new value. */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.client.incr(key);
    if (value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }

  async getNumber(key: string): Promise<number> {
    const v = await this.client.get(key);
    return v ? Number(v) : 0;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /** Simple fixed-window rate limit. Throws nothing; returns whether the call is allowed. */
  async allow(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; count: number }> {
    const count = await this.incrWithTtl(key, windowSeconds);
    return { allowed: count <= limit, count };
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
