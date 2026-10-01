import { ErrorCode } from '@rap/shared';
import { authenticator } from 'otplib';
import { mockAudit, mockPrisma, mockRedis, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { LoginThrottle } from './login-throttle';
import { MfaService } from './mfa.service';

const ADMIN = uuid(5);

describe('LoginThrottle (security audit #5)', () => {
  const config = testConfig({
    LOGIN_RATE_LIMIT_PER_IP: 4,
    LOGIN_RATE_LIMIT_PER_ACCOUNT: 3,
    LOGIN_WINDOW_SECONDS: 900,
    LOGIN_LOCKOUT_THRESHOLD: 2,
    LOGIN_LOCKOUT_SECONDS: 600,
  });
  let redis: any;
  let security: any;
  let audit: any;
  let throttle: LoginThrottle;

  beforeEach(() => {
    redis = mockRedis();
    security = mockSecurity();
    audit = mockAudit();
    throttle = new LoginThrottle(redis, config, security, audit);
  });

  it('allows attempts under both limits and throttles per ACCOUNT across IPs (429 LOGIN_RATE_LIMITED)', async () => {
    await throttle.assertAllowed('admin', 'Finance@RAP.et', '1.1.1.1');
    await throttle.assertAllowed('admin', 'finance@rap.et', '2.2.2.2');
    await throttle.assertAllowed('admin', 'finance@rap.et ', '3.3.3.3');
    await expect(throttle.assertAllowed('admin', 'finance@rap.et', '4.4.4.4')).rejects.toMatchObject({
      code: ErrorCode.LOGIN_RATE_LIMITED,
      status: 429,
    });
    expect(security.warn).toHaveBeenCalledWith('auth.login_rate_limited', expect.objectContaining({ reason: 'account' }));
  });

  it('throttles per IP across different accounts (credential stuffing)', async () => {
    for (let i = 0; i < 4; i++) await throttle.assertAllowed('advertiser', `a${i}@x.et`, '9.9.9.9');
    await expect(throttle.assertAllowed('advertiser', 'a99@x.et', '9.9.9.9')).rejects.toMatchObject({ code: ErrorCode.LOGIN_RATE_LIMITED });
    expect(security.warn).toHaveBeenCalledWith('auth.login_rate_limited', expect.objectContaining({ reason: 'ip' }));
  });

  it('locks the account after LOGIN_LOCKOUT_THRESHOLD consecutive failures (423 ACCOUNT_LOCKED, audited) and a success resets the streak', async () => {
    expect(await throttle.recordFailure('admin', 'super@rap.et', '1.1.1.1', ADMIN)).toBe(false);
    await throttle.recordSuccess('admin', 'super@rap.et'); // streak reset
    expect(await throttle.recordFailure('admin', 'super@rap.et', '1.1.1.1', ADMIN)).toBe(false);
    expect(await throttle.recordFailure('admin', 'super@rap.et', '1.1.1.1', ADMIN)).toBe(true);
    expect(security.warn).toHaveBeenCalledWith('auth.account_locked', expect.objectContaining({ account: 'super@rap.et', failures: 2 }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.login_locked', targetId: ADMIN }));
    await expect(throttle.assertAllowed('admin', 'super@rap.et', '5.5.5.5')).rejects.toMatchObject({
      code: ErrorCode.ACCOUNT_LOCKED,
      status: 423,
      details: { retryAfterSeconds: expect.any(Number) },
    });
  });

  it('fails open (logs) when Redis is unavailable instead of blocking every login (default outside production)', async () => {
    redis.client.ttl.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(throttle.assertAllowed('admin', 'x@rap.et', '1.1.1.1')).resolves.toBeUndefined();
    expect(security.error).toHaveBeenCalledWith('auth.denylist_unavailable', expect.objectContaining({ scope: 'login_throttle', failMode: 'open' }));
  });

  it('Phase 5b New-5: fails CLOSED (503, security event) when SECURITY_REDIS_FAIL_MODE=closed and Redis is unavailable', async () => {
    const closed = new LoginThrottle(redis, testConfig({ SECURITY_REDIS_FAIL_MODE: 'closed' }), security, audit);
    redis.client.ttl.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(closed.assertAllowed('admin', 'x@rap.et', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE, status: 503 });
    expect(security.error).toHaveBeenCalledWith('auth.denylist_unavailable', expect.objectContaining({ scope: 'login_throttle', failMode: 'closed' }));
    // production defaults to closed, development to open
    expect(testConfig({ NODE_ENV: 'development' }).redisFailClosed).toBe(false);
    expect(testConfig({ NODE_ENV: 'development', SECURITY_REDIS_FAIL_MODE: 'closed' }).redisFailClosed).toBe(true);
  });
});

describe('MfaService (security audit #5)', () => {
  const config = testConfig({ ADMIN_MFA_REQUIRED: true, MFA_ENCRYPTION_KEY: 'unit-test-mfa-key' });
  let prisma: any;
  let redis: any;
  let security: any;
  let audit: any;
  let throttle: LoginThrottle;
  let mfa: MfaService;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await (await import('bcryptjs')).hash('Admin123!', 4);
  });

  const admin = (over: Record<string, unknown> = {}) => ({
    id: ADMIN,
    email: 'finance@rap.et',
    role: 'finance',
    active: true,
    passwordHash,
    mfaSecret: null,
    mfaEnabledAt: null,
    ...over,
  });

  beforeEach(() => {
    prisma = mockPrisma();
    redis = mockRedis();
    security = mockSecurity();
    audit = mockAudit();
    throttle = new LoginThrottle(redis, config, security, audit);
    mfa = new MfaService(prisma, config, redis, security, audit, throttle);
  });

  it('encrypts secrets at rest (AES-256-GCM, never the raw base32) and round-trips them', () => {
    const stored = mfa.encrypt('JBSWY3DPEHPK3PXP');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(mfa.decrypt(stored)).toBe('JBSWY3DPEHPK3PXP');
    expect(mfa.encrypt('JBSWY3DPEHPK3PXP')).not.toBe(stored); // fresh IV every time
  });

  it('setup stores a PENDING secret and returns the otpauth URI; enable needs a valid code; wrong codes are rejected', async () => {
    prisma.adminUser.findUniqueOrThrow.mockResolvedValue(admin());
    prisma.adminUser.update.mockResolvedValue(admin());
    const setup = await mfa.setup(ADMIN, 'Admin123!', '1.1.1.1');
    expect(setup.otpauthUri).toContain('otpauth://totp/Gize%20Admin:finance%40rap.et');
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
    const storedSecret = prisma.adminUser.update.mock.calls[0][0].data.mfaSecret as string;
    expect(storedSecret).not.toContain(setup.secret);
    expect(prisma.adminUser.update.mock.calls[0][0].data.mfaEnabledAt).toBeNull();

    prisma.adminUser.findUniqueOrThrow.mockResolvedValue(admin({ mfaSecret: storedSecret }));
    await expect(mfa.enable(ADMIN, '000000', 'Admin123!', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.MFA_CODE_INVALID, status: 400 });
    expect(security.warn).toHaveBeenCalledWith('auth.mfa_failed', expect.objectContaining({ context: 'enable' }));

    const now = new Date();
    prisma.adminUser.update.mockResolvedValue(admin({ mfaSecret: storedSecret, mfaEnabledAt: now }));
    const res = await mfa.enable(ADMIN, authenticator.generate(setup.secret), 'Admin123!', '1.1.1.1');
    expect(res.mfaEnabled).toBe(true);
    expect(prisma.adminUser.update.mock.calls[1][0].data.mfaEnabledAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.mfa_enabled' }));
  });

  it('refuses to replay a code that was already accepted inside its window', async () => {
    const secret = authenticator.generateSecret();
    const a = admin({ mfaSecret: mfa.encrypt(secret), mfaEnabledAt: new Date() });
    const code = authenticator.generate(secret);
    await mfa.verifyForAdmin(a, code, '1.1.1.1', 'login');
    await expect(mfa.verifyForAdmin(a, code, '1.1.1.1', 'login')).rejects.toMatchObject({ code: ErrorCode.MFA_CODE_INVALID });
    expect(security.warn).toHaveBeenCalledWith('auth.mfa_failed', expect.objectContaining({ reason: 'replay' }));
  });

  it('Phase 5b New-5: the replay guard fails closed (503) in closed mode and open (accept + security event) otherwise', async () => {
    const secret = authenticator.generateSecret();
    const a = admin({ mfaSecret: mfa.encrypt(secret), mfaEnabledAt: new Date() });
    redis.client.set.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(mfa.verifyForAdmin(a, authenticator.generate(secret), '1.1.1.1', 'login')).resolves.toBeUndefined();
    expect(security.error).toHaveBeenCalledWith('auth.denylist_unavailable', expect.objectContaining({ scope: 'mfa_replay_guard', failMode: 'open' }));
    const closed = new MfaService(prisma, testConfig({ ADMIN_MFA_REQUIRED: true, MFA_ENCRYPTION_KEY: 'unit-test-mfa-key', SECURITY_REDIS_FAIL_MODE: 'closed' }), redis, security, audit, throttle);
    await expect(closed.verifyForAdmin(a, authenticator.generate(secret), '1.1.1.1', 'login')).rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE, status: 503 });
  });

  it('New-7: setup and enable require the current password (401), wrong passwords count toward the lockout', async () => {
    prisma.adminUser.findUniqueOrThrow.mockResolvedValue(admin());
    await expect(mfa.setup(ADMIN, 'wrong-password', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS, status: 401 });
    expect(prisma.adminUser.update).not.toHaveBeenCalled();
    expect(security.warn).toHaveBeenCalledWith('auth.invalid_credentials', expect.objectContaining({ action: 'mfa_setup' }));
    const secret = authenticator.generateSecret();
    prisma.adminUser.findUniqueOrThrow.mockResolvedValue(admin({ mfaSecret: mfa.encrypt(secret) }));
    await expect(mfa.enable(ADMIN, authenticator.generate(secret), 'wrong-password', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    // 5 password failures across the MFA endpoints lock the account like 5 failed logins would
    for (let i = 0; i < 3; i++) await expect(mfa.setup(ADMIN, 'wrong-password', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    await expect(mfa.setup(ADMIN, 'Admin123!', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_LOCKED, status: 423 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.login_locked', targetId: ADMIN }));
  });

  it('REGRESSION New-7: TOTP codes on enable / disable are throttled - 5 wrong codes lock the account (no 6-digit brute force)', async () => {
    const secret = authenticator.generateSecret();
    prisma.adminUser.findUniqueOrThrow.mockResolvedValue(admin({ mfaSecret: mfa.encrypt(secret) }));
    for (let i = 0; i < 5; i++) {
      await expect(mfa.enable(ADMIN, '000000', 'Admin123!', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.MFA_CODE_INVALID });
    }
    await expect(mfa.enable(ADMIN, authenticator.generate(secret), 'Admin123!', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_LOCKED, status: 423 });
    expect(prisma.adminUser.update).not.toHaveBeenCalled();
    expect(security.warn).toHaveBeenCalledWith('auth.account_locked', expect.objectContaining({ account: 'finance@rap.et' }));
  });

  it('disable requires MFA to be on, the password AND a valid code', async () => {
    prisma.adminUser.findUniqueOrThrow.mockResolvedValue(admin());
    await expect(mfa.disable(ADMIN, '123456', 'pw', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.MFA_NOT_ENABLED });
    const secret = authenticator.generateSecret();
    const bcrypt = await import('bcryptjs');
    const enabled = admin({ mfaSecret: mfa.encrypt(secret), mfaEnabledAt: new Date(), passwordHash: await bcrypt.hash('Admin123!', 4) });
    prisma.adminUser.findUniqueOrThrow.mockResolvedValue(enabled);
    await expect(mfa.disable(ADMIN, authenticator.generate(secret), 'wrong', '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    await expect(mfa.disable(ADMIN, authenticator.generate(secret), 'Admin123!', '1.1.1.1')).resolves.toMatchObject({ mfaEnabled: false });
    expect(prisma.adminUser.update).toHaveBeenCalledWith(expect.objectContaining({ data: { mfaSecret: null, mfaEnabledAt: null } }));
    expect(security.warn).toHaveBeenCalledWith('auth.mfa_disabled', expect.anything());
  });

  it('setupRequiredFor: only finance / super_admin without an enabled secret, and only when ADMIN_MFA_REQUIRED', () => {
    expect(mfa.setupRequiredFor({ role: 'finance', mfaEnabledAt: null })).toBe(true);
    expect(mfa.setupRequiredFor({ role: 'super_admin', mfaEnabledAt: null })).toBe(true);
    expect(mfa.setupRequiredFor({ role: 'support', mfaEnabledAt: null })).toBe(false);
    expect(mfa.setupRequiredFor({ role: 'finance', mfaEnabledAt: new Date() })).toBe(false);
    const off = new MfaService(prisma, testConfig({ ADMIN_MFA_REQUIRED: false }), redis, security, audit, throttle);
    expect(off.setupRequiredFor({ role: 'super_admin', mfaEnabledAt: null })).toBe(false);
  });
});
