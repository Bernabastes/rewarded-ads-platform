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
    prisma.adminUser.findUnique.mockResolvedValue({ id: ADMIN });
    expect(await service.resolveActor('Finance@rap.et')).toBe(ADMIN);
    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith({ where: { email: 'finance@rap.et' }, select: { id: true } });

    prisma.adminUser.findUnique.mockResolvedValue(null);
    prisma.advertiser.findUnique.mockResolvedValue({ id: ADVERTISER });
    expect(await service.resolveActor('ads@habesha-coffee.et')).toBe(ADVERTISER);

    prisma.user.findUnique.mockResolvedValue({ id: USER });
    expect(await service.resolveActor('0911 000 000')).toBe(USER);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { phoneNumber: '+251911000000' }, select: { id: true } });

    expect(await service.resolveActor(USER)).toBe(USER);
    prisma.user.findUnique.mockResolvedValue(null);
    expect(await service.resolveActor('0911999999')).toBeNull();
    expect(await service.resolveActor('not an actor')).toBeNull();
  });

  it('actor= filters by the resolved id; an unknown actor yields an empty page instead of dropping the filter', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({ id: ADMIN });
    await service.auditLog({ actor: 'finance@rap.et' });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.actorId).toBe(ADMIN);

    prisma.adminUser.findUnique.mockResolvedValue(null);
    prisma.advertiser.findUnique.mockResolvedValue(null);
    const empty = await service.auditLog({ actor: 'nobody@rap.et' });
    expect(empty.data).toEqual([]);
    expect(empty.meta.total).toBe(0);
    expect((empty.meta as any).actorResolved).toBe(false);
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1); // no second query
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
