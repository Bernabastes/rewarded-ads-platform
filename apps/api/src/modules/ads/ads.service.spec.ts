import { ErrorCode } from '@rap/shared';
import {
  D,
  mockAudit,
  mockNotifications,
  mockPrisma,
  mockRedis,
  mockSecurity,
  testConfig,
  uuid,
} from '../../testing/test-utils';
import { LedgerService } from '../ledger/ledger.service';
import { FraudService } from '../fraud/fraud.service';
import { AdsService } from './ads.service';

const USER = uuid(1);
const AD = uuid(2);
const CAMPAIGN = uuid(3);
const SESSION = uuid(4);
const T0 = new Date('2026-09-24T10:00:00Z');

function buildSession(over: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    userId: USER,
    adId: AD,
    startedAt: new Date(T0.getTime() - 31_000),
    lastHeartbeatAt: new Date(T0.getTime() - 1000),
    heartbeatCount: 3,
    expectedDurationSeconds: 30,
    expiresAt: new Date(T0.getTime() + 1_700_000),
    deviceFingerprint: 'fp-1',
    ipAddress: '10.0.0.1',
    status: 'active',
    attentionQuestion: null,
    completion: null,
    ad: {
      id: AD,
      title: 'Morning Roast',
      campaign: {
        id: CAMPAIGN,
        status: 'active',
        costPerActionEtb: D('2.00'),
        rewardPerActionEtb: D('1.00'),
        attentionCheckEnabled: true,
        advertiserId: uuid(9),
        frequencyCapPerUserPerDay: 1,
      },
    },
    ...over,
  };
}

