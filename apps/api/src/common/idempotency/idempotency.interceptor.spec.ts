import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { firstValueFrom, of, throwError } from 'rxjs';
import { mockPrisma, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { canonicalJson, IDEMPOTENT_KEY, IdempotencyInterceptor, requestFingerprint } from './idempotency.interceptor';

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeContext(opts: {
  key?: string;
  body?: unknown;
  auth?: { subjectType: 'user' | 'admin' | 'advertiser'; subjectId: string } | undefined;
  enabled?: boolean;
  method?: string;
  path?: string;
}) {
  const headers: Record<string, string> = {};
  if (opts.key !== undefined) headers['idempotency-key'] = opts.key;
  const res = { setHeader: jest.fn(), status: jest.fn(), statusCode: 200 };
  const req = {
    headers,
    body: opts.body ?? { amountEtb: 60 },
    auth: opts.auth === undefined ? { subjectType: 'user', subjectId: uuid(1) } : opts.auth,
    method: opts.method ?? 'POST',
    originalUrl: opts.path ?? '/api/v1/withdrawals',
    url: opts.path ?? '/api/v1/withdrawals',
  };
  const handler = () => undefined;
  const cls = class {};
  if (opts.enabled !== false) Reflect.defineMetadata(IDEMPOTENT_KEY, true, handler);
  const ctx = {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, req, res };
}

describe('IdempotencyInterceptor', () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let interceptor: IdempotencyInterceptor;
  const config = testConfig({ IDEMPOTENCY_TTL_HOURS: 24 });

  beforeEach(() => {
    prisma = mockPrisma();
    prisma.idempotencyKey = {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    };
    interceptor = new IdempotencyInterceptor(new Reflector(), prisma, config, mockSecurity());
  });

  const run = (ctx: ExecutionContext, handler: CallHandler) =>
    firstValueFrom(interceptor.intercept(ctx, handler));

  it('passes through when no Idempotency-Key header is sent (backwards compatible)', async () => {
    const { ctx } = makeContext({});
    const next: CallHandler = { handle: () => of({ id: 'w-1' }) };
    expect(await run(ctx, next)).toEqual({ id: 'w-1' });
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('passes through on handlers that are not marked @Idempotent()', async () => {
    const { ctx } = makeContext({ key: 'k1', enabled: false });
    expect(await run(ctx, { handle: () => of('ok') })).toBe('ok');
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('claims a placeholder, runs the handler once and stores the serialized response with the status code', async () => {
    const { ctx } = makeContext({ key: 'k-first' });
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'row-1' });
    const handler = jest.fn(() => of({ id: 'w-1', amountEtb: new Prisma.Decimal('60.5'), at: new Date(0) }));

    const result = await run(ctx, { handle: handler });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: 'w-1' });
    expect(prisma.idempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: 'k-first',
          actorType: 'user',
          actorId: uuid(1),
          method: 'POST',
          path: '/api/v1/withdrawals',
          requestHash: requestFingerprint('POST', '/api/v1/withdrawals', { amountEtb: 60 }),
        }),
      }),
    );
    expect(prisma.idempotencyKey.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { statusCode: 201, responseBody: { id: 'w-1', amountEtb: 60.5, at: '1970-01-01T00:00:00.000Z' } },
    });
  });

  it('replays the stored response for the same key + same payload without running the handler', async () => {
    const { ctx, res } = makeContext({ key: 'k-replay' });
    prisma.idempotencyKey.create.mockRejectedValue(p2002());
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-1',
      requestHash: requestFingerprint('POST', '/api/v1/withdrawals', { amountEtb: 60 }),
      statusCode: 201,
      responseBody: { id: 'w-1', status: 'pending' },
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const handler = jest.fn(() => of({ id: 'SHOULD-NOT-RUN' }));

    const result = await run(ctx, { handle: handler });

    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'w-1', status: 'pending' });
    expect(res.setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects the same key with a different payload with 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const { ctx } = makeContext({ key: 'k-diff', body: { amountEtb: 999 } });
    prisma.idempotencyKey.create.mockRejectedValue(p2002());
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-1',
      requestHash: requestFingerprint('POST', '/api/v1/withdrawals', { amountEtb: 60 }),
      statusCode: 201,
      responseBody: { id: 'w-1' },
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const handler = jest.fn(() => of('nope'));
    await expect(run(ctx, { handle: handler })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
      details: { key: 'k-diff', inProgress: false },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a concurrent duplicate while the first request is still running (inProgress: true)', async () => {
    const { ctx } = makeContext({ key: 'k-race' });
    prisma.idempotencyKey.create.mockRejectedValue(p2002());
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-1',
      requestHash: requestFingerprint('POST', '/api/v1/withdrawals', { amountEtb: 60 }),
      statusCode: 0,
      responseBody: null,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await expect(run(ctx, { handle: () => of('nope') })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      details: { key: 'k-race', inProgress: true },
    });
  });

  it('releases the placeholder when the handler fails so the client can retry with the same key', async () => {
    const { ctx } = makeContext({ key: 'k-fail' });
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'row-9' });
    await expect(
      run(ctx, { handle: () => throwError(() => new Error('INSUFFICIENT_BALANCE')) }),
    ).rejects.toThrow('INSUFFICIENT_BALANCE');
    expect(prisma.idempotencyKey.delete).toHaveBeenCalledWith({ where: { id: 'row-9' } });
    expect(prisma.idempotencyKey.update).not.toHaveBeenCalled();
  });

  it('treats an expired stored key as new (deletes it and re-runs)', async () => {
    const { ctx } = makeContext({ key: 'k-expired' });
    prisma.idempotencyKey.create.mockRejectedValueOnce(p2002()).mockResolvedValueOnce({ id: 'row-2' });
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      id: 'row-old',
      requestHash: 'whatever',
      statusCode: 201,
      responseBody: { stale: true },
      expiresAt: new Date(Date.now() - 1000),
    });
    const handler = jest.fn(() => of({ fresh: true }));
    expect(await run(ctx, { handle: handler })).toEqual({ fresh: true });
    expect(prisma.idempotencyKey.delete).toHaveBeenCalledWith({ where: { id: 'row-old' } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('validates the key format', async () => {
    const { ctx } = makeContext({ key: 'bad key with spaces!' });
    await expect(run(ctx, { handle: () => of('x') })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('scopes keys per actor: another user with the same key gets its own row', async () => {
    const { ctx } = makeContext({ key: 'shared', auth: { subjectType: 'user', subjectId: uuid(2) } });
    prisma.idempotencyKey.create.mockResolvedValue({ id: 'row-u2' });
    await run(ctx, { handle: () => of({ ok: true }) });
    expect(prisma.idempotencyKey.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorId: uuid(2), key: 'shared' }) }),
    );
  });

  it('canonicalJson is key-order independent and ignores undefined', () => {
    expect(canonicalJson({ b: 1, a: [3, { d: 1, c: 2 }] })).toBe('{"a":[3,{"c":2,"d":1}],"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(requestFingerprint('post', '/x', { a: 1, b: 2 })).toBe(requestFingerprint('POST', '/x', { b: 2, a: 1 }));
    expect(requestFingerprint('POST', '/x', { a: 1 })).not.toBe(requestFingerprint('POST', '/x', { a: 2 }));
  });

  it('purgeExpired deletes rows past their TTL', async () => {
    expect(await interceptor.purgeExpired()).toBe(3);
    expect(prisma.idempotencyKey.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});
