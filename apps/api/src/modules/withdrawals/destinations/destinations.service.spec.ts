import { ErrorCode } from '@rap/shared';
import { mockAudit, mockPrisma, mockRedis, mockSecurity, testConfig, uuid } from '../../../testing/test-utils';
import { DestinationNotFoundError, mockAccountName, mockDestinationExists } from '../providers/payout-provider';
import { DestinationsService } from './destinations.service';

const USER = uuid(1);
const input = { payoutMethod: 'telebirr' as const, destination: '+251911223344' };

describe('DestinationsService (withdrawal destination verification)', () => {
  let prisma: any;
  let registry: any;
  let service: DestinationsService;
  const config = testConfig({ DESTINATION_RESOLVE_TTL_MINUTES: 10, NODE_ENV: 'development' });
  const now = new Date('2026-09-28T10:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  beforeEach(() => {
    prisma = mockPrisma();
    registry = {
      isMethodAvailable: jest.fn().mockReturnValue(true),
      resolveWithFailover: jest.fn().mockResolvedValue({
        provider: { name: 'telebirr', isMock: true },
        result: { accountName: 'Abebe Tesfaye', normalizedDestination: '+251911223344' },
      }),
    };
    service = new DestinationsService(prisma, config, registry, mockRedis(), mockSecurity(), mockAudit(), {
      sendOtp: jest.fn(),
    } as any);
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

  describe('resolve', () => {
    it('calls the payout partner, stores verifiedAt and reports whether an OTP is still required', async () => {
      const result = await service.resolve(USER, input, '1.1.1.1');
      expect(registry.resolveWithFailover).toHaveBeenCalledWith('telebirr', '+251911223344', undefined);
      expect(result).toMatchObject({
        accountName: 'Abebe Tesfaye',
        normalizedDestination: '+251911223344',
        provider: 'telebirr',
        mock: true,
        known: false,
        otpRequired: true,
      });
      expect(prisma.payoutDestination.upsert.mock.calls[0][0].create.verifiedAt).toBeInstanceOf(Date);
    });

    it('a previously used destination needs no OTP', async () => {
      prisma.payoutDestination.upsert.mockResolvedValueOnce({
        id: uuid(5),
        destination: '+251911223344',
        payoutMethod: 'telebirr',
        accountName: 'Abebe Tesfaye',
        lastUsedAt: minutesAgo(1000),
        otpVerifiedAt: null,
      });
      const result = await service.resolve(USER, input, '1.1.1.1');
      expect(result.known).toBe(true);
      expect(result.otpRequired).toBe(false);
    });

    it('maps an unknown account to 422 DESTINATION_NOT_FOUND', async () => {
      registry.resolveWithFailover.mockRejectedValueOnce(new DestinationNotFoundError());
      await expect(service.resolve(USER, input, '1.1.1.1')).rejects.toMatchObject({
        code: ErrorCode.DESTINATION_NOT_FOUND,
        status: 422,
      });
    });

    it('maps partner outages to 503 SERVICE_UNAVAILABLE', async () => {
      registry.resolveWithFailover.mockRejectedValueOnce(new Error('timeout'));
      await expect(service.resolve(USER, input, '1.1.1.1')).rejects.toMatchObject({ status: 503 });
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
