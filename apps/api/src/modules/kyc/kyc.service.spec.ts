import { ErrorCode } from '@rap/shared';
import { D, mockAudit, mockNotifications, mockPrisma, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { MockFaydaProvider } from './id-verification.provider';
import { KycService } from './kyc.service';

describe('KycService', () => {
  let prisma: any;
  let service: KycService;
  const config = testConfig({ KYC_REQUIRED_ABOVE_MONTHLY_ETB: 1000 });

  beforeEach(() => {
    prisma = mockPrisma();
    service = new KycService(
      prisma,
      config,
      { presignUpload: jest.fn(), presignDownload: jest.fn(), buildKey: jest.fn() } as any,
      mockAudit(),
      mockSecurity(),
      mockNotifications(),
      { resolveDateOfBirth: () => new Date('1990-05-14T00:00:00Z') } as any,
      new MockFaydaProvider(),
    );
  });

  describe('threshold rule (rolling 30 days, incl. the new request; boundary is inclusive)', () => {
    it('allows phone_only users while the projected total stays strictly below the threshold', () => {
      expect(service.evaluateThreshold({ kycTier: 'phone_only', monthlyTotalEtb: 400, newAmountEtb: 500 })).toBeNull();
      expect(service.evaluateThreshold({ kycTier: 'phone_only', monthlyTotalEtb: 0, newAmountEtb: D('999.99') })).toBeNull();
      expect(service.evaluateThreshold({ kycTier: 'phone_only', monthlyTotalEtb: D('949.99'), newAmountEtb: 50 })).toBeNull();
    });

    it('requires KYC when the projected total is exactly the threshold (>= 1000 ETB), even with zero prior payouts', () => {
      const v = service.evaluateThreshold({ kycTier: 'phone_only', monthlyTotalEtb: 0, newAmountEtb: 1000 });
      expect(v).toMatchObject({ kycTier: 'phone_only', monthlyTotalEtb: 0, requestedEtb: 1000, thresholdEtb: 1000, projectedEtb: 1000 });
      expect(service.evaluateThreshold({ kycTier: 'phone_only', monthlyTotalEtb: 400, newAmountEtb: 600 })).not.toBeNull();
    });

    it('blocks phone_only users once completed + in-flight + new exceeds the threshold', () => {
      const v = service.evaluateThreshold({ kycTier: 'phone_only', monthlyTotalEtb: D('950.50'), newAmountEtb: D('60') });
      expect(v).toMatchObject({ kycTier: 'phone_only', monthlyTotalEtb: 950.5, requestedEtb: 60, thresholdEtb: 1000, projectedEtb: 1010.5 });
    });

    it('never blocks id_verified users, including exactly at the threshold', () => {
      expect(service.evaluateThreshold({ kycTier: 'id_verified', monthlyTotalEtb: 50_000, newAmountEtb: 5_000 })).toBeNull();
      expect(service.evaluateThreshold({ kycTier: 'id_verified', monthlyTotalEtb: 0, newAmountEtb: 1000 })).toBeNull();
    });

    it('assertWithinTier sums completed + pending/processing/flagged withdrawals of the last 30 days and throws 422 KYC_REQUIRED', async () => {
      prisma.withdrawal.aggregate.mockResolvedValue({ _sum: { amountEtb: D('980') } });
      await expect(service.assertWithinTier(uuid(1), 'phone_only', D('50'))).rejects.toMatchObject({
        code: ErrorCode.KYC_REQUIRED,
        status: 422,
        message: 'Payouts of 1000 ETB or more per 30 days require identity verification',
        details: expect.objectContaining({ projectedEtb: 1030 }),
      });
      const where = prisma.withdrawal.aggregate.mock.calls[0][0].where;
      expect(where.status.in).toEqual(expect.arrayContaining(['completed', 'pending', 'processing', 'flagged_for_review']));
      expect(where.status.in).not.toContain('failed');
      expect(where.requestedAt.gte).toBeInstanceOf(Date);
    });

    it('assertWithinTier throws at exactly the threshold with no prior payouts', async () => {
      prisma.withdrawal.aggregate.mockResolvedValue({ _sum: { amountEtb: null } });
      await expect(service.assertWithinTier(uuid(1), 'phone_only', D('1000'))).rejects.toMatchObject({
        code: ErrorCode.KYC_REQUIRED,
        details: expect.objectContaining({ monthlyTotalEtb: 0, projectedEtb: 1000 }),
      });
    });

    it('assertWithinTier passes and returns the monthly total when under the threshold', async () => {
      prisma.withdrawal.aggregate.mockResolvedValue({ _sum: { amountEtb: D('200') } });
      await expect(service.assertWithinTier(uuid(1), 'phone_only', D('50'))).resolves.toEqual(D('200'));
      prisma.withdrawal.aggregate.mockResolvedValue({ _sum: { amountEtb: D('949.99') } });
      await expect(service.assertWithinTier(uuid(1), 'phone_only', D('50'))).resolves.toEqual(D('949.99'));
    });
  });

  describe('submit', () => {
    beforeEach(() => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: uuid(1), kycTier: 'phone_only', fullName: 'Abebe Bikila' });
      prisma.kycSubmission.findFirst.mockResolvedValue(null);
      prisma.kycSubmission.count.mockResolvedValue(0);
      prisma.kycSubmission.create.mockImplementation(async ({ data }: any) => ({
        id: uuid(7),
        status: 'pending',
        reviewedAt: null,
        reason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }));
    });

    const dto = {
      idType: 'fayda' as const,
      idNumber: '1234 5678 9012 3456',
      fullName: 'Abebe Bikila',
      dateOfBirth: '1990-05-14',
      documentFrontKey: `private/kyc/${uuid(1)}/document_front/x.jpg`,
      selfieKey: `private/kyc/${uuid(1)}/selfie/y.jpg`,
    };

    it('stores only a hash + last 4 digits of the id number and the mock provider pre-check', async () => {
      const result = await service.submit(uuid(1), dto, '1.1.1.1');
      const data = prisma.kycSubmission.create.mock.calls[0][0].data;
      expect(data.idNumberHash).toMatch(/^[a-f0-9]{64}$/);
      expect(data.idNumberLast4).toBe('3456');
      expect(JSON.stringify(data)).not.toContain('1234567890123456');
      expect(data.providerResult).toMatchObject({ provider: 'fayda', mock: true, found: true, score: 0.97 });
      expect(result.status).toBe('pending');
    });

    it('refuses a second pending submission (409 KYC_SUBMISSION_PENDING)', async () => {
      prisma.kycSubmission.findFirst.mockResolvedValue({ id: uuid(8), status: 'pending' });
      await expect(service.submit(uuid(1), dto, '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.KYC_SUBMISSION_PENDING });
    });

    it('refuses when already id_verified', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: uuid(1), kycTier: 'id_verified' });
      await expect(service.submit(uuid(1), dto, '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.KYC_ALREADY_VERIFIED });
    });

    it('rejects document keys outside the caller\'s private KYC prefix', async () => {
      await expect(
        service.submit(uuid(1), { ...dto, selfieKey: 'creatives/public/x.jpg' }, '1.1.1.1'),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it('opens a HIGH fraud flag when the same id document was used by another account', async () => {
      prisma.kycSubmission.count.mockResolvedValue(2);
      await service.submit(uuid(1), dto, '1.1.1.1');
      expect(prisma.fraudFlag.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ flagType: 'KYC_DUPLICATE_IDENTITY', severity: 'high' }) }),
      );
    });
  });

  describe('decide', () => {
    const row = {
      id: uuid(7),
      userId: uuid(1),
      status: 'pending',
      idType: 'fayda',
      idNumberLast4: '3456',
      fullName: 'Abebe Bikila',
      dateOfBirth: new Date('1990-05-14T00:00:00Z'),
      providerName: 'fayda',
      providerResult: {},
      reviewedAt: null,
      reason: null,
      reviewedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { id: uuid(1), phoneNumber: '+251911000000', fullName: 'Abebe Bikila', kycTier: 'phone_only', trustScore: 60, dateOfBirth: null },
    };

    beforeEach(() => {
      prisma.kycSubmission.findUnique.mockResolvedValue(row);
      prisma.kycSubmission.updateMany.mockResolvedValue({ count: 1 });
      prisma.kycSubmission.findUniqueOrThrow.mockResolvedValue({ ...row, status: 'approved' });
    });

    it('approve promotes the user to id_verified in the same transaction and notifies', async () => {
      await service.decide(uuid(7), 'approved', { adminId: uuid(9) });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: uuid(1) }, data: { kycTier: 'id_verified' } });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('reject requires a reason and does not change the tier', async () => {
      await expect(service.decide(uuid(7), 'rejected', { adminId: uuid(9) })).rejects.toMatchObject({
        code: ErrorCode.REJECTION_REASON_REQUIRED,
      });
      prisma.kycSubmission.findUniqueOrThrow.mockResolvedValue({ ...row, status: 'rejected', reason: 'blurry' });
      await service.decide(uuid(7), 'rejected', { adminId: uuid(9) }, 'blurry');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to decide a non-pending submission', async () => {
      prisma.kycSubmission.findUnique.mockResolvedValue({ ...row, status: 'approved' });
      await expect(service.decide(uuid(7), 'approved', { adminId: uuid(9) })).rejects.toMatchObject({ code: ErrorCode.KYC_NOT_PENDING });
    });
  });

  describe('adminDetail', () => {
    it('lists the other accounts that used the same id number (array + compatibility count) and presigns documents', async () => {
      const row = {
        id: uuid(7),
        userId: uuid(1),
        idNumberHash: 'h',
        idType: 'fayda',
        idNumberLast4: '3456',
        fullName: 'Abebe Bikila',
        dateOfBirth: new Date('1990-05-14T00:00:00Z'),
        documentFrontKey: 'private/kyc/a/front.png',
        documentBackKey: null,
        selfieKey: 'private/kyc/a/selfie.png',
        status: 'pending',
        providerName: 'fayda',
        providerResult: {},
        reviewedAt: null,
        reviewedBy: null,
        reason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: uuid(1), phoneNumber: '+251911000000', fullName: 'abebe  bikila', kycTier: 'phone_only', trustScore: 60, dateOfBirth: new Date('1990-05-14T00:00:00Z') },
      };
      prisma.kycSubmission.findUnique.mockResolvedValue(row);
      prisma.kycSubmission.findMany.mockResolvedValue([
        { status: 'approved', user: { id: uuid(20), phoneNumber: '+251911000020' } },
        { status: 'pending', user: { id: uuid(20), phoneNumber: '+251911000020' } }, // same account twice -> one entry
        { status: 'pending', user: { id: uuid(21), phoneNumber: '+251911000021' } },
      ]);
      const storage = (service as any).storage;
      storage.presignDownload.mockResolvedValue({ url: 'https://minio/signed', expiresInSeconds: 300 });

      const detail = await service.adminDetail(uuid(7));
      expect(detail.duplicateIdentityUsers).toEqual([
        { id: uuid(20), phoneNumber: '+251911000020', kycStatus: 'approved' },
        { id: uuid(21), phoneNumber: '+251911000021', kycStatus: 'pending' },
      ]);
      expect(detail.duplicateIdentityCount).toBe(2);
      expect(detail.profileMatch).toEqual({ fullName: true, dateOfBirth: true });
      expect(detail.documents.front.url).toBe('https://minio/signed');
      expect(detail.documents.back).toBeNull();
    });
  });

  describe('MockFaydaProvider', () => {
    const p = new MockFaydaProvider();
    it('is deterministic from the id number tail', async () => {
      const base = { idType: 'fayda' as const, fullName: 'X', dateOfBirth: new Date() };
      expect((await p.verify({ ...base, idNumber: '123400' })).found).toBe(false);
      expect(await p.verify({ ...base, idNumber: '123499' })).toMatchObject({ found: true, score: 0.4, match: { fullName: false } });
      expect(await p.verify({ ...base, idNumber: '123456' })).toMatchObject({ found: true, score: 0.97 });
    });
  });
});
