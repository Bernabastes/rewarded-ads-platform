import { ErrorCode } from '@rap/shared';
import { mockAudit, mockNotifications, mockPrisma, mockQueue, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { anonymizedUserData, DataRightsService } from './data-rights.service';

const USER = uuid(1);
const REQ = uuid(2);

describe('DataRightsService (deletion + anonymisation)', () => {
  let prisma: any;
  let service: DataRightsService;
  let tokens: any;
  let storage: any;
  const config = testConfig({ ACCOUNT_DELETION_GRACE_DAYS: 14 });

  beforeEach(() => {
    prisma = mockPrisma();
    tokens = { invalidateAccessTokens: jest.fn() };
    storage = { delete: jest.fn(), upload: jest.fn(), presignDownload: jest.fn() };
    service = new DataRightsService(
      prisma,
      config,
      storage,
      mockAudit(),
      mockSecurity(),
      mockNotifications(),
      tokens,
      { purgeExpired: jest.fn().mockResolvedValue(0) } as any,
      mockQueue(),
    );
  });

  it('anonymizedUserData removes every personal identifier but keeps the row', () => {
    const data = anonymizedUserData(USER, new Date('2026-09-28T00:00:00Z'));
    expect(data).toMatchObject({
      phoneNumber: `deleted:${USER}`,
      fullName: null,
      dateOfBirth: null,
      deviceId: null,
      lastIp: null,
      signupIp: null,
      signupDeviceFingerprint: null,
      referralCode: null,
      status: 'deleted',
    });
    expect(data.anonymizedAt).toEqual(new Date('2026-09-28T00:00:00Z'));
    // nothing here touches the ledger / balance
    expect(data).not.toHaveProperty('coinBalance');
  });

  it('requestDeletion schedules execution after the grace period', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);
    prisma.withdrawal.count.mockResolvedValue(0);
    prisma.accountDeletionRequest.create.mockImplementation(async ({ data }: any) => ({
      id: REQ,
      userId: USER,
      status: 'pending',
      requestedAt: new Date(),
      executedAt: null,
      cancelledAt: null,
      reason: null,
      ...data,
    }));
    const result = await service.requestDeletion(USER, 'leaving', '1.1.1.1');
    const days = (result.scheduledFor.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    expect(result.graceDays).toBe(14);
  });

  it('requestDeletion is blocked while withdrawals are in flight', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);
    prisma.withdrawal.count.mockResolvedValue(1);
    await expect(service.requestDeletion(USER, undefined, '1.1.1.1')).rejects.toMatchObject({
      code: ErrorCode.DELETION_BLOCKED_PENDING_WITHDRAWALS,
    });
  });

  it('only one pending request per user', async () => {
    prisma.accountDeletionRequest.findFirst.mockResolvedValue({ id: REQ, scheduledFor: new Date() });
    await expect(service.requestDeletion(USER, undefined, '1.1.1.1')).rejects.toMatchObject({ code: ErrorCode.DELETION_REQUEST_PENDING });
  });

  describe('execute', () => {
    beforeEach(() => {
      prisma.accountDeletionRequest.findUnique.mockResolvedValue({
        id: REQ,
        userId: USER,
        status: 'pending',
        user: { phoneNumber: '+251911000000', status: 'active' },
      });
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.accountDeletionRequest.findUniqueOrThrow.mockResolvedValue({
        id: REQ,
        userId: USER,
        status: 'executed',
        reason: null,
        requestedAt: new Date(),
        scheduledFor: new Date(),
        executedAt: new Date(),
        cancelledAt: null,
      });
      prisma.withdrawal.count.mockResolvedValue(0);
      prisma.kycSubmission.findMany.mockResolvedValue([{ documentFrontKey: 'private/kyc/a', documentBackKey: null, selfieKey: 'private/kyc/b' }]);
      prisma.dataExportRequest.findMany.mockResolvedValue([{ storageKey: 'private/exports/x.json.gz' }]);
      prisma.devicePushToken.deleteMany.mockResolvedValue({ count: 1 });
      prisma.notification.deleteMany.mockResolvedValue({ count: 1 });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.adWatchSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.payoutDestination.deleteMany.mockResolvedValue({ count: 1 });
      prisma.kycSubmission.updateMany.mockResolvedValue({ count: 1 });
      prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
    });

    it('anonymises PII, kills sessions/tokens, deletes documents, but never touches ledger/completions/audit', async () => {
      const result = await service.execute(REQ, { actorType: 'admin', actorId: uuid(9), ip: '1.1.1.1' });
      expect(result.status).toBe('executed');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER },
        data: expect.objectContaining({ phoneNumber: `deleted:${USER}`, status: 'deleted', fullName: null }),
      });
      expect(prisma.devicePushToken.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(prisma.kycSubmission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ documentFrontKey: 'deleted', selfieKey: 'deleted' }) }),
      );
      expect(prisma.withdrawal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ payoutDestination: 'anonymized' }) }),
      );
      expect(tokens.invalidateAccessTokens).toHaveBeenCalledWith('user', USER, 'account_deleted');
      expect(storage.delete).toHaveBeenCalledWith('private/kyc/a');
      expect(storage.delete).toHaveBeenCalledWith('private/kyc/b');
      expect(storage.delete).toHaveBeenCalledWith('private/exports/x.json.gz');
      // retained financial records
      expect(prisma.coinLedger.deleteMany).not.toHaveBeenCalled();
      expect(prisma.coinLedger.updateMany).not.toHaveBeenCalled();
      expect(prisma.adCompletion.deleteMany).not.toHaveBeenCalled();
      expect(prisma.withdrawal.deleteMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    });

    it('is blocked while withdrawals are in flight', async () => {
      prisma.withdrawal.count.mockResolvedValue(2);
      await expect(service.execute(REQ, { actorType: 'system' })).rejects.toMatchObject({
        code: ErrorCode.DELETION_BLOCKED_PENDING_WITHDRAWALS,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses non-pending requests', async () => {
      prisma.accountDeletionRequest.findUnique.mockResolvedValue({ id: REQ, userId: USER, status: 'cancelled', user: {} });
      await expect(service.execute(REQ, { actorType: 'system' })).rejects.toMatchObject({ code: ErrorCode.DELETION_REQUEST_NOT_PENDING });
    });

    /**
     * Security audit #14: after execution NO table may still carry the user's PII. The mock below applies every
     * updateMany / deleteMany the service issues to an in-memory copy of the user's rows and then greps the result.
     */
    it('scrubs PII from every table (grep after deletion finds nothing)', async () => {
      const PII = {
        phone: '+251911000000',
        ip: '197.156.64.12',
        fingerprint: 'fp-samsung-a12-9f8e7d',
        userAgent: 'RapMobile/1.4 (Android 13; SM-A125F)',
        dob: '1990-05-14',
        idLast4: '3456',
        idHash: 'hmac-of-the-national-id',
        surveyAnswer: 'I earn about 4000 birr per month',
        installProof: 'attribution-token-9f9f9f',
        fraudNote: 'same device as +251911000001',
      };
      const tables: Record<string, Array<Record<string, unknown>>> = {
        kycSubmission: [{ userId: USER, fullName: 'Abebe Bikila', dateOfBirth: new Date(PII.dob), idNumberLast4: PII.idLast4, idNumberHash: PII.idHash, documentFrontKey: 'private/kyc/a', documentBackKey: 'private/kyc/c', selfieKey: 'private/kyc/b', providerResult: { match: true } }],
        otpCode: [{ phoneNumber: PII.phone, codeHash: 'h', ipAddress: PII.ip }],
        adCompletion: [{ userId: USER, ipAddress: PII.ip, deviceFingerprint: PII.fingerprint, coinReward: 150 }],
        refreshToken: [{ subjectType: 'user', subjectId: USER, ipAddress: PII.ip, userAgent: PII.userAgent, revokedAt: null }],
        surveyResponse: [{ userId: USER, answers: { q1: PII.surveyAnswer }, ipAddress: PII.ip }],
        appInstallCompletion: [{ userId: USER, deviceFingerprint: PII.fingerprint, proof: PII.installProof }],
        referral: [{ refereeId: USER, referrerId: uuid(7), signupIp: PII.ip, signupDeviceFingerprint: PII.fingerprint }],
        fraudFlag: [{ userId: USER, metadata: { note: PII.fraudNote, ip: PII.ip } }],
        adWatchSession: [{ userId: USER, deviceFingerprint: PII.fingerprint, deviceId: 'dev-1', ipAddress: PII.ip, userAgent: PII.userAgent }],
        withdrawal: [{ userId: USER, payoutDestination: PII.phone, destinationName: 'Abebe', destinationAccountName: 'Abebe Bikila', amountEtb: 60 }],
        payoutDestination: [{ userId: USER, destination: PII.phone }],
        user: [{ id: USER, phoneNumber: PII.phone, fullName: 'Abebe Bikila', dateOfBirth: new Date(PII.dob), lastIp: PII.ip, signupIp: PII.ip, signupDeviceFingerprint: PII.fingerprint, deviceId: 'dev-1', referralCode: 'K7MP2X' }],
      };
      const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
        Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'in' in (v as object) ? ((v as { in: unknown[] }).in ?? []).includes(row[k]) : row[k] === v));
      for (const [name, rows] of Object.entries(tables)) {
        prisma[name].updateMany.mockImplementation(async ({ where, data }: any) => {
          let count = 0;
          for (const row of rows) {
            if (!matches(row, where)) continue;
            Object.assign(row, data);
            count++;
          }
          return { count };
        });
        prisma[name].update.mockImplementation(async ({ where, data }: any) => {
          for (const row of rows) if (matches(row, where)) Object.assign(row, data);
          return rows[0];
        });
        prisma[name].deleteMany.mockImplementation(async ({ where }: any) => {
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
          return { count: before - rows.length };
        });
      }
      prisma.kycSubmission.findMany.mockResolvedValue([]);
      prisma.dataExportRequest.findMany.mockResolvedValue([]);

      await service.execute(REQ, { actorType: 'system' });

      const dump = JSON.stringify(tables, (_k, v) => (v instanceof Date ? v.toISOString() : v));
      for (const [label, value] of Object.entries(PII)) {
        expect({ label, found: dump.includes(value) }).toEqual({ label, found: false });
      }
      expect(tables.otpCode).toHaveLength(0);
      expect(tables.payoutDestination).toHaveLength(0);
      // financial facts survive
      expect(tables.adCompletion[0].coinReward).toBe(150);
      expect(tables.withdrawal[0].amountEtb).toBe(60);
      expect(tables.kycSubmission[0].idNumberHash).toMatch(/^deleted:[a-f0-9]{64}$/);
    });
  });

  it('cancel by the user leaves cancelledBy empty; by an admin records the admin', async () => {
    prisma.accountDeletionRequest.findUnique.mockResolvedValue({ id: REQ, userId: USER, status: 'pending' });
    prisma.accountDeletionRequest.update.mockImplementation(async ({ data }: any) => ({
      id: REQ,
      userId: USER,
      reason: null,
      requestedAt: new Date(),
      scheduledFor: new Date(),
      executedAt: null,
      ...data,
    }));
    await service.cancel(REQ, { actorType: 'user', actorId: USER });
    expect(prisma.accountDeletionRequest.update.mock.calls[0][0].data.cancelledBy).toBeNull();
    await service.cancel(REQ, { actorType: 'admin', actorId: uuid(9), note: 'ticket 42' });
    expect(prisma.accountDeletionRequest.update.mock.calls[1][0].data).toMatchObject({ cancelledBy: uuid(9), note: 'ticket 42' });
  });
});
