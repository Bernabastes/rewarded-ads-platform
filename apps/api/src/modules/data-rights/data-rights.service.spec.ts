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
