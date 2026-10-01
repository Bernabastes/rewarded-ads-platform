/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prisma } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { type Env, envSchema } from '../config/env';

/** Typed AppConfig with test-friendly defaults; override any env var. */
export function testConfig(overrides: Partial<Record<keyof Env, unknown>> = {}): AppConfig {
  const env = envSchema.parse({ NODE_ENV: 'test', OTP_DEV_ECHO: 'false', ...overrides });
  return new AppConfig(env);
}

type AnyFn = (...args: any[]) => any;

const MODEL_METHODS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findMany',
  'create',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
];

/**
 * Minimal Prisma mock: every model exposes jest.fn() methods, `$transaction` runs the callback against the same
 * mock (so services that pass `tx` behave exactly like in production) and `$queryRaw` returns the queued rows.
 */
export function mockPrisma() {
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async (arg: AnyFn | Promise<unknown>[]) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  };
  for (const m of [
    'user',
    'coinLedger',
    'adWatchSession',
    'adCompletion',
    'campaign',
    'ad',
    'fraudFlag',
    'withdrawal',
    'withdrawalApproval',
    'coinAdjustmentRequest',
    'auditLog',
    'notification',
    'advertiser',
    'advertiserWalletLedger',
    'refreshToken',
    'otpCode',
    'adminUser',
    'devicePushToken',
    'ledgerReconciliationRun',
    'survey',
    'surveyResponse',
    'appInstallOffer',
    'appInstallCompletion',
    'adReport',
    'idempotencyKey',
    'payoutDestination',
    'kycSubmission',
    'legalDocument',
    'userConsent',
    'advertiserConsent',
    'platformAlert',
    'referral',
    'dataExportRequest',
    'accountDeletionRequest',
    'attentionQuestion',
    'advertiserPayment',
    'invoice',
  ]) {
    prisma[m] = Object.fromEntries(MODEL_METHODS.map((name) => [name, jest.fn()]));
  }
  return prisma;
}

export function mockSecurity() {
  return { event: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

export function mockAudit() {
  return { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) } as any;
}

export function mockRedis() {
  const store = new Map<string, number>();
  /** In-memory string keys with TTLs for code that talks to `redis.client` directly (login throttle, MFA, OTP). */
  const kv = new Map<string, { value: string; expiresAt: number | null }>();
  const live = (key: string) => {
    const e = kv.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      kv.delete(key);
      return undefined;
    }
    return e;
  };
  const client = {
    ping: jest.fn().mockResolvedValue('PONG'),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      const flags = args.map((a) => String(a).toUpperCase());
      const nx = flags.includes('NX');
      if (nx && live(key)) return null;
      const exIdx = flags.indexOf('EX');
      const ttl = exIdx >= 0 ? Number(args[exIdx + 1]) : null;
      kv.set(key, { value: String(value), expiresAt: ttl ? Date.now() + ttl * 1000 : null });
      return 'OK';
    }),
    get: jest.fn(async (key: string) => live(key)?.value ?? null),
    mget: jest.fn(async (...keys: string[]) => keys.map((k) => live(k)?.value ?? null)),
    del: jest.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (kv.delete(k)) n++;
      return n;
    }),
    ttl: jest.fn(async (key: string) => {
      const e = live(key);
      if (!e) return -2;
      return e.expiresAt === null ? -1 : Math.max(1, Math.ceil((e.expiresAt - Date.now()) / 1000));
    }),
    expire: jest.fn(async (key: string, ttl: number) => {
      const e = live(key);
      if (!e) return 0;
      e.expiresAt = Date.now() + ttl * 1000;
      return 1;
    }),
    incr: jest.fn(async (key: string) => {
      const v = Number(live(key)?.value ?? 0) + 1;
      kv.set(key, { value: String(v), expiresAt: live(key)?.expiresAt ?? null });
      return v;
    }),
  };
  return {
    store,
    kv,
    client,
    /** Shares the key space with `client` so `client.del(key)` resets a counter exactly like real Redis. */
    incrWithTtl: jest.fn(async (key: string, ttlSeconds: number) => {
      const v = await client.incr(key);
      if (v === 1 && ttlSeconds) await client.expire(key, ttlSeconds);
      store.set(key, v);
      return v;
    }),
    getNumber: jest.fn(async (key: string) => Number((await client.get(key)) ?? 0)),
    allow: jest.fn(async (key: string, limit: number, windowSeconds: number) => {
      const v = await client.incr(key);
      if (v === 1 && windowSeconds) await client.expire(key, windowSeconds);
      store.set(key, v);
      return { allowed: v <= limit, count: v };
    }),
    isHealthy: jest.fn().mockResolvedValue(true),
  } as any;
}

export function mockNotifications() {
  return {
    notify: jest.fn().mockResolvedValue({ id: 'n-1' }),
    unreadCount: jest.fn().mockResolvedValue(0),
  } as any;
}

export function mockQueue() {
  return { add: jest.fn().mockResolvedValue({ id: 'job' }), upsertJobScheduler: jest.fn() } as any;
}

export const D = (n: number | string) => new Prisma.Decimal(n);

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
