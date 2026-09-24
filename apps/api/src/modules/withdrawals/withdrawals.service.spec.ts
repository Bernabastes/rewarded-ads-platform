import { ErrorCode } from '@rap/shared';
import {
  D,
  mockAudit,
  mockNotifications,
  mockPrisma,
  mockQueue,
  mockRedis,
  mockSecurity,
  testConfig,
  uuid,
} from '../../testing/test-utils';
import { LedgerService } from '../ledger/ledger.service';
import { PayoutProviderRegistry } from './providers/payout-provider.registry';
import { WithdrawalsService } from './withdrawals.service';

const USER = uuid(1);
const ADMIN_A = uuid(10);
const ADMIN_B = uuid(11);
const WD = uuid(20);

describe('WithdrawalsService', () => {
  let prisma: any;
  let service: WithdrawalsService;
  let security: any;
  let notifications: any;
  let queue: any;
  let balance: number;

  const finance = (adminId: string) => ({ adminId, role: 'finance' as const, ip: '1.1.1.1' });

  beforeEach(() => {
    prisma = mockPrisma();
    security = mockSecurity();
    notifications = mockNotifications();
    queue = mockQueue();
    const config = testConfig({ QUEUES_ENABLED: 'true', NODE_ENV: 'development' });
    const ledger = new LedgerService(prisma, config, security);
    const registry = new PayoutProviderRegistry(
      [
        {
          name: 'telebirr',
          isMock: true,
          supportedMethods: ['telebirr'],
          isAvailable: () => true,
          initiatePayout: jest.fn(),
          checkStatus: jest.fn(),
        },
      ] as any,
      security,
    );
    service = new WithdrawalsService(
      prisma,
      mockRedis(),
      config,
      ledger,
      registry,
      mockAudit(),
      security,
      notifications,
      queue,
    );

    balance = 10_000; // 100 ETB
    prisma.$queryRaw.mockImplementation(async () => [{ coin_balance: balance }]);
    prisma.coinLedger.findUnique.mockResolvedValue(null);
    prisma.coinLedger.create.mockImplementation(async ({ data }: any) => ({
      id: uuid(30),
      createdAt: new Date(),
      ...data,
    }));
    prisma.user.update.mockImplementation(async ({ data }: any) => {
      balance = data.coinBalance;
      return {};
    });
    prisma.user.findUniqueOrThrow.mockImplementation(async () => ({ trustScore: 70, coinBalance: balance }));
    prisma.withdrawal.count.mockResolvedValue(0);
    let created: Record<string, unknown> = {};
    prisma.withdrawal.create.mockImplementation(async ({ data }: any) => {
      created = {
        id: WD,
        requestedAt: new Date(),
        updatedAt: new Date(),
        processedAt: null,
        failureReason: null,
        providerName: null,
        providerPayoutId: null,
        ...data,
      };
      return created;
    });
    prisma.withdrawal.update.mockImplementation(async ({ data }: any) => ({ ...created, id: WD, ...data }));
  });

  const dto = { amountEtb: 60, payoutMethod: 'telebirr' as const, payoutDestination: '0911223344' };

  it('rejects requests below the minimum withdrawal', async () => {
    await expect(service.request(USER, { ...dto, amountEtb: 49.99 }, 'ip')).rejects.toMatchObject({
      code: ErrorCode.BELOW_MIN_WITHDRAWAL,
    });
    expect(prisma.withdrawal.create).not.toHaveBeenCalled();
  });

  it('rejects invalid destinations', async () => {
    await expect(service.request(USER, { ...dto, payoutDestination: '12345' }, 'ip')).rejects.toMatchObject({
      code: ErrorCode.INVALID_PAYOUT_DESTINATION,
    });
    await expect(
      service.request(USER, { ...dto, payoutMethod: 'bank', payoutDestination: '1000123456' }, 'ip'),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_PAYOUT_DESTINATION });
  });

  it('rejects when the balance is insufficient (before touching the ledger)', async () => {
    balance = 5_000;
    await expect(service.request(USER, dto, 'ip')).rejects.toMatchObject({
      code: ErrorCode.INSUFFICIENT_BALANCE,
    });
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('converts ETB to coins, holds them in the same transaction and flags a first-ever withdrawal', async () => {
    const result = await service.request(USER, dto, 'ip');
    expect(result.status).toBe('flagged_for_review');
    expect(result.reviewReasons).toEqual(['first_withdrawal']);
    expect(result.coinAmount).toBe(6000);
    expect(result.requiresDualApproval).toBe(false);
    expect(prisma.coinLedger.create.mock.calls[0][0].data).toMatchObject({
      amount: -6000,
      sourceType: 'withdrawal',
      idempotencyKey: `withdrawal_hold:${WD}`,
    });
    expect(balance).toBe(4000);
    expect(result.payoutDestination).toMatch(/^\+2519\*+3344$/);
    expect(queue.add).not.toHaveBeenCalled(); // held for review, never auto-paid
    expect(security.warn).toHaveBeenCalledWith('withdrawal.flagged_for_review', expect.anything());
  });

  it('flags large amounts for dual approval even for established users', async () => {
    balance = 100_000;
    prisma.withdrawal.count.mockImplementation(async ({ where }: any) =>
      where.status === 'completed' ? 3 : 0,
    );
    const result = await service.request(USER, { ...dto, amountEtb: 500 }, 'ip');
    expect(result.status).toBe('flagged_for_review');
    expect(result.reviewReasons).toEqual(['large_amount']);
    expect(result.requiresDualApproval).toBe(true);
  });

  it('flags low-trust accounts', async () => {
    prisma.withdrawal.count.mockImplementation(async ({ where }: any) =>
      where.status === 'completed' ? 1 : 0,
    );
    prisma.user.findUniqueOrThrow.mockImplementation(async () => ({ trustScore: 20, coinBalance: balance }));
    const result = await service.request(USER, dto, 'ip');
    expect(result.reviewReasons).toEqual(['low_trust_score']);
  });

  it('auto-queues payouts for established users under the threshold', async () => {
    prisma.withdrawal.count.mockImplementation(async ({ where }: any) =>
      where.status === 'completed' ? 2 : 0,
    );
    const result = await service.request(USER, dto, 'ip');
    expect(result.status).toBe('pending');
    expect(queue.add).toHaveBeenCalledWith('initiate', { withdrawalId: WD }, expect.anything());
  });

  it('blocks a second in-flight withdrawal', async () => {
    prisma.withdrawal.count.mockImplementation(async ({ where }: any) => (where.status?.in ? 1 : 0));
    await expect(service.request(USER, dto, 'ip')).rejects.toMatchObject({
      code: ErrorCode.WITHDRAWAL_PENDING_EXISTS,
    });
  });

  describe('admin decisions', () => {
    const held = (over: Record<string, unknown> = {}) => ({
      id: WD,
      userId: USER,
      amountEtb: D(650),
      coinAmount: 65_000,
      payoutMethod: 'telebirr',
      payoutDestination: '+251911223344',
      status: 'flagged_for_review',
      requiresDualApproval: true,
      approvals: [],
      reviewNote: null,
      attempts: 0,
      ...over,
    });

    beforeEach(() => {
      prisma.withdrawalApproval.create.mockResolvedValue({});
      prisma.withdrawal.findUnique.mockImplementation(async ({ include }: any) =>
        include?.user ? { ...held(), user: {}, approvals: [] } : held(),
      );
    });

    it('requires finance or super_admin', async () => {
      await expect(service.approve(WD, { adminId: ADMIN_A, role: 'support' }, 'ok')).rejects.toMatchObject({
        code: ErrorCode.DUAL_APPROVAL_ROLE_REQUIRED,
      });
    });

    it('a large withdrawal stays held after the first approval and is released by a DIFFERENT second admin', async () => {
      prisma.withdrawalApproval.count.mockResolvedValueOnce(1);
      await service.approve(WD, finance(ADMIN_A), 'first');
      expect(prisma.withdrawal.update.mock.calls[0][0].data).not.toHaveProperty('status');
      expect(queue.add).not.toHaveBeenCalled();

      prisma.withdrawal.findUnique.mockImplementation(async ({ include }: any) =>
        include?.user ? { ...held(), user: {}, approvals: [] } : held({ approvals: [{ adminId: ADMIN_A }] }),
      );
      await expect(service.approve(WD, finance(ADMIN_A), 'again')).rejects.toMatchObject({
        code: ErrorCode.DUAL_APPROVAL_SAME_ADMIN,
      });

      prisma.withdrawalApproval.count.mockResolvedValueOnce(2);
      await service.approve(WD, finance(ADMIN_B), 'second');
      expect(prisma.withdrawal.update.mock.calls.at(-1)[0].data).toMatchObject({
        status: 'pending',
        processedBy: ADMIN_B,
      });
      expect(queue.add).toHaveBeenCalledWith('initiate', { withdrawalId: WD }, expect.anything());
    });

    it('a first-time (non-large) withdrawal needs a single approval', async () => {
      prisma.withdrawal.findUnique.mockImplementation(async ({ include }: any) =>
        include?.user ? { ...held(), user: {}, approvals: [] } : held({ requiresDualApproval: false }),
      );
      prisma.withdrawalApproval.count.mockResolvedValueOnce(1);
      await service.approve(WD, finance(ADMIN_A), 'ok');
      expect(prisma.withdrawal.update.mock.calls[0][0].data).toMatchObject({ status: 'pending' });
    });

    it('rejection refunds the hold with a reversing ledger entry', async () => {
      prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
      prisma.withdrawalApproval.upsert.mockResolvedValue({});
      balance = 0;
      await service.reject(WD, finance(ADMIN_A), 'Destination mismatch');
      expect(prisma.coinLedger.create.mock.calls[0][0].data).toMatchObject({
        amount: 65_000,
        sourceType: 'withdrawal_reversal',
        idempotencyKey: `withdrawal_reversal:${WD}:0`,
      });
      expect(balance).toBe(65_000);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'withdrawal_status' }),
      );
    });

    it('cannot approve a withdrawal that is not held for review', async () => {
      prisma.withdrawal.findUnique.mockResolvedValue(held({ status: 'completed' }));
      await expect(service.approve(WD, finance(ADMIN_A), 'x')).rejects.toMatchObject({
        code: ErrorCode.WITHDRAWAL_NOT_REVIEWABLE,
      });
    });
  });

  describe('payout worker callbacks', () => {
    it('markFailed writes the reversing entry exactly once and notifies', async () => {
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: WD,
        userId: USER,
        amountEtb: D(60),
        coinAmount: 6000,
        status: 'processing',
        attempts: 1,
        providerName: 'telebirr',
        payoutMethod: 'telebirr',
      });
      balance = 4000;
      await service.markFailed(WD, 'partner timeout');
      expect(prisma.coinLedger.create).toHaveBeenCalledTimes(1);
      expect(prisma.coinLedger.create.mock.calls[0][0].data).toMatchObject({
        amount: 6000,
        sourceType: 'withdrawal_reversal',
        idempotencyKey: `withdrawal_reversal:${WD}:1`,
      });
      expect(balance).toBe(10_000);
      expect(security.warn).toHaveBeenCalledWith('withdrawal.payout_failed', expect.anything());
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Withdrawal failed' }),
      );
    });

    it('markFailed is a no-op unless the withdrawal is processing', async () => {
      prisma.withdrawal.findUnique.mockResolvedValue({ id: WD, status: 'completed' });
      await service.markFailed(WD, 'late failure');
      expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    });

    it('markCompleted keeps the hold (money left the platform) and notifies', async () => {
      prisma.withdrawal.findUnique.mockResolvedValue({
        id: WD,
        userId: USER,
        amountEtb: D(60),
        status: 'processing',
        payoutMethod: 'telebirr',
        providerName: 'telebirr',
        providerPayoutId: 'MOCK-1',
      });
      await service.markCompleted(WD, { ok: true });
      expect(prisma.coinLedger.create).not.toHaveBeenCalled();
      expect(prisma.withdrawal.update.mock.calls[0][0].data).toMatchObject({ status: 'completed' });
    });
  });

  it('exposes config with thresholds and available methods', () => {
    const cfg = service.getConfig();
    expect(cfg.minWithdrawalEtb).toBe(50);
    expect(cfg.coinsPerEtb).toBe(100);
    expect(cfg.largeWithdrawalThresholdEtb).toBe(500);
    expect(cfg.methods.find((m) => m.method === 'telebirr')?.available).toBe(true);
    expect(cfg.methods.find((m) => m.method === 'bank')?.available).toBe(false);
  });
});
