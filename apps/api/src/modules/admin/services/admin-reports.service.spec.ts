import { mockAudit, mockNotifications, mockPrisma, mockSecurity, testConfig, uuid } from '../../../testing/test-utils';
import { AdminReportsService } from './admin-reports.service';

const ADMIN = uuid(1);
const USER = uuid(2);
const ADVERTISER = uuid(3);

describe('AdminReportsService audit log (Phase 4C: actor labels + actor= filter)', () => {
  let prisma: any;
  let service: AdminReportsService;

  beforeEach(() => {
    prisma = mockPrisma();
    service = new AdminReportsService(
      prisma,
      testConfig(),
      mockAudit(),
      {} as never,
      {} as never,
      mockSecurity(),
      mockNotifications(),
      {} as never,
    );
    prisma.auditLog.count.mockResolvedValue(3);
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 'a1', actorType: 'admin', actorId: ADMIN, action: 'withdrawal.approved' },
      { id: 'a2', actorType: 'user', actorId: USER, action: 'withdrawal.requested' },
      { id: 'a3', actorType: 'system', actorId: null, action: 'withdrawal.completed' },
      { id: 'a4', actorType: 'advertiser', actorId: ADVERTISER, action: 'campaign.submitted' },
    ]);
    prisma.adminUser.findMany.mockResolvedValue([{ id: ADMIN, email: 'finance@rap.et' }]);
    prisma.user.findMany.mockResolvedValue([{ id: USER, phoneNumber: '+251911000000' }]);
    prisma.advertiser.findMany.mockResolvedValue([{ id: ADVERTISER, contactEmail: 'ads@habesha-coffee.et' }]);
  });

  it('labels every actor server-side: admin email, user phone, advertiser email, "system"', async () => {
    const page = await service.auditLog({});
    expect(page.data.map((r: any) => [r.actorType, r.actorLabel, r.actorEmail])).toEqual([
      ['admin', 'finance@rap.et', 'finance@rap.et'],
      ['user', '+251911000000', null],
      ['system', 'system', null],
      ['advertiser', 'ads@habesha-coffee.et', null],
    ]);
  });

  it('resolves actor= (admin email / user phone in any format / advertiser email / uuid) to actorId', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({ id: ADMIN, email: 'finance@rap.et' });
    expect(await service.resolveActor('Finance@rap.et')).toBe(ADMIN);
    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith({ where: { email: 'finance@rap.et' }, select: { id: true, email: true } });

    prisma.adminUser.findUnique.mockResolvedValue(null);
    prisma.advertiser.findUnique.mockResolvedValue({ id: ADVERTISER, contactEmail: 'ads@habesha-coffee.et' });
    expect(await service.resolveActor('ads@habesha-coffee.et')).toBe(ADVERTISER);
    expect(await service.resolveActorDetail('ads@habesha-coffee.et')).toEqual({ id: ADVERTISER, actorType: 'advertiser', label: 'ads@habesha-coffee.et' });

    prisma.user.findUnique.mockResolvedValue({ id: USER, phoneNumber: '+251911000000' });
    expect(await service.resolveActor('0911 000 000')).toBe(USER);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { phoneNumber: '+251911000000' }, select: { id: true, phoneNumber: true } });
    expect(await service.resolveActorDetail('0911 000 000')).toEqual({ id: USER, actorType: 'user', label: '+251911000000' });

    // a uuid is looked up across the three account tables; user matches here
    prisma.advertiser.findUnique.mockResolvedValue(null);
    expect(await service.resolveActorDetail(USER)).toEqual({ id: USER, actorType: 'user', label: '+251911000000' });
    prisma.user.findUnique.mockResolvedValue(null);
    // an unknown uuid is still usable as a raw actor id (e.g. a removed admin)
    expect(await service.resolveActorDetail(uuid(9))).toEqual({ id: uuid(9), actorType: null, label: uuid(9) });
    expect(await service.resolveActor('0911999999')).toBeNull();
    expect(await service.resolveActor('not an actor')).toBeNull();
  });

  it('actor= filters by the resolved id and describes it in meta.actor; an unknown actor yields an empty page instead of dropping the filter', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({ id: ADMIN, email: 'finance@rap.et' });
    const page = await service.auditLog({ actor: 'finance@rap.et' });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.actorId).toBe(ADMIN);
    expect(page.meta).toMatchObject({ actorResolved: true, actor: { id: ADMIN, actorType: 'admin', label: 'finance@rap.et' } });

    prisma.adminUser.findUnique.mockResolvedValue(null);
    prisma.advertiser.findUnique.mockResolvedValue(null);
    const empty = await service.auditLog({ actor: 'nobody@rap.et' });
    expect(empty.data).toEqual([]);
    expect(empty.meta.total).toBe(0);
    expect((empty.meta as any).actorResolved).toBe(false);
    expect((empty.meta as any).actor).toBeNull();
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1); // no second query
  });

  it('actorId= deep links are labelled too, and a page without an actor filter carries no actor meta', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: USER, phoneNumber: '+251911000000' });
    const byId = await service.auditLog({ actorId: USER });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.actorId).toBe(USER);
    expect(byId.meta).toMatchObject({ actorResolved: true, actor: { id: USER, actorType: 'user', label: '+251911000000' } });

    const plain = await service.auditLog({});
    expect((plain.meta as any).actorResolved).toBeUndefined();
    expect((plain.meta as any).actor).toBeUndefined();
  });
});

