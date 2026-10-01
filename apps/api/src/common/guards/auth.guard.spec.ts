import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@rap/shared';
import { mockAudit, mockPrisma, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { ALLOW_PENDING_SECURITY_SETUP_KEY, ROLES_KEY } from '../decorators/auth.decorators';
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
  let mfa: { setupRequiredFor: jest.Mock };
  let guard: AuthGuard;

  const sign = (payload: Record<string, unknown>, sub: string) =>
    jwt.signAsync(payload, { subject: sub, secret: config.env.JWT_ACCESS_SECRET, expiresIn: 600, jwtid: uuid(77) });

  /** Attach handler metadata (what @Roles / @AllowPendingSecuritySetup would set). */
  const withMeta = (c: ExecutionContext, meta: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, c.getHandler());
    return c;
  };

  beforeEach(() => {
    prisma = mockPrisma();
    tokens = { isAccessTokenDenied: jest.fn().mockResolvedValue(false) };
    audit = mockAudit();
    mfa = { setupRequiredFor: jest.fn().mockReturnValue(false) };
    guard = new AuthGuard(new Reflector(), jwt, config, prisma, tokens, audit, mockSecurity(), mfa as never);
    prisma.user.findUnique.mockResolvedValue({ status: 'active', ageVerificationStatus: 'verified_adult' });
    prisma.adminUser.findUnique.mockResolvedValue({ active: true, role: 'support', mfaEnabledAt: null, mustChangePassword: false });
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

  it('REGRESSION New-7: an MFA challenge token (typ=mfa) presented as a Bearer token is rejected, even for the admin routes', async () => {
    const mfaToken = await sign({ typ: 'mfa' }, ADMIN);
    await expect(guard.canActivate(ctx(mfaToken, 'GET', '/api/v1/admin/me'))).rejects.toMatchObject({ code: ErrorCode.INVALID_TOKEN, status: 401 });
    await expect(guard.canActivate(ctx(mfaToken, 'POST', '/api/v1/admin/me/mfa/enable'))).rejects.toMatchObject({ code: ErrorCode.INVALID_TOKEN, status: 401 });
    expect(prisma.adminUser.findUnique).not.toHaveBeenCalled();
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

  describe('admin role from the database (security audit #13)', () => {
    it('evaluates @Roles against the CURRENT DB role, not the role claim baked into the token', async () => {
      // token still says super_admin; the DB was changed to support by PATCH /admin/admins/:id/role
      const token = await sign({ typ: 'admin', role: 'super_admin' }, ADMIN);
      prisma.adminUser.findUnique.mockResolvedValue({ active: true, role: 'support', mfaEnabledAt: null, mustChangePassword: false });
      const c = withMeta(ctx(token, 'POST', '/api/v1/admin/admins'), { [ROLES_KEY]: ['super_admin'] });
      await expect(guard.canActivate(c)).rejects.toMatchObject({ code: ErrorCode.ROLE_NOT_ALLOWED, status: 403 });
    });

    it('grants a route when the DB role qualifies even if the token claim is stale', async () => {
      const token = await sign({ typ: 'admin', role: 'support' }, ADMIN);
      prisma.adminUser.findUnique.mockResolvedValue({ active: true, role: 'super_admin', mfaEnabledAt: null, mustChangePassword: false });
      const c = withMeta(ctx(token, 'GET', '/api/v1/admin/admins'), { [ROLES_KEY]: ['super_admin'] });
      await expect(guard.canActivate(c)).resolves.toBe(true);
      expect(c.switchToHttp().getRequest<{ auth: { role: string } }>().auth.role).toBe('super_admin');
    });
  });

  describe('pending security state (security audit #5)', () => {
    it('confines an admin with a temporary password to the allow-listed routes (403 PASSWORD_CHANGE_REQUIRED elsewhere)', async () => {
      const token = await sign({ typ: 'admin', role: 'support' }, ADMIN);
      prisma.adminUser.findUnique.mockResolvedValue({ active: true, role: 'support', mfaEnabledAt: null, mustChangePassword: true });
      await expect(guard.canActivate(ctx(token, 'GET', '/api/v1/admin/overview'))).rejects.toMatchObject({
        code: ErrorCode.PASSWORD_CHANGE_REQUIRED,
        status: 403,
      });
      const allowed = withMeta(ctx(token, 'POST', '/api/v1/admin/me/change-password'), { [ALLOW_PENDING_SECURITY_SETUP_KEY]: true });
      await expect(guard.canActivate(allowed)).resolves.toBe(true);
    });

    it('returns 403 MFA_SETUP_REQUIRED for a finance/super_admin without TOTP when ADMIN_MFA_REQUIRED is on', async () => {
      const token = await sign({ typ: 'admin', role: 'finance' }, ADMIN);
      prisma.adminUser.findUnique.mockResolvedValue({ active: true, role: 'finance', mfaEnabledAt: null, mustChangePassword: false });
      mfa.setupRequiredFor.mockReturnValue(true);
      await expect(guard.canActivate(ctx(token, 'GET', '/api/v1/admin/withdrawals'))).rejects.toMatchObject({
        code: ErrorCode.MFA_SETUP_REQUIRED,
        status: 403,
      });
      const setup = withMeta(ctx(token, 'POST', '/api/v1/admin/me/mfa/setup'), { [ALLOW_PENDING_SECURITY_SETUP_KEY]: true });
      await expect(guard.canActivate(setup)).resolves.toBe(true);
      expect(mfa.setupRequiredFor).toHaveBeenCalledWith(expect.objectContaining({ role: 'finance', mfaEnabledAt: null }));
    });
  });
});
