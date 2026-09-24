import { ErrorCode } from '@rap/shared';
import {
  mockAudit,
  mockNotifications,
  mockPrisma,
  mockSecurity,
  testConfig,
  uuid,
} from '../../../testing/test-utils';
import { LedgerService } from '../../ledger/ledger.service';
import { CoinAdjustmentsService } from './coin-adjustments.service';

const USER = uuid(1);
const REQUESTER = uuid(10);
const APPROVER = uuid(11);
const REQ = uuid(20);

describe('CoinAdjustmentsService (two distinct admins)', () => {
  let prisma: any;
  let service: CoinAdjustmentsService;
  let security: any;
  let balance: number;

  const pending = (over: Record<string, unknown> = {}) => ({
    id: REQ,
    userId: USER,
    amount: 500,
    reason: 'Goodwill',
    status: 'pending_approval',
    requestedBy: REQUESTER,
    ...over,
  });
  const withInclude = (r: Record<string, unknown>) => ({
    ...r,
    user: { phoneNumber: '+251911000000' },
    requester: { email: 'a@rap.et' },
    approver: null,
  });

  beforeEach(() => {
    prisma = mockPrisma();
    security = mockSecurity();
    service = new CoinAdjustmentsService(
      prisma,
      new LedgerService(prisma, testConfig(), security),
      mockAudit(),
      security,
      mockNotifications(),
    );
    balance = 1000;
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
  });

  it('creating a request credits nothing', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: USER, coinBalance: 1000 });
    prisma.coinAdjustmentRequest.create.mockImplementation(async ({ data }: any) =>
      withInclude({ id: REQ, status: 'pending_approval', ...data }),
    );
    const r = await service.create(
      { userId: USER, amount: 500, reason: 'Goodwill credit' },
      { adminId: REQUESTER },
    );
    expect(r.status).toBe('pending_approval');
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    expect(security.info).toHaveBeenCalledWith('adjustment.requested', expect.anything());
  });

  it('rejects zero / fractional amounts and deductions exceeding the balance', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: USER, coinBalance: 100 });
    await expect(
      service.create({ userId: USER, amount: 0, reason: 'x' }, { adminId: REQUESTER }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    await expect(
      service.create({ userId: USER, amount: -500, reason: 'x' }, { adminId: REQUESTER }),
    ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE });
  });

  it('the requesting admin cannot approve their own request', async () => {
    prisma.coinAdjustmentRequest.findUnique.mockResolvedValue(pending());
    await expect(service.approve(REQ, 'self', { adminId: REQUESTER })).rejects.toMatchObject({
      code: ErrorCode.ADJUSTMENT_SELF_APPROVAL_FORBIDDEN,
    });
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
    expect(security.warn).toHaveBeenCalledWith('adjustment.self_approval_blocked', expect.anything());
  });

  it('a different admin approving executes the ledger write exactly once', async () => {
    prisma.coinAdjustmentRequest.findUnique.mockResolvedValue(pending());
    prisma.coinAdjustmentRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.coinAdjustmentRequest.update.mockImplementation(async ({ data }: any) =>
      withInclude({ ...pending({ status: 'executed', approvedBy: APPROVER }), ...data }),
    );
    const r = await service.approve(REQ, 'Looks legit', { adminId: APPROVER });
    expect(r.status).toBe('executed');
    expect(prisma.coinLedger.create).toHaveBeenCalledTimes(1);
    expect(prisma.coinLedger.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      amount: 500,
      sourceType: 'admin_adjustment',
      idempotencyKey: `adjustment:${REQ}`,
      createdBy: REQUESTER,
    });
    expect(balance).toBe(1500);
    expect(prisma.coinAdjustmentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: REQ, status: 'pending_approval' } }),
    );
    expect(security.info).toHaveBeenCalledWith(
      'adjustment.executed',
      expect.objectContaining({ requestedBy: REQUESTER, approvedBy: APPROVER }),
    );
  });

  it('a concurrent second approval loses the claim and writes nothing', async () => {
    prisma.coinAdjustmentRequest.findUnique.mockResolvedValue(pending());
    prisma.coinAdjustmentRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve(REQ, 'race', { adminId: APPROVER })).rejects.toMatchObject({
      code: ErrorCode.ADJUSTMENT_NOT_PENDING,
    });
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('already-decided requests cannot be approved again', async () => {
    prisma.coinAdjustmentRequest.findUnique.mockResolvedValue(pending({ status: 'executed' }));
    await expect(service.approve(REQ, 'again', { adminId: APPROVER })).rejects.toMatchObject({
      code: ErrorCode.ADJUSTMENT_NOT_PENDING,
    });
  });

  it('rejecting never touches the ledger', async () => {
    prisma.coinAdjustmentRequest.findUnique.mockResolvedValue(pending());
    prisma.coinAdjustmentRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.coinAdjustmentRequest.findUniqueOrThrow.mockResolvedValue(
      withInclude(pending({ status: 'rejected' })),
    );
    const r = await service.reject(REQ, 'Not justified', { adminId: APPROVER });
    expect(r.status).toBe('rejected');
    expect(prisma.coinLedger.create).not.toHaveBeenCalled();
  });

  it('only the requester can cancel', async () => {
    prisma.coinAdjustmentRequest.findUnique.mockResolvedValue(pending());
    await expect(service.cancel(REQ, { adminId: APPROVER })).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });
});