describe('AdminReportsService dismissFlag -> releaseFlaggedCompletion (security audit #15: atomic claim)', () => {
  const FLAG = uuid(20);
  const COMPLETION = uuid(21);
  const CAMPAIGN = uuid(22);
  let prisma: any;
  let fraud: any;
  let ledger: any;
  let service: AdminReportsService;

  beforeEach(() => {
    prisma = mockPrisma();
    fraud = { resolveFlag: jest.fn().mockResolvedValue({}), getFlag: jest.fn().mockResolvedValue({ id: FLAG, resolved: true }) };
    ledger = { applyEntry: jest.fn().mockResolvedValue({ entry: { id: uuid(30) }, balanceAfter: 1150, replayed: false }) };
    service = new AdminReportsService(prisma, testConfig(), mockAudit(), fraud, ledger, mockSecurity(), mockNotifications(), {} as never);
    prisma.fraudFlag.findUnique.mockResolvedValue({ id: FLAG, relatedEntityType: 'ad_completion', relatedEntityId: COMPLETION, resolved: false });
    prisma.fraudFlag.count.mockResolvedValue(0);
    prisma.adCompletion.findUnique.mockResolvedValue({
      id: COMPLETION,
      userId: USER,
      campaignId: CAMPAIGN,
      watchSessionId: uuid(23),
      status: 'flagged',
      campaign: { costPerActionEtb: 2, rewardPerActionEtb: 1 },
      ad: { title: 'Demo ad' },
    });
    prisma.$queryRaw.mockResolvedValue([{ id: CAMPAIGN }]);
  });

  it('claims the flagged row with updateMany(status=flagged) BEFORE charging the campaign and crediting the reward', async () => {
    prisma.adCompletion.updateMany.mockResolvedValue({ count: 1 });
    await service.dismissFlag(FLAG, 'genuine view', { adminId: ADMIN, ip: '1.1.1.1' });
    expect(prisma.adCompletion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: COMPLETION, status: 'flagged' }, data: expect.objectContaining({ status: 'valid', coinRewardAmount: 100 }) }),
    );
    expect(prisma.adCompletion.update).not.toHaveBeenCalled();
    const claimOrder = prisma.adCompletion.updateMany.mock.invocationCallOrder[0];
    expect(claimOrder).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[0]);
    expect(claimOrder).toBeLessThan(ledger.applyEntry.mock.invocationCallOrder[0]);
    expect(ledger.applyEntry).toHaveBeenCalledTimes(1);
  });

  it('the loser of a concurrent dismissal (claim count 0) credits nothing and charges nothing', async () => {
    prisma.adCompletion.updateMany.mockResolvedValue({ count: 0 });
    await service.dismissFlag(FLAG, 'genuine view', { adminId: ADMIN, ip: '1.1.1.1' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(ledger.applyEntry).not.toHaveBeenCalled();
  });

  it('an exhausted campaign budget rolls the claim back (completion stays flagged) and credits nothing', async () => {
    prisma.adCompletion.updateMany.mockResolvedValue({ count: 1 });
    prisma.$queryRaw.mockResolvedValue([]);
    let rolledBack = false;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      try {
        return await fn(prisma);
      } catch (err) {
        rolledBack = true;
        throw err;
      }
    });
    await expect(service.dismissFlag(FLAG, 'genuine view', { adminId: ADMIN, ip: '1.1.1.1' })).resolves.toBeDefined();
    expect(rolledBack).toBe(true);
    expect(ledger.applyEntry).not.toHaveBeenCalled();
  });
});

describe('AdminReportsService overview (Phase 4 queue counters)', () => {
  it('reports pendingKyc, openAlerts, pendingDeletionRequests and media pipeline counters', async () => {
    const prisma = mockPrisma();
    for (const m of ['ad', 'campaign', 'advertiser', 'withdrawal', 'coinAdjustmentRequest', 'fraudFlag', 'adReport', 'user', 'adCompletion']) {
      prisma[m].count.mockResolvedValue(1);
    }
    prisma.adCompletion.aggregate.mockResolvedValue({ _sum: { costEtb: 10, rewardEtb: 5 } });
    prisma.kycSubmission.count.mockResolvedValue(3);
    prisma.platformAlert.count.mockResolvedValue(4);
    prisma.accountDeletionRequest.count.mockResolvedValue(2);
    prisma.ad.count.mockImplementation(async ({ where }: any) =>
      where?.mediaStatus === 'processing' ? 5 : where?.mediaStatus === 'failed' ? 1 : 7,
    );
    const service = new AdminReportsService(prisma, testConfig(), mockAudit(), {} as never, {} as never, mockSecurity(), mockNotifications(), {} as never);
    const overview = await service.overview();
    expect(overview).toMatchObject({
      pendingAdReviews: 7,
      pendingKyc: 3,
      openAlerts: 4,
      pendingDeletionRequests: 2,
      adsMediaProcessing: 5,
      adsMediaFailed: 1,
    });
    expect(Number(overview.todayPlatformRevenueEtb)).toBe(5);
  });
});
