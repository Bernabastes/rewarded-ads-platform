import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@rap/shared';
import { mockAudit, mockPrisma, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { AuthGuard } from './auth.guard';

const USER = uuid(1);
const ADMIN = uuid(2);

function ctx(token: string, method = 'GET', path = '/api/v1/users/me'): ExecutionContext {
  const handler = () => undefined;
  const cls = class {};
  const req = { headers: { authorization: `Bearer ${token}` }, method, originalUrl: path, url: path, ip: '9.9.9.9', socket: {} };
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard (Phase 4A: denylist, impersonation, deleted accounts)', () => {
  const config = testConfig();
  const jwt = new JwtService({});
  let prisma: any;
  let tokens: any;
  let audit: any;
  let guard: AuthGuard;

  const sign = (payload: Record<string, unknown>, sub: string) =>
    jwt.signAsync(payload, { subject: sub, secret: config.env.JWT_ACCESS_SECRET, expiresIn: 600, jwtid: uuid(77) });

  beforeEach(() => {
    prisma = mockPrisma();
    tokens = { isAccessTokenDenied: jest.fn().mockResolvedValue(false) };
    audit = mockAudit();
    guard = new AuthGuard(new Reflector(), jwt, config, prisma, tokens, audit, mockSecurity());
    prisma.user.findUnique.mockResolvedValue({ status: 'active', ageVerificationStatus: 'verified_adult' });
    prisma.adminUser.findUnique.mockResolvedValue({ active: true, role: 'support' });
  });

  it('rejects denylisted access tokens with 401 INVALID_TOKEN (F2)', async () => {
    tokens.isAccessTokenDenied.mockResolvedValue(true);
    const token = await sign({ typ: 'user' }, USER);
    await expect(guard.canActivate(ctx(token))).rejects.toMatchObject({ code: ErrorCode.INVALID_TOKEN, status: 401 });
    expect(tokens.isAccessTokenDenied).toHaveBeenCalledWith('user', USER, expect.objectContaining({ jti: uuid(77) }));
  });

  it('treats deleted accounts like non-existent ones', async () => {
    prisma.user.findUnique.mockResolvedValue({ status: 'deleted', ageVerificationStatus: 'verified_adult' });
    const token = await sign({ typ: 'user' }, USER);
    await expect(guard.canActivate(ctx(token))).rejects.toMatchObject({ code: ErrorCode.INVALID_TOKEN });
  });

  describe('impersonation tokens', () => {
    it('act as the user for GET requests and audit every use', async () => {
      const token = await sign({ typ: 'impersonation', actorAdminId: ADMIN }, USER);
      const c = ctx(token, 'GET', '/api/v1/users/me/balance');
      await expect(guard.canActivate(c)).resolves.toBe(true);
      const req = c.switchToHttp().getRequest<{ auth: unknown }>();
      expect(req.auth).toMatchObject({ subjectType: 'user', subjectId: USER, impersonation: { actorAdminId: ADMIN } });
      await new Promise((r) => setImmediate(r));
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'impersonation.read', actorId: ADMIN, targetId: USER, metadata: expect.objectContaining({ method: 'GET' }) }),
      );
    });

    it('reject every mutation with 403 IMPERSONATION_READ_ONLY (and audit the attempt)', async () => {
      const token = await sign({ typ: 'impersonation', actorAdminId: ADMIN }, USER);
      await expect(guard.canActivate(ctx(token, 'POST', '/api/v1/withdrawals'))).rejects.toMatchObject({
        code: ErrorCode.IMPERSONATION_READ_ONLY,
        status: 403,
      });
      await new Promise((r) => setImmediate(r));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'impersonation.write_blocked' }));
    });

    it('stop working when the acting admin is deactivated or lacks the support/super_admin role', async () => {
      const token = await sign({ typ: 'impersonation', actorAdminId: ADMIN }, USER);
      prisma.adminUser.findUnique.mockResolvedValueOnce({ active: false, role: 'support' });
      await expect(guard.canActivate(ctx(token))).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      prisma.adminUser.findUnique.mockResolvedValueOnce({ active: true, role: 'finance' });
      await expect(guard.canActivate(ctx(token))).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('are checked against the denylist like any other token', async () => {
      tokens.isAccessTokenDenied.mockResolvedValue(true);
      const token = await sign({ typ: 'impersonation', actorAdminId: ADMIN }, USER);
      await expect(guard.canActivate(ctx(token))).rejects.toMatchObject({ code: ErrorCode.INVALID_TOKEN });
    });
  });
});