describe('AdsService.completeWatchSession', () => {
  let prisma: any;
  let ledger: LedgerService;
  let fraud: FraudService;
  let service: AdsService;
  let notifications: any;
  let security: any;
  let referrals: any;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    prisma = mockPrisma();
    security = mockSecurity();
    notifications = mockNotifications();
    const config = testConfig();
    ledger = new LedgerService(prisma, config, security);
    fraud = new FraudService(prisma, mockRedis(), config, security, mockAudit());
    referrals = { onValidCompletion: jest.fn().mockResolvedValue(null), notifyOutcome: jest.fn() };
    service = new AdsService(prisma, mockRedis(), config, ledger, fraud, notifications, security, referrals);

    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: USER,
      trustScore: 60,
      createdAt: new Date('2026-01-01'),
      status: 'active',
    });
    prisma.adCompletion.count.mockResolvedValue(0);
    prisma.adCompletion.findFirst.mockResolvedValue(null);
    prisma.adCompletion.findMany.mockResolvedValue([]);
    prisma.adWatchSession.findMany.mockResolvedValue([]);
    prisma.adWatchSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.adWatchSession.update.mockResolvedValue({});
    prisma.campaign.findUnique.mockResolvedValue({ status: 'active' });
    prisma.fraudFlag.create.mockResolvedValue({ id: uuid(9) });
    prisma.adCompletion.create.mockImplementation(async ({ data }: any) => ({ id: uuid(5), ...data }));
    // ledger core: lock row, no existing entry, create entry, update user
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE') && sql.includes('coin_balance')) return [{ coin_balance: 250 }];
      if (sql.includes('UPDATE campaigns')) return [{ spent_etb: D('100'), budget_etb: D('5000') }];
      return [];
    });
    prisma.coinLedger.findUnique.mockResolvedValue(null);
    prisma.coinLedger.create.mockImplementation(async ({ data }: any) => ({
      id: uuid(6),
      createdAt: T0,
      ...data,
    }));
    prisma.user.update.mockResolvedValue({});
  });

  afterEach(() => jest.useRealTimers());

  it('credits exactly once through the ledger on a valid completion', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });

    expect(result.status).toBe('valid');
    expect(result.coinReward).toBe(100);
    expect(result.newBalance).toBe(350);
    expect(result.replayed).toBe(false);
    expect(prisma.coinLedger.create).toHaveBeenCalledTimes(1);
    expect(prisma.coinLedger.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      amount: 100,
      sourceType: 'ad_view',
      idempotencyKey: `ad_completion:${SESSION}`,
    });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { coinBalance: 350 } });
    expect(prisma.adCompletion.create.mock.calls[0][0].data).toMatchObject({
      status: 'valid',
      coinRewardAmount: 100,
      costEtb: D('2.00'),
    });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'reward_confirmed' }));
  });

  it('replays the stored result when the session was already completed (no double credit)', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(
      buildSession({
        status: 'completed',
        completion: {
          id: uuid(5),
          status: 'valid',
          coinRewardAmount: 100,
          watchDurationSeconds: 31,
          rejectionCode: null,
          fraudFlags: [],
        },
      }),
    );
    prisma.user.findUnique.mockResolvedValue({ coinBalance: 1350 });
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result).toMatchObject({ replayed: true, status: 'valid', coinReward: 100, completionId: uuid(5) });
    // F3: a replay reports the user's CURRENT balance instead of null
    expect(result.newBalance).toBe(1350);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replays when a concurrent request claimed the session first', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValueOnce(buildSession()).mockResolvedValueOnce({
      ...buildSession({ status: 'completed' }),
      completion: {
        id: uuid(7),
        status: 'valid',
        coinRewardAmount: 100,
        watchDurationSeconds: 31,
        rejectionCode: null,
        fraudFlags: [],
      },
    });
    prisma.adWatchSession.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.replayed).toBe(true);
    expect(result.completionId).toBe(uuid(7));
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('rejects a too-short watch with WATCH_DURATION_INSUFFICIENT and never touches the ledger', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(
      buildSession({ startedAt: new Date(T0.getTime() - 10_000) }),
    );
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.status).toBe('rejected');
    expect(result.reasonCode).toBe(ErrorCode.WATCH_DURATION_INSUFFICIENT);
    expect(result.coinReward).toBe(0);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    expect(prisma.adCompletion.create.mock.calls[0][0].data).toMatchObject({
      status: 'rejected',
      rejectionCode: ErrorCode.WATCH_DURATION_INSUFFICIENT,
    });
    expect(security.warn).toHaveBeenCalledWith(
      'completion.rejected',
      expect.objectContaining({ code: ErrorCode.WATCH_DURATION_INSUFFICIENT }),
    );
  });

  it('rejects an absurdly long session', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(
      buildSession({ startedAt: new Date(T0.getTime() - 400_000) }),
    );
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.reasonCode).toBe(ErrorCode.WATCH_DURATION_EXCESSIVE);
  });

  it('re-checks the per-campaign frequency cap under the row lock: FREQUENCY_CAP_REACHED, no credit (Phase 4A)', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    // the campaign-cap query is the only count filtered by campaignId; it reports the cap (1) already reached
    prisma.adCompletion.count.mockImplementation(async ({ where }: any) => (where?.campaignId ? 1 : 0));
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.status).toBe('rejected');
    expect(result.reasonCode).toBe(ErrorCode.FREQUENCY_CAP_REACHED);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    expect(referrals.onValidCompletion).not.toHaveBeenCalled();
    expect(security.info).toHaveBeenCalledWith('frequency_cap.reached', expect.objectContaining({ cap: 'campaign' }));
  });

  it('re-checks the per-advertiser cap (distinct ads per UTC day) (Phase 4A)', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    prisma.adCompletion.findMany.mockResolvedValueOnce([{ adId: uuid(21) }, { adId: uuid(22) }, { adId: uuid(23) }]);
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.reasonCode).toBe(ErrorCode.FREQUENCY_CAP_REACHED);
    expect(security.info).toHaveBeenCalledWith('frequency_cap.reached', expect.objectContaining({ cap: 'advertiser' }));
  });

  it('hands a valid completion to the referral programme inside the transaction and adds the referee bonus to newBalance', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    referrals.onValidCompletion.mockResolvedValue({ status: 'paid', referralId: uuid(30), referrerId: uuid(31), referrerBonus: 500, refereeBonus: 200 });
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.status).toBe('valid');
    expect(referrals.onValidCompletion).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ userId: USER, deviceFingerprint: 'fp-1', ipAddress: '10.0.0.1' }),
    );
    expect(result.newBalance).toBe(350 + 200);
    expect(referrals.notifyOutcome).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }), USER);
  });

  it('rejects missing heartbeats', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession({ heartbeatCount: 0 }));
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.reasonCode).toBe(ErrorCode.HEARTBEAT_CONTINUITY_FAILED);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong attention answer and applies a small trust penalty', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(
      buildSession({ attentionQuestion: { id: uuid(8), correctIndex: 2 } }),
    );
    prisma.user.findUnique.mockResolvedValue({ trustScore: 60 });
    const result = await service.completeWatchSession(
      USER,
      SESSION,
      { attentionAnswerIndex: 0 },
      { ip: '10.0.0.1' },
    );
    expect(result.reasonCode).toBe(ErrorCode.ATTENTION_CHECK_FAILED);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { trustScore: 58 } });
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('enforces the daily cap', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    prisma.adCompletion.count.mockResolvedValue(15);
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.reasonCode).toBe(ErrorCode.DAILY_LIMIT_REACHED);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('re-checks the daily cap inside the transaction (race-safe)', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    // first "today" count (pre-check) sees 14, the locked re-check inside the transaction sees 15
    let todayCalls = 0;
    prisma.adCompletion.count.mockImplementation(async ({ where }: any) => {
      const isTodayQuery = where.status?.in?.includes('valid') && where.completedAt?.gte && !where.ipAddress;
      if (isTodayQuery) return ++todayCalls === 1 ? 14 : 15;
      return 0;
    });
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.status).toBe('rejected');
    expect(result.reasonCode).toBe(ErrorCode.DAILY_LIMIT_REACHED);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('rejects a second credited completion of the same ad (AD_ALREADY_COMPLETED)', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    prisma.adCompletion.findFirst.mockResolvedValue({ id: uuid(11) });
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.reasonCode).toBe(ErrorCode.AD_ALREADY_COMPLETED);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('flags instead of crediting when fraud signals stack (shared device)', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    prisma.adWatchSession.findMany.mockResolvedValue([
      { userId: uuid(21) },
      { userId: uuid(22) },
      { userId: uuid(23) },
    ]);
    prisma.user.findUnique.mockResolvedValue({ trustScore: 60 });
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.status).toBe('flagged');
    expect(result.coinReward).toBe(0);
    expect(result.fraudFlags).toEqual(['DEVICE_SHARED_ACCOUNTS']);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    expect(prisma.fraudFlag.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { trustScore: 50 } });
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'reward_flagged' }));
  });

  it('rejects with FRAUD_REJECTED when the score crosses the reject threshold', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    prisma.adWatchSession.findMany.mockResolvedValue([
      { userId: uuid(21) },
      { userId: uuid(22) },
      { userId: uuid(23) },
    ]);
    prisma.adCompletion.count.mockImplementation(async ({ where }: any) => (where.ipAddress ? 50 : 0));
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: USER,
      trustScore: 25,
      createdAt: new Date('2026-01-01'),
      status: 'active',
    });
    prisma.user.findUnique.mockResolvedValue({ trustScore: 25 });
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.status).toBe('rejected');
    expect(result.reasonCode).toBe(ErrorCode.FRAUD_REJECTED);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('does not credit when the campaign budget is exhausted and pauses at the boundary', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('UPDATE campaigns')) return []; // WHERE spent + cost <= budget failed
      if (sql.includes('coin_balance')) return [{ coin_balance: 250 }];
      return [];
    });
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.status).toBe('rejected');
    expect(result.reasonCode).toBe(ErrorCode.CAMPAIGN_BUDGET_EXHAUSTED);
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('pauses the campaign when the last affordable action is charged', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession());
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('UPDATE campaigns')) return [{ spent_etb: D('5000'), budget_etb: D('5000') }];
      if (sql.includes('coin_balance')) return [{ coin_balance: 0 }];
      return [];
    });
    prisma.campaign.update.mockResolvedValue({});
    const result = await service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' });
    expect(result.status).toBe('valid');
    expect(prisma.campaign.update).toHaveBeenCalledWith({
      where: { id: CAMPAIGN },
      data: { status: 'paused', pausedReason: 'budget_exhausted' },
    });
  });

  it('refuses sessions that belong to another user', async () => {
    prisma.adWatchSession.findUnique.mockResolvedValue(buildSession({ userId: uuid(99) }));
    await expect(service.completeWatchSession(USER, SESSION, {}, { ip: '10.0.0.1' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});
