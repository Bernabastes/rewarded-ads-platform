import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@rap/shared';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { mockAudit, mockPrisma, mockRedis, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { AuthService } from './auth.service';
import { LoginThrottle } from './login-throttle';
import { MfaService } from './mfa.service';

const ADMIN = uuid(5);

/**
 * Admin login hardening (security audit #5): throttle + lockout on the password step, TOTP second step bound
 * to a single-use mfaToken, and wrong TOTP codes counting toward the lockout.
 */
describe('AuthService admin login (security audit #5)', () => {
  const config = testConfig({ LOGIN_LOCKOUT_THRESHOLD: 3, LOGIN_RATE_LIMIT_PER_ACCOUNT: 50, LOGIN_RATE_LIMIT_PER_IP: 50 });
  const jwt = new JwtService({});
  let prisma: any;
  let redis: any;
  let security: any;
  let tokens: any;
  let alerts: any;
  let mfa: MfaService;
  let service: AuthService;
  let passwordHash: string;
  const meta = { ip: '1.1.1.1', userAgent: 'jest' };

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('Admin123!', 4);
  });

  const adminRow = (over: Record<string, unknown> = {}) => ({
    id: ADMIN,
    email: 'finance@rap.et',
    fullName: 'Finance',
    role: 'finance',
    active: true,
    passwordHash,
    mfaSecret: null,
    mfaEnabledAt: null,
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    prisma = mockPrisma();
    redis = mockRedis();
    security = mockSecurity();
    tokens = {
      issue: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, tokenType: 'Bearer' }),
      revokeAllForSubject: jest.fn(),
    };
    const audit = mockAudit();
    alerts = { raise: jest.fn().mockResolvedValue({ id: 'alert-1' }) };
    const throttle = new LoginThrottle(redis, config, security, audit, alerts);
    mfa = new MfaService(prisma, config, redis, security, audit, throttle);
    service = new AuthService(
      prisma,
      redis,
      config,
      tokens,
      security,
      audit,
      { advertiserConsentState: jest.fn() } as never,
      {} as never,
      {} as never,
      throttle,
      mfa,
      jwt,
      { send: jest.fn() } as never,
    );
    prisma.adminUser.update.mockImplementation(async ({ data }: any) => ({ ...(await prisma.adminUser.findUnique({})), ...data }));
  });

  it('password-only admin: wrong password → 401, third failure locks the account → 423 even with the right password', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(adminRow());
    for (let i = 0; i < 2; i++) {
      await expect(service.loginAdmin('finance@rap.et', 'nope', meta)).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    }
    await expect(service.loginAdmin('finance@rap.et', 'nope', meta)).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    expect(security.warn).toHaveBeenCalledWith('auth.account_locked', expect.objectContaining({ subjectId: ADMIN }));
    await expect(service.loginAdmin('finance@rap.et', 'Admin123!', meta)).rejects.toMatchObject({
      code: ErrorCode.ACCOUNT_LOCKED,
      status: 423,
    });
    expect(tokens.issue).not.toHaveBeenCalled();
    // Phase 5b: the lock is per account + IP, so the real admin signing in from another address is not denied
    await expect(service.loginAdmin('finance@rap.et', 'Admin123!', { ip: '8.8.8.8' })).resolves.toMatchObject({ admin: { id: ADMIN } });
  });

  it('unknown e-mails are throttled exactly like real accounts (no existence oracle)', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(null);
    for (let i = 0; i < 3; i++) {
      await expect(service.loginAdmin('ghost@rap.et', 'nope', meta)).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    }
    await expect(service.loginAdmin('ghost@rap.et', 'nope', meta)).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_LOCKED });
  });

  it('MFA-enabled admin: step 1 returns a challenge (no tokens); step 2 with the TOTP code issues the session; the mfaToken is single use', async () => {
    const secret = authenticator.generateSecret();
    const row = adminRow({ mfaSecret: mfa.encrypt(secret), mfaEnabledAt: new Date() });
    prisma.adminUser.findUnique.mockResolvedValue(row);

    const step1 = await service.loginAdmin('finance@rap.et', 'Admin123!', meta);
    expect(step1).toMatchObject({ mfaRequired: true, expiresIn: 300 });
    expect((step1 as any).tokens).toBeUndefined();
    expect(tokens.issue).not.toHaveBeenCalled();
    const mfaToken = (step1 as { mfaToken: string }).mfaToken;

    await expect(service.loginAdminMfa(mfaToken, '000000', meta)).rejects.toMatchObject({ code: ErrorCode.MFA_CODE_INVALID, status: 400 });
    const code = authenticator.generate(secret);
    const step2 = await service.loginAdminMfa(mfaToken, code, meta);
    expect(step2).toMatchObject({ tokens: { accessToken: 'a' }, admin: { id: ADMIN, mfaEnabled: true } });
    expect(tokens.issue).toHaveBeenCalledWith({ type: 'admin', id: ADMIN, role: 'finance' }, meta);

    // replaying the challenge token (even with a fresh code) is refused
    await expect(service.loginAdminMfa(mfaToken, authenticator.generate(secret), meta)).rejects.toMatchObject({
      code: ErrorCode.MFA_TOKEN_INVALID,
      status: 401,
    });
  });

  it('rejects forged / wrong-type / expired mfaTokens with 401 MFA_TOKEN_INVALID', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(adminRow({ mfaSecret: 'x', mfaEnabledAt: new Date() }));
    await expect(service.loginAdminMfa('not-a-jwt-at-all-really', '123456', meta)).rejects.toMatchObject({ code: ErrorCode.MFA_TOKEN_INVALID });
    const accessLike = await jwt.signAsync({ typ: 'admin', role: 'finance' }, { subject: ADMIN, secret: config.env.JWT_ACCESS_SECRET, expiresIn: 300, jwtid: 'j1' });
    await expect(service.loginAdminMfa(accessLike, '123456', meta)).rejects.toMatchObject({ code: ErrorCode.MFA_TOKEN_INVALID });
    const expired = await jwt.signAsync({ typ: 'mfa' }, { subject: ADMIN, secret: config.env.JWT_ACCESS_SECRET, expiresIn: -10, jwtid: 'j2' });
    await expect(service.loginAdminMfa(expired, '123456', meta)).rejects.toMatchObject({ code: ErrorCode.MFA_TOKEN_INVALID });
  });

  it('wrong TOTP codes count toward the account lockout', async () => {
    const secret = authenticator.generateSecret();
    prisma.adminUser.findUnique.mockResolvedValue(adminRow({ mfaSecret: mfa.encrypt(secret), mfaEnabledAt: new Date() }));
    const { mfaToken } = (await service.loginAdmin('finance@rap.et', 'Admin123!', meta)) as { mfaToken: string };
    for (let i = 0; i < 3; i++) {
      await expect(service.loginAdminMfa(mfaToken, '111111', meta)).rejects.toMatchObject({ code: ErrorCode.MFA_CODE_INVALID });
    }
    await expect(service.loginAdminMfa(mfaToken, authenticator.generate(secret), meta)).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_LOCKED });
  });

  /* ---------------- Phase 5c New-10: trusted IP only after a FULL login; account-wide TOTP cap ---------------- */

  it('REGRESSION New-10: a correct password alone does not trust the IP - the trust mark appears only after the TOTP step', async () => {
    const secret = authenticator.generateSecret();
    prisma.adminUser.findUnique.mockResolvedValue(adminRow({ mfaSecret: mfa.encrypt(secret), mfaEnabledAt: new Date() }));
    const { mfaToken } = (await service.loginAdmin('finance@rap.et', 'Admin123!', meta)) as { mfaToken: string };
    expect(await redis.client.get('login:trusted:admin:finance@rap.et:1.1.1.1')).toBeNull();
    await service.loginAdminMfa(mfaToken, authenticator.generate(secret), meta);
    expect(await redis.client.get('login:trusted:admin:finance@rap.et:1.1.1.1')).not.toBeNull();
    // a password-only admin (no MFA) is a complete login and IS trusted
    prisma.adminUser.findUnique.mockResolvedValue(adminRow({ email: 'support@rap.et' }));
    await service.loginAdmin('support@rap.et', 'Admin123!', { ip: '2.2.2.2' });
    expect(await redis.client.get('login:trusted:admin:support@rap.et:2.2.2.2')).not.toBeNull();
  });

  it('REGRESSION New-10: 10 wrong TOTP codes from rotating IPs lock the ACCOUNT for every IP (423, security log, critical alert)', async () => {
    const secret = authenticator.generateSecret();
    prisma.adminUser.findUnique.mockResolvedValue(adminRow({ mfaSecret: mfa.encrypt(secret), mfaEnabledAt: new Date() }));
    const { mfaToken } = (await service.loginAdmin('finance@rap.et', 'Admin123!', meta)) as { mfaToken: string };
    // each IP stays under the per-IP lockout (threshold 3) - only the account-wide cap can stop this
    for (let i = 0; i < 10; i++) {
      await expect(service.loginAdminMfa(mfaToken, '000000', { ip: `9.9.${Math.floor(i / 2)}.${i}` })).rejects.toMatchObject({ code: ErrorCode.MFA_CODE_INVALID });
    }
    await expect(service.loginAdminMfa(mfaToken, authenticator.generate(secret), { ip: '10.10.10.10' })).rejects.toMatchObject({
      code: ErrorCode.ACCOUNT_LOCKED,
      status: 423,
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect(security.warn).toHaveBeenCalledWith('auth.account_locked', expect.objectContaining({ reason: 'mfa_account_cap', account: 'finance@rap.et', failures: 10 }));
    expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADMIN_MFA_BRUTE_FORCE', severity: 'critical', dedupeKey: 'admin_mfa_brute_force:finance@rap.et' }));
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('changeAdminPassword clears mustChangePassword, stamps passwordChangedAt and revokes every session', async () => {
    prisma.adminUser.findUniqueOrThrow.mockResolvedValue(adminRow({ mustChangePassword: true }));
    await expect(service.changeAdminPassword(ADMIN, 'wrong', 'NewPassw0rd!', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    const res = await service.changeAdminPassword(ADMIN, 'Admin123!', 'NewPassw0rd!', '1.1.1.1');
    expect(res).toEqual({ changed: true, sessionsRevoked: true });
    const data = prisma.adminUser.update.mock.calls.at(-1)[0].data;
    expect(data.mustChangePassword).toBe(false);
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare('NewPassw0rd!', data.passwordHash)).toBe(true);
    expect(tokens.revokeAllForSubject).toHaveBeenCalledWith('admin', ADMIN, 'password_changed');
  });
});
