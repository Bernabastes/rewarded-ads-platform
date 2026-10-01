import { ErrorCode } from '@rap/shared';
import { mockAudit, mockPrisma, mockRedis, mockSecurity, testConfig, uuid } from '../../../testing/test-utils';
import { OtpVerifier } from '../../auth/otp.verifier';
import { DestinationNotFoundError, mockAccountName, mockDestinationExists } from '../providers/payout-provider';
import { DestinationsService } from './destinations.service';

const USER = uuid(1);
const input = { payoutMethod: 'telebirr' as const, destination: '+251911223344' };

describe('DestinationsService (withdrawal destination verification)', () => {
  let prisma: any;
  let registry: any;
  let security: any;
  let alerts: any;
  let service: DestinationsService;
  const config = testConfig({ DESTINATION_RESOLVE_TTL_MINUTES: 10, NODE_ENV: 'development', DESTINATION_LOOKUPS_PER_DAY: 5 });
  const now = new Date('2026-09-28T10:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  beforeEach(() => {
    prisma = mockPrisma();
    security = mockSecurity();
    alerts = { raise: jest.fn().mockResolvedValue({ id: 'alert-1' }) };
    registry = {
      isMethodAvailable: jest.fn().mockReturnValue(true),
      resolveWithFailover: jest.fn().mockResolvedValue({
        provider: { name: 'telebirr', isMock: true },
        result: { accountName: 'Abebe Tesfaye', normalizedDestination: '+251911223344' },
      }),
    };
    const redis = mockRedis();
    service = new DestinationsService(
      prisma,
      config,
      registry,
      redis,
      security,
      mockAudit(),
      new OtpVerifier(prisma, redis, config, mockSecurity()),
      alerts,
      { sendOtp: jest.fn() } as any,
    );
    // atomic attempt claim / consume used by the OtpVerifier (the mocked table has a single row)
    prisma.otpCode.updateMany.mockImplementation(async ({ where }: any) => ({ count: where.attempts?.gte !== undefined ? 0 : 1 }));
    prisma.payoutDestination.upsert.mockImplementation(async ({ create, update }: any) => ({
      id: uuid(5),
      userId: USER,
      lastUsedAt: null,
      otpVerifiedAt: null,
      verifiedAt: null,
      useCount: 0,
      bankCode: null,
      accountName: null,
      ...create,
      ...update,
    }));
  });

  describe('assertVerifiedForRequest', () => {
    it('lets a KNOWN destination (used before) through without any fresh checks', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({
        id: uuid(5),
        lastUsedAt: minutesAgo(60 * 24 * 30),
        verifiedAt: minutesAgo(60 * 24 * 30),
        otpVerifiedAt: null,
        accountName: 'Abebe Tesfaye',
      });
      const row = await service.assertVerifiedForRequest(USER, input, now);
      expect(row.id).toBe(uuid(5));
    });

    it('rejects a NEW destination that was never resolved with DESTINATION_NOT_VERIFIED', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue(null);
      await expect(service.assertVerifiedForRequest(USER, input, now)).rejects.toMatchObject({
        code: ErrorCode.DESTINATION_NOT_VERIFIED,
        status: 422,
      });
    });

    it('rejects when the lookup is older than the TTL (10 min)', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({
        id: uuid(5),
        lastUsedAt: null,
        verifiedAt: minutesAgo(11),
        otpVerifiedAt: minutesAgo(1),
      });
      await expect(service.assertVerifiedForRequest(USER, input, now)).rejects.toMatchObject({
        code: ErrorCode.DESTINATION_NOT_VERIFIED,
      });
    });

    it('rejects a fresh lookup without the OTP re-check with DESTINATION_OTP_REQUIRED', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({
        id: uuid(5),
        lastUsedAt: null,
        verifiedAt: minutesAgo(2),
        otpVerifiedAt: null,
      });
      await expect(service.assertVerifiedForRequest(USER, input, now)).rejects.toMatchObject({
        code: ErrorCode.DESTINATION_OTP_REQUIRED,
        status: 422,
      });
    });

    it('rejects when the OTP re-check is stale even if the lookup is fresh', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({
        id: uuid(5),
        lastUsedAt: null,
        verifiedAt: minutesAgo(1),
        otpVerifiedAt: minutesAgo(15),
      });
      await expect(service.assertVerifiedForRequest(USER, input, now)).rejects.toMatchObject({
        code: ErrorCode.DESTINATION_OTP_REQUIRED,
      });
    });

    it('accepts a NEW destination with both a fresh lookup and a fresh OTP re-check', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({
        id: uuid(5),
        lastUsedAt: null,
        verifiedAt: minutesAgo(3),
        otpVerifiedAt: minutesAgo(1),
        accountName: 'Abebe Tesfaye',
      });
      await expect(service.assertVerifiedForRequest(USER, input, now)).resolves.toMatchObject({
        accountName: 'Abebe Tesfaye',
      });
    });
  });

  describe('findKnownById (POST /withdrawals { payoutDestinationId })', () => {
    it('returns a KNOWN destination the user owns for the requested method', async () => {
      prisma.payoutDestination.findFirst.mockResolvedValue({
        id: uuid(5),
        userId: USER,
        payoutMethod: 'telebirr',
        destination: '+251911223344',
        lastUsedAt: minutesAgo(5000),
        accountName: 'Abebe Tesfaye',
      });
      const row = await service.findKnownById(USER, uuid(5), 'telebirr');
      expect(row.destination).toBe('+251911223344');
      expect(prisma.payoutDestination.findFirst).toHaveBeenCalledWith({ where: { id: uuid(5), userId: USER } });
    });

    it("rejects ids that do not belong to the user or belong to another method", async () => {
      prisma.payoutDestination.findFirst.mockResolvedValueOnce(null);
      await expect(service.findKnownById(USER, uuid(6), 'telebirr')).rejects.toMatchObject({
        code: ErrorCode.INVALID_PAYOUT_DESTINATION,
        status: 400,
      });
      prisma.payoutDestination.findFirst.mockResolvedValueOnce({ id: uuid(5), userId: USER, payoutMethod: 'bank', lastUsedAt: new Date() });
      await expect(service.findKnownById(USER, uuid(5), 'telebirr')).rejects.toMatchObject({
        code: ErrorCode.INVALID_PAYOUT_DESTINATION,
      });
    });

    it('refuses a destination that was resolved but never used (must go through the full-number flow)', async () => {
      prisma.payoutDestination.findFirst.mockResolvedValue({ id: uuid(5), userId: USER, payoutMethod: 'telebirr', lastUsedAt: null });
      await expect(service.findKnownById(USER, uuid(5), 'telebirr')).rejects.toMatchObject({
        code: ErrorCode.DESTINATION_NOT_VERIFIED,
        status: 422,
      });
    });
  });

  describe('verifyOtp (destination_change)', () => {
    it('answers 400 (not 401) for a wrong or missing code: business errors are never token errors', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ phoneNumber: '+251911000000' });
      prisma.otpCode.findFirst.mockResolvedValueOnce(null);
      await expect(service.verifyOtp(USER, '123456', input, '1.1.1.1')).rejects.toMatchObject({
        code: ErrorCode.OTP_INVALID,
        status: 400,
      });
      prisma.otpCode.findFirst.mockResolvedValueOnce({
        id: 'otp-1',
        codeHash: 'nope',
        attempts: 0,
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(service.verifyOtp(USER, '000000', input, '1.1.1.1')).rejects.toMatchObject({
        code: ErrorCode.OTP_INVALID,
        status: 400,
        details: { attemptsRemaining: 4 },
      });
      prisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'otp-2', codeHash: 'x', attempts: 0, expiresAt: new Date(Date.now() - 1) });
      await expect(service.verifyOtp(USER, '000000', input, '1.1.1.1')).rejects.toMatchObject({
        code: ErrorCode.OTP_EXPIRED,
        status: 400,
      });
    });
  });

  describe('resolve (security audit #11: OTP before lookup, per-user cap, per-IP alert)', () => {
    it('a NEW destination is NOT looked up: no partner call, no name, otpRequired=true, intent stored', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue(null);
      const result = await service.resolve(USER, input, '1.1.1.1');
      expect(registry.resolveWithFailover).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        accountName: null,
        normalizedDestination: '+251911223344',
        provider: null,
        known: false,
        otpRequired: true,
        lookupPerformed: false,
        lookupsRemainingToday: 5,
      });
      expect(prisma.payoutDestination.upsert.mock.calls[0][0].create.verifiedAt).toBeUndefined();
      expect(security.info).toHaveBeenCalledWith('destination.lookup_deferred', expect.objectContaining({ userId: USER }));
    });

    it('a previously used (KNOWN) destination is looked up directly and needs no OTP', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({ id: uuid(5), lastUsedAt: minutesAgo(1000), otpVerifiedAt: null, verifiedAt: null });
      prisma.payoutDestination.upsert.mockResolvedValueOnce({
        id: uuid(5),
        destination: '+251911223344',
        payoutMethod: 'telebirr',
        accountName: 'Abebe Tesfaye',
        lastUsedAt: minutesAgo(1000),
        otpVerifiedAt: null,
      });
      const result = await service.resolve(USER, input, '1.1.1.1');
      expect(registry.resolveWithFailover).toHaveBeenCalledWith('telebirr', '+251911223344', undefined);
      expect(result).toMatchObject({ accountName: 'Abebe Tesfaye', known: true, otpRequired: false, lookupPerformed: true, provider: 'telebirr', mock: true });
      expect(result.lookupsRemainingToday).toBe(4);
    });

    it('a destination whose OTP re-check is fresh is looked up and the name revealed', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({ id: uuid(5), lastUsedAt: null, otpVerifiedAt: new Date(), verifiedAt: null });
      const result = await service.resolve(USER, input, '1.1.1.1');
      expect(registry.resolveWithFailover).toHaveBeenCalled();
      expect(result.accountName).toBe('Abebe Tesfaye');
      expect(result.lookupPerformed).toBe(true);
      expect(prisma.payoutDestination.upsert.mock.calls[0][0].create.verifiedAt).toBeInstanceOf(Date);
    });

    it('maps an unknown account to 422 DESTINATION_NOT_FOUND and partner outages to 503', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({ id: uuid(5), lastUsedAt: new Date(), otpVerifiedAt: null, verifiedAt: null });
      registry.resolveWithFailover.mockRejectedValueOnce(new DestinationNotFoundError());
      await expect(service.resolve(USER, input, '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.DESTINATION_NOT_FOUND, status: 422 });
      registry.resolveWithFailover.mockRejectedValueOnce(new Error('timeout'));
      await expect(service.resolve(USER, input, '1.1.1.1')).rejects.toMatchObject({ status: 503 });
    });

    it('caps partner lookups per user per day (429 DESTINATION_LOOKUP_LIMIT) - failed lookups count too', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({ id: uuid(5), lastUsedAt: new Date(), otpVerifiedAt: null, verifiedAt: null });
      for (let i = 0; i < 5; i++) await service.resolve(USER, { ...input, destination: `+25191122334${i}` }, '1.1.1.1');
      await expect(service.resolve(USER, { ...input, destination: '+251911223399' }, '1.1.1.1')).rejects.toMatchObject({
        code: ErrorCode.DESTINATION_LOOKUP_LIMIT,
        status: 429,
        details: { limit: 5 },
      });
      expect(registry.resolveWithFailover).toHaveBeenCalledTimes(5);
      expect(security.warn).toHaveBeenCalledWith('destination.lookup_rate_limited', expect.objectContaining({ userId: USER, count: 6 }));
    });

    it('Phase 5b New-5: the daily cap fails open outside production (security event) and CLOSED (503) in closed mode', async () => {
      prisma.payoutDestination.findUnique.mockResolvedValue({ id: uuid(5), lastUsedAt: new Date(), otpVerifiedAt: null, verifiedAt: null });
      const brokenRedis = mockRedis();
      brokenRedis.incrWithTtl.mockRejectedValue(new Error('ECONNREFUSED'));
      const open = new DestinationsService(prisma, config, registry, brokenRedis, security, mockAudit(), new OtpVerifier(prisma, mockRedis(), config, mockSecurity()), alerts, { sendOtp: jest.fn() } as any);
      await expect(open.resolve(USER, input, '1.1.1.1')).resolves.toMatchObject({ lookupPerformed: true });
      expect(security.error).toHaveBeenCalledWith('auth.denylist_unavailable', expect.objectContaining({ scope: 'destination_lookup_cap', failMode: 'open' }));
      const closedConfig = testConfig({ SECURITY_REDIS_FAIL_MODE: 'closed' });
      const closed = new DestinationsService(prisma, closedConfig, registry, brokenRedis, security, mockAudit(), new OtpVerifier(prisma, mockRedis(), closedConfig, mockSecurity()), alerts, { sendOtp: jest.fn() } as any);
      registry.resolveWithFailover.mockClear();
      await expect(closed.resolve(USER, input, '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE, status: 503 });
      expect(registry.resolveWithFailover).not.toHaveBeenCalled();
    });

    it('raises DESTINATION_LOOKUP_SPIKE once when one IP crosses the hourly threshold', async () => {
      const spiky = new DestinationsService(
        prisma,
        testConfig({ DESTINATION_LOOKUPS_PER_DAY: 100, ALERT_DESTINATION_LOOKUPS_PER_IP_PER_HOUR: 2 }),
        registry,
        mockRedis(),
        security,
        mockAudit(),
        new OtpVerifier(prisma, mockRedis(), config, mockSecurity()),
        alerts,
        { sendOtp: jest.fn() } as any,
      );
      prisma.payoutDestination.findUnique.mockResolvedValue({ id: uuid(5), lastUsedAt: new Date(), otpVerifiedAt: null, verifiedAt: null });
      for (let i = 0; i < 4; i++) await spiky.resolve(uuid(10 + i), input, '7.7.7.7');
      expect(alerts.raise).toHaveBeenCalledTimes(1);
      expect(alerts.raise).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DESTINATION_LOOKUP_SPIKE', severity: 'warning', dedupeKey: 'destination_lookup_spike:7.7.7.7', payload: expect.objectContaining({ ip: '7.7.7.7', lookups: 3 }) }),
      );
    });
  });

  describe('verifyOtp performs the deferred lookup (security audit #11)', () => {
    it('after a valid code the partner is asked and the holder name is returned', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ phoneNumber: '+251911000000' });
      const { sha256 } = await import('../../../common/utils');
      prisma.otpCode.findFirst.mockResolvedValueOnce({
        id: 'otp-1',
        codeHash: sha256('+251911000000:destination_change:246810'),
        attempts: 0,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const result = await service.verifyOtp(USER, '246810', input, '1.1.1.1');
      expect(registry.resolveWithFailover).toHaveBeenCalledWith('telebirr', '+251911223344', undefined);
      expect(result).toMatchObject({ accountName: 'Abebe Tesfaye', normalizedDestination: '+251911223344', provider: 'telebirr', mock: true, known: false });
      expect(result.validUntil).toBeInstanceOf(Date);
      // the OTP upsert came first, the lookup upsert second (verifiedAt + accountName)
      expect(prisma.payoutDestination.upsert.mock.calls[0][0].create.otpVerifiedAt).toBeInstanceOf(Date);
      expect(prisma.payoutDestination.upsert.mock.calls[1][0].update.accountName).toBe('Abebe Tesfaye');
    });

    it('a wrong code never triggers a partner lookup', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ phoneNumber: '+251911000000' });
      prisma.otpCode.findFirst.mockResolvedValueOnce({ id: 'otp-1', codeHash: 'nope', attempts: 0, expiresAt: new Date(Date.now() + 60_000) });
      await expect(service.verifyOtp(USER, '000000', input, '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.OTP_INVALID });
      expect(registry.resolveWithFailover).not.toHaveBeenCalled();
    });
  });

  describe('mock account lookup', () => {
    it('is deterministic and realistic', () => {
      expect(mockAccountName('+251911223344')).toBe(mockAccountName('+251911223344'));
      expect(mockAccountName('+251911223344')).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(mockAccountName('+251911223344')).not.toBe(mockAccountName('+251911223345'));
    });

    it('treats destinations ending in 0000 as unknown so the failure path can be demoed', () => {
      expect(mockDestinationExists('+251911220000')).toBe(false);
      expect(mockDestinationExists('+251911223344')).toBe(true);
    });
  });
});
