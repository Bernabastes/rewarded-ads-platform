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
  return {
    store,
    client: { ping: jest.fn().mockResolvedValue('PONG') },
    incrWithTtl: jest.fn(async (key: string) => {
      const v = (store.get(key) ?? 0) + 1;
      store.set(key, v);
      return v;
    }),
    getNumber: jest.fn(async (key: string) => store.get(key) ?? 0),
    allow: jest.fn(async (key: string, limit: number) => {
      const v = (store.get(key) ?? 0) + 1;
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
