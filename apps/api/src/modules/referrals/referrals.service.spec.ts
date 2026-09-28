import { ErrorCode } from '@rap/shared';
import { mockAudit, mockNotifications, mockPrisma, mockSecurity, testConfig, uuid } from '../../testing/test-utils';
import { LedgerService } from '../ledger/ledger.service';
import { REFERRAL_FLAG_TYPE, ReferralsService } from './referrals.service';

const REFERRER = uuid(1);
const REFEREE = uuid(2);
const REFERRAL = uuid(3);
const COMPLETION = uuid(4);
const NOW = new Date('2026-09-28T12:00:00Z');

describe('ReferralsService', () => {
  let prisma: any;
  let service: ReferralsService;
  let fraud: any;
  let balances: Record<string, number>;
  const config = testConfig({ REFERRAL_BONUS_COINS: 500, REFEREE_BONUS_COINS: 200, REFERRAL_MAX_PER_REFERRER_PER_DAY: 5 });

  const completion = { userId: REFEREE, completionId: COMPLETION, deviceFingerprint: 'fp-referee', ipAddress: '10.0.0.2', now: NOW };

  beforeEach(() => {
    prisma = mockPrisma();
    fraud = { adjustTrustScore: jest.fn() };
    const security = mockSecurity();
    const ledger = new LedgerService(prisma, config, security);
    service = new ReferralsService(prisma, config, ledger, fraud, mockAudit(), security, mockNotifications());

    // in-memory ledger core: FOR UPDATE balance read + cache write
    balances = { [REFERRER]: 1000, [REFEREE]: 100 };
    prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const userId = values[0] as string;
      return [{ coin_balance: balances[userId] ?? 0 }];
    });
    prisma.coinLedger.findUnique.mockResolvedValue(null);
    prisma.coinLedger.create.mockImplementation(async ({ data }: any) => ({ id: uuid(50), createdAt: NOW, ...data }));
    prisma.user.update.mockImplementation(async ({ where, data }: any) => {
      if (data.coinBalance !== undefined) balances[where.id] = data.coinBalance;
      return {};
    });

    prisma.referral.findUnique.mockResolvedValue({
      id: REFERRAL,
      referrerId: REFERRER,
      refereeId: REFEREE,
      status: 'pending',
      signupIp: '10.0.0.2',
      signupDeviceFingerprint: 'fp-referee',
    });
    prisma.adCompletion.count.mockResolvedValue(0); // no earlier valid completion
    prisma.user.findUnique.mockResolvedValue({
      id: REFERRER,
      status: 'active',
      signupDeviceFingerprint: 'fp-referrer',
      signupIp: '10.0.0.1',
      lastIp: '10.0.0.1',
    });
    prisma.adWatchSession.findFirst.mockResolvedValue(null); // referrer never used the referee's device/IP
    prisma.referral.count.mockResolvedValue(0); // none paid today
    prisma.referral.update.mockResolvedValue({});
  });

  it('credits BOTH bonuses through the ledger on the referee\'s first valid completion (same tx) and marks paid', async () => {
    const outcome = await service.onValidCompletion(prisma, completion);

    expect(outcome).toEqual({ status: 'paid', referralId: REFERRAL, referrerId: REFERRER, referrerBonus: 500, refereeBonus: 200 });
    const writes = prisma.coinLedger.create.mock.calls.map((c: any) => c[0].data);
    expect(writes).toEqual([
      expect.objectContaining({ userId: REFERRER, amount: 500, sourceType: 'referral', idempotencyKey: `referral_referrer:${REFERRAL}` }),
      expect.objectContaining({ userId: REFEREE, amount: 200, sourceType: 'referral', idempotencyKey: `referral_referee:${REFERRAL}` }),
    ]);
    expect(balances[REFERRER]).toBe(1500);
    expect(balances[REFEREE]).toBe(300);
    expect(prisma.referral.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'paid', referrerBonusCoins: 500, refereeBonusCoins: 200, qualifyingCompletionId: COMPLETION }) }),
    );
  });

  it('does nothing when the referee has no pending referral or already had a valid completion', async () => {
    prisma.referral.findUnique.mockResolvedValueOnce(null);
    expect(await service.onValidCompletion(prisma, completion)).toBeNull();
    prisma.adCompletion.count.mockResolvedValueOnce(1);
    expect(await service.onValidCompletion(prisma, completion)).toBeNull();
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('rejects + flags both accounts when the referee completes from the referrer\'s signup device', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: REFERRER, status: 'active', signupDeviceFingerprint: 'fp-referee', signupIp: '1.2.3.4', lastIp: '1.2.3.4' });
    const outcome = await service.onValidCompletion(prisma, completion);
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'self_referral_device' });
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    expect(prisma.fraudFlag.create).toHaveBeenCalledTimes(2);
    expect(prisma.fraudFlag.create.mock.calls.map((c: any) => c[0].data.userId).sort()).toEqual([REFERRER, REFEREE].sort());
    expect(prisma.fraudFlag.create.mock.calls[0][0].data.flagType).toBe(REFERRAL_FLAG_TYPE);
    expect(fraud.adjustTrustScore).toHaveBeenCalledTimes(2);
  });

  it('rejects when the referrer ever watched ads from the referee\'s device', async () => {
    prisma.adWatchSession.findFirst.mockResolvedValueOnce({ id: 'shared-device-session' });
    const outcome = await service.onValidCompletion(prisma, completion);
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'self_referral_device' });
  });

  it('rejects when the referee shares the referrer\'s IP', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: REFERRER, status: 'active', signupDeviceFingerprint: 'other', signupIp: '10.0.0.2', lastIp: null });
    const outcome = await service.onValidCompletion(prisma, completion);
    expect(outcome).toMatchObject({ status: 'rejected', reason: 'self_referral_ip' });
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('withholds the bonus (status qualified, no flag) when the referrer hit the daily cap', async () => {
    prisma.referral.count.mockResolvedValue(5);
    const outcome = await service.onValidCompletion(prisma, completion);
    expect(outcome).toMatchObject({ status: 'qualified', reason: 'referrer_daily_cap' });
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    expect(prisma.fraudFlag.create).not.toHaveBeenCalled();
    expect(prisma.referral.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'qualified' }) }));
  });

  it('withholds when the referrer is suspended/banned', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: REFERRER, status: 'suspended', signupDeviceFingerprint: 'x', signupIp: '1.1.1.1', lastIp: null });
    expect(await service.onValidCompletion(prisma, completion)).toMatchObject({ status: 'qualified', reason: 'referrer_inactive' });
  });

  describe('signup', () => {
    it('resolveReferrer validates the code (400 REFERRAL_CODE_INVALID)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.resolveReferrer('nope')).rejects.toMatchObject({ code: ErrorCode.REFERRAL_CODE_INVALID });
      prisma.user.findUnique.mockResolvedValueOnce({ id: REFERRER, status: 'active' });
      await expect(service.resolveReferrer(' k7mp2x ')).resolves.toEqual({ id: REFERRER, status: 'active' });
      expect(prisma.user.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { referralCode: 'K7MP2X' } }));
    });

    it('applyOnSignup refuses self-referral and double application', async () => {
      await expect(
        service.applyOnSignup(prisma, { refereeId: REFERRER, referrerId: REFERRER, code: 'K7MP2X' }),
      ).rejects.toMatchObject({ code: ErrorCode.REFERRAL_SELF_NOT_ALLOWED });
      prisma.referral.findUnique.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.applyOnSignup(prisma, { refereeId: REFEREE, referrerId: REFERRER, code: 'K7MP2X' }),
      ).rejects.toMatchObject({ code: ErrorCode.REFERRAL_ALREADY_APPLIED });
    });

    it('generates 6-char codes from the unambiguous alphabet', () => {
      for (let i = 0; i < 50; i++) expect(ReferralsService.generateCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    });
  });
});
