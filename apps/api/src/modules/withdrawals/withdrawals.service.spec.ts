import { Prisma } from '@prisma/client';
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
  let trustScore: number;
  let kyc: any;
  let destinations: any;
  let alerts: any;

  const finance = (adminId: string) => ({ adminId, role: 'finance' as const, ip: '1.1.1.1' });

  beforeEach(() => {
    prisma = mockPrisma();
    security = mockSecurity();
    notifications = mockNotifications();
    queue = mockQueue();
    trustScore = 70;
    // KYC tier rule and destination verification are unit-tested in their own specs; here they pass by default.
    kyc = { assertWithinTier: jest.fn().mockResolvedValue(D(0)), monthlyPayoutTotalEtb: jest.fn().mockResolvedValue(D(0)) };
    destinations = {
      assertVerifiedForRequest: jest.fn().mockResolvedValue({
        id: uuid(40),
        accountName: 'Abebe Tesfaye',
        verifiedAt: new Date(),
        bankCode: null,
      }),
      markUsed: jest.fn().mockResolvedValue(undefined),
      listKnown: jest.fn().mockResolvedValue([]),
    };
    alerts = { raise: jest.fn().mockResolvedValue(undefined) };
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
      kyc,
      destinations,
      alerts,
      queue,
    );

    balance = 10_000; // 100 ETB
    // #12: the request transaction locks the user row (trust/balance/kyc) and the ledger re-reads the balance.
    prisma.$queryRaw.mockImplementation(async () => [{ coin_balance: balance, trust_score: trustScore, kyc_tier: 'phone_only' }]);
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
    prisma.user.findUniqueOrThrow.mockImplementation(async () => ({
      trustScore: 70,
      coinBalance: balance,
      kycTier: 'phone_only',
    }));
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

  it('stops with KYC_REQUIRED before any ledger write when the tier rule fails (Phase 4A)', async () => {
    kyc.assertWithinTier.mockRejectedValueOnce(
      Object.assign(new Error('kyc'), { code: ErrorCode.KYC_REQUIRED, status: 422 }),
    );
    await expect(service.request(USER, dto, 'ip')).rejects.toMatchObject({ code: ErrorCode.KYC_REQUIRED });
    // #12: evaluated inside the transaction (4th arg = tx) under the user row lock
    expect(kyc.assertWithinTier).toHaveBeenCalledWith(USER, 'phone_only', expect.anything(), prisma);
    expect(destinations.assertVerifiedForRequest).not.toHaveBeenCalled();
    expect(prisma.withdrawal.create).not.toHaveBeenCalled();
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  describe('TOCTOU hardening (security audit #12)', () => {
    it('locks the user row FOR UPDATE and runs the one-in-flight / first-withdrawal / KYC checks inside the transaction', async () => {
      const order: string[] = [];
      prisma.$transaction.mockImplementation(async (fn: any) => {
        order.push('tx:begin');
        const r = await fn(prisma);
        order.push('tx:end');
        return r;
      });
      prisma.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        order.push(strings.join('?').includes('FOR UPDATE') ? 'lock' : 'raw');
        return [{ coin_balance: balance, trust_score: trustScore, kyc_tier: 'phone_only' }];
      });
      prisma.withdrawal.count.mockImplementation(async () => {
        order.push('count');
        return 0;
      });
      kyc.assertWithinTier.mockImplementation(async () => {
        order.push('kyc');
        return D(0);
      });
      await service.request(USER, dto, 'ip');
      expect(order.indexOf('tx:begin')).toBeLessThan(order.indexOf('lock'));
      expect(order.indexOf('lock')).toBeLessThan(order.indexOf('count'));
      expect(order.indexOf('count')).toBeLessThan(order.indexOf('kyc'));
      expect(order.indexOf('kyc')).toBeLessThan(order.indexOf('tx:end'));
      const lockSql = (prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
      expect(lockSql).toMatch(/FROM users WHERE id = \?::uuid FOR UPDATE/);
    });

    it('maps a race that slips past the lock to the partial unique index -> 409 WITHDRAWAL_PENDING_EXISTS', async () => {
      prisma.withdrawal.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`user_id`)', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: 'withdrawals_one_in_flight_per_user' },
        }),
      );
      await expect(service.request(USER, dto, 'ip')).rejects.toMatchObject({ code: ErrorCode.WITHDRAWAL_PENDING_EXISTS, status: 409 });
      expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    });

    it('the balance is checked from the LOCKED row, never from a stale read', async () => {
      balance = 1_000;
      await expect(service.request(USER, dto, 'ip')).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE });
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.withdrawal.create).not.toHaveBeenCalled();
    });
  });

  it('stops with DESTINATION_NOT_VERIFIED for a new destination without a fresh lookup (Phase 4A)', async () => {
    destinations.assertVerifiedForRequest.mockRejectedValueOnce(
      Object.assign(new Error('dest'), { code: ErrorCode.DESTINATION_NOT_VERIFIED, status: 422 }),
    );
    await expect(service.request(USER, dto, 'ip')).rejects.toMatchObject({
      code: ErrorCode.DESTINATION_NOT_VERIFIED,
    });
    expect(destinations.assertVerifiedForRequest).toHaveBeenCalledWith(USER, {
      payoutMethod: 'telebirr',
      destination: '+251911223344',
      bankCode: undefined,
    });
    expect(prisma.withdrawal.create).not.toHaveBeenCalled();
  });

  it('snapshots the verified account name on the withdrawal and marks the destination used (Phase 4A)', async () => {
    const result = await service.request(USER, dto, 'ip');
    expect(prisma.withdrawal.create.mock.calls[0][0].data).toMatchObject({
      destinationAccountName: 'Abebe Tesfaye',
      payoutDestinationId: uuid(40),
      destinationName: 'Abebe Tesfaye',
    });
    expect(destinations.markUsed).toHaveBeenCalledWith(uuid(40), expect.anything());
    expect(result.destinationAccountName).toBe('Abebe Tesfaye');
  });

  it('accepts payoutDestinationId for a KNOWN destination: no number, no lookup/OTP checks (Phase 4C)', async () => {
    destinations.findKnownById = jest.fn().mockResolvedValue({
      id: uuid(41),
      destination: '+251911223344',
      accountName: 'Abebe Tesfaye',
      bankCode: null,
      verifiedAt: new Date(),
      lastUsedAt: new Date(),
    });
    const result = await service.request(
      USER,
      { amountEtb: 60, payoutMethod: 'telebirr', payoutDestinationId: uuid(41) },
      'ip',
    );
    expect(destinations.findKnownById).toHaveBeenCalledWith(USER, uuid(41), 'telebirr');
    expect(destinations.assertVerifiedForRequest).not.toHaveBeenCalled();
    expect(prisma.withdrawal.create.mock.calls[0][0].data).toMatchObject({
      payoutDestination: '+251911223344',
      payoutDestinationId: uuid(41),
      destinationAccountName: 'Abebe Tesfaye',
    });
    expect(result.coinAmount).toBe(6000);
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
    trustScore = 20;
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

    it('rejection refunds the hold with a reversing ledger entry keyed to the hold entry', async () => {
      prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
      prisma.withdrawalApproval.upsert.mockResolvedValue({});
      prisma.withdrawal.findUnique.mockImplementation(async ({ include }: any) =>
        include?.user ? { ...held(), user: {}, approvals: [] } : held({ ledgerHoldEntryId: uuid(31) }),
      );
      balance = 0;
      await service.reject(WD, finance(ADMIN_A), 'Destination mismatch');
      expect(prisma.coinLedger.create.mock.calls[0][0].data).toMatchObject({
        amount: 65_000,
        sourceType: 'withdrawal_reversal',
        idempotencyKey: `withdrawal_reversal:${uuid(31)}`,
      });
      expect(balance).toBe(65_000);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'withdrawal_status' }),
      );
    });

    it('REGRESSION #6: fail -> retry -> reject refunds the RETRY hold instead of replaying the first reversal', async () => {
      // In-memory ledger with real idempotency semantics (keys that exist are replayed, never re-credited).
      const ledgerKeys = new Map<string, { id: string; amount: number }>();
      let seq = 100;
      prisma.coinLedger.findUnique.mockImplementation(async ({ where }: any) => ledgerKeys.get(where.idempotencyKey) ?? null);
      prisma.coinLedger.create.mockImplementation(async ({ data }: any) => {
        const entry = { id: uuid(seq++), createdAt: new Date(), ...data };
        ledgerKeys.set(data.idempotencyKey, { id: entry.id, amount: data.amount });
        return entry;
      });
      prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
      prisma.withdrawalApproval.upsert.mockResolvedValue({});
      const row: Record<string, any> = held({ status: 'processing', attempts: 1, requiresDualApproval: false, ledgerHoldEntryId: uuid(31) });
      ledgerKeys.set(`withdrawal_hold:${WD}`, { id: uuid(31), amount: -65_000 });
      balance = 0; // coins are held
      prisma.withdrawal.findUnique.mockImplementation(async ({ include }: any) => (include?.user ? { ...row, user: {}, approvals: [] } : { ...row }));
      prisma.withdrawal.update.mockImplementation(async ({ data }: any) => {
        Object.assign(row, data);
        return { ...row };
      });

      // 1) the payout fails -> reversal of hold #1, coins back
      await service.markFailed(WD, 'telebirr down');
      expect(balance).toBe(65_000);
      expect(ledgerKeys.has(`withdrawal_reversal:${uuid(31)}`)).toBe(true);

      // 2) finance retries -> a NEW hold (#2), coins held again
      await service.retry(WD, finance(ADMIN_A));
      expect(balance).toBe(0);
      expect(row.status).toBe('pending');
      const retryHoldId = ledgerKeys.get(`withdrawal_hold:${WD}:retry2`)!.id;
      expect(row.ledgerHoldEntryId).toBe(retryHoldId);

      // 3) finance rejects the pending retry: the OLD code reused `withdrawal_reversal:<id>:<attempts>` (= :1, the
      //    key of the first reversal) -> replayed, nothing credited, user permanently short 65,000 coins.
      await service.reject(WD, finance(ADMIN_A), 'Changed my mind');
      expect(ledgerKeys.has(`withdrawal_reversal:${retryHoldId}`)).toBe(true);
      expect(balance).toBe(65_000);
      expect(row.ledgerReversalEntryId).toBe(ledgerKeys.get(`withdrawal_reversal:${retryHoldId}`)!.id);
    });

    it('a replayed reversal where a fresh one is expected aborts instead of silently keeping the coins', async () => {
      prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
      prisma.withdrawalApproval.upsert.mockResolvedValue({});
      prisma.withdrawal.findUnique.mockImplementation(async ({ include }: any) =>
        include?.user ? { ...held(), user: {}, approvals: [] } : held({ ledgerHoldEntryId: uuid(31) }),
      );
      prisma.coinLedger.findUnique.mockResolvedValue({ id: uuid(32), balanceAfter: 65_000, amount: 65_000 }); // already reversed
      balance = 0;
      await expect(service.reject(WD, finance(ADMIN_A), 'twice')).rejects.toMatchObject({ code: ErrorCode.WITHDRAWAL_NOT_REVIEWABLE });
      expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    });

    it('cannot approve a withdrawal that is not held for review', async () => {
      prisma.withdrawal.findUnique.mockResolvedValue(held({ status: 'completed' }));
      await expect(service.approve(WD, finance(ADMIN_A), 'x')).rejects.toMatchObject({
        code: ErrorCode.WITHDRAWAL_NOT_REVIEWABLE,
      });
    });
  });

  describe('payout worker callbacks', () => {
    it('Phase 5b New-2: the stuck-processing sweeper parks partner-less payouts older than the cutoff and alerts finance (never refunds)', async () => {
      const stuckRow = { id: WD, userId: USER, amountEtb: D(60), coinAmount: 6000, status: 'processing', attempts: 1, providerName: null, providerPayoutId: null, payoutMethod: 'telebirr', ledgerHoldEntryId: uuid(31), updatedAt: new Date('2026-10-01T10:00:00Z') };
      prisma.withdrawal.findMany.mockResolvedValue([stuckRow]);
      prisma.withdrawal.findUnique.mockResolvedValue(stuckRow);
      prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
      const parked = await service.sweepStuckProcessing(new Date('2026-10-01T10:30:00Z'));
      expect(parked).toBe(1);
      expect(prisma.withdrawal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'processing', providerName: null, updatedAt: { lt: new Date('2026-10-01T10:15:00Z') } } }),
      );
      expect(prisma.withdrawal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: WD, status: 'processing' }, data: expect.objectContaining({ status: 'needs_manual_review' }) }),
      );
      expect(prisma.coinLedger.create).not.toHaveBeenCalled();
      expect(alerts.raise).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAYOUT_STUCK_PROCESSING', severity: 'critical', dedupeKey: `payout_stuck:${WD}` }));
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Withdrawal being verified' }));
    });

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
        ledgerHoldEntryId: uuid(31),
      });
      balance = 4000;
      await service.markFailed(WD, 'partner timeout');
      expect(prisma.coinLedger.create).toHaveBeenCalledTimes(1);
      expect(prisma.coinLedger.create.mock.calls[0][0].data).toMatchObject({
        amount: 6000,
        sourceType: 'withdrawal_reversal',
        idempotencyKey: `withdrawal_reversal:${uuid(31)}`,
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

    describe('needs_manual_review (security audit #7)', () => {
      const processing = {
        id: WD,
        userId: USER,
        amountEtb: D(60),
        coinAmount: 6000,
        status: 'processing',
        payoutMethod: 'telebirr',
        providerName: 'telebirr',
        providerPayoutId: 'TB-1',
        payoutDestination: '+251911000001',
        ledgerHoldEntryId: uuid(31),
        attempts: 1,
      };

      it('markNeedsManualReview parks the withdrawal with the coins STILL held and notifies the user', async () => {
        prisma.withdrawal.findUnique.mockResolvedValue({ ...processing });
        prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
        balance = 4000;
        await service.markNeedsManualReview(WD, 'partner timeout', { timeout: true });
        expect(prisma.withdrawal.updateMany.mock.calls[0][0]).toMatchObject({
          where: { id: WD, status: 'processing' },
          data: { status: 'needs_manual_review', failureReason: 'partner timeout' },
        });
        expect(prisma.coinLedger.create).not.toHaveBeenCalled(); // NO refund
        expect(balance).toBe(4000);
        expect(security.error).toHaveBeenCalledWith('payout.outcome_unknown', expect.objectContaining({ withdrawalId: WD }));
        expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Withdrawal being verified' }));
      });

      it('finance resolves "completed": status completed, hold kept, audited', async () => {
        prisma.withdrawal.findUnique.mockImplementation(async ({ include }: any) =>
          include?.user ? { ...processing, status: 'needs_manual_review', user: {}, approvals: [] } : { ...processing, status: 'needs_manual_review' },
        );
        prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
        balance = 4000;
        await service.resolveManualReview(WD, finance(ADMIN_A), { outcome: 'completed', reason: 'telebirr confirmed TB-1 settled', providerReference: 'TB-1-settled' });
        expect(prisma.withdrawal.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'completed', processedBy: ADMIN_A, providerPayoutId: 'TB-1-settled' });
        expect(prisma.coinLedger.create).not.toHaveBeenCalled();
        expect(balance).toBe(4000);
      });

      it('finance resolves "failed": coins refunded against the current hold', async () => {
        prisma.withdrawal.findUnique.mockImplementation(async ({ include }: any) =>
          include?.user ? { ...processing, status: 'needs_manual_review', user: {}, approvals: [] } : { ...processing, status: 'needs_manual_review' },
        );
        prisma.withdrawal.updateMany.mockResolvedValue({ count: 1 });
        balance = 4000;
        await service.resolveManualReview(WD, finance(ADMIN_A), { outcome: 'failed', reason: 'partner has no record of the transfer' });
        expect(prisma.coinLedger.create.mock.calls[0][0].data).toMatchObject({ amount: 6000, idempotencyKey: `withdrawal_reversal:${uuid(31)}` });
        expect(balance).toBe(10_000);
        expect(prisma.withdrawal.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'failed' });
      });

      it('only needs_manual_review withdrawals can be resolved, only by finance/super_admin, and they cannot be "rejected"', async () => {
        prisma.withdrawal.findUnique.mockResolvedValue({ ...processing });
        await expect(service.resolveManualReview(WD, finance(ADMIN_A), { outcome: 'failed', reason: 'nope' })).rejects.toMatchObject({ code: ErrorCode.WITHDRAWAL_NOT_REVIEWABLE });
        prisma.withdrawal.findUnique.mockResolvedValue({ ...processing, status: 'needs_manual_review' });
        await expect(service.resolveManualReview(WD, { adminId: ADMIN_A, role: 'support' }, { outcome: 'failed', reason: 'nope' })).rejects.toMatchObject({ code: ErrorCode.DUAL_APPROVAL_ROLE_REQUIRED });
        await expect(service.reject(WD, finance(ADMIN_A), 'cannot reject money that may be out')).rejects.toMatchObject({ code: ErrorCode.WITHDRAWAL_NOT_REVIEWABLE });
      });
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
