import { Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { StorageService } from '../../infra/storage/storage.service';
import { D, mockAudit, mockPrisma, testConfig, uuid } from '../../testing/test-utils';
import type { WalletWriteInput } from '../wallet/wallet.module';
import { refundKey, reservationKey } from './campaign.economics';
import { CampaignLifecycleService } from './campaign-lifecycle.service';
import { CampaignsService } from './campaigns.service';

const ADVERTISER = uuid(1);
const CAMPAIGN = uuid(2);

/**
 * In-memory stand-in for WalletService.applyEntry with the SAME idempotency semantics as production: a key that
 * was already written is replayed (no balance change, `replayed: true`), a debit below zero is refused.
 */
class FakeWallet {
  balance = new Prisma.Decimal(0);
  readonly entries = new Map<string, { amountEtb: Prisma.Decimal; entryType: string }>();
  constructor(balance: number) {
    this.balance = new Prisma.Decimal(balance);
  }
  applyEntry = jest.fn(async (input: WalletWriteInput) => {
    const amount = new Prisma.Decimal(input.amountEtb);
    const existing = this.entries.get(input.idempotencyKey);
    if (existing) return { entry: { id: input.idempotencyKey, ...existing }, balanceAfterEtb: this.balance, replayed: true };
    const after = this.balance.plus(amount);
    if (after.isNegative()) {
      throw AppException.unprocessable(ErrorCode.INSUFFICIENT_WALLET_BALANCE, 'Insufficient wallet balance', {
        balanceEtb: this.balance.toNumber(),
        requiredEtb: amount.abs().toNumber(),
      });
    }
    this.balance = after;
    this.entries.set(input.idempotencyKey, { amountEtb: amount, entryType: input.entryType });
    return { entry: { id: input.idempotencyKey, amountEtb: amount, entryType: input.entryType }, balanceAfterEtb: after, replayed: false };
  });
  netReservedFor(): Prisma.Decimal {
    let sum = new Prisma.Decimal(0);
    for (const e of this.entries.values()) sum = sum.plus(e.amountEtb);
    return sum.negated();
  }
}

/** Minimal in-memory campaign row driven through the mocked Prisma client. */
function campaignRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CAMPAIGN,
    advertiserId: ADVERTISER,
    title: 'Replay test',
    description: null,
    budgetEtb: D(5000),
    spentEtb: D(0),
    status: 'draft',
    startDate: null,
    endDate: null,
    targetActionType: 'video_view',
    costPerActionEtb: D(2),
    rewardPerActionEtb: D(1),
    takeRateSnapshot: D(0.5),
    attentionCheckEnabled: true,
    frequencyCapPerUserPerDay: 1,
    submittedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    pausedReason: null,
    completedAt: null,
    budgetReservedEtb: D(0),
    submissionSeq: 0,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    _count: { ads: 1 },
    ads: [{ reviewStatus: 'approved' }],
    ...overrides,
  };
}

describe('CampaignsService.addAd creative source (security audit #2: no SSRF, advertiser prefix only)', () => {
  let prisma: any;
  let service: CampaignsService;
  let media: { isEnabled: jest.Mock; enqueue: jest.Mock };
  const storage = new StorageService(testConfig({ S3_PUBLIC_URL: 'http://localhost:9000', S3_BUCKET: 'rap-media' }));
  const base = { title: 'Probe', mediaType: 'video' as const, durationSeconds: 15 };

  beforeEach(() => {
    prisma = mockPrisma();
    prisma.campaign.findFirst.mockResolvedValue(campaignRow({ status: 'draft' }));
    prisma.ad.create.mockImplementation(async ({ data }: any) => ({ id: uuid(50), ...data, reviewStatus: 'pending', _count: { attentionQuestions: 0 }, createdAt: new Date() }));
    media = { isEnabled: jest.fn(() => true), enqueue: jest.fn() };
    service = new CampaignsService(prisma, testConfig(), storage, new FakeWallet(0) as never, mockAudit(), { missingConsents: jest.fn() } as never, media as never);
  });

  it('mediaUrl=http://127.0.0.1:3000/x -> 400 MEDIA_SOURCE_NOT_ALLOWED and nothing is created or enqueued', async () => {
    await expect(service.addAd(ADVERTISER, CAMPAIGN, { ...base, mediaUrl: 'http://127.0.0.1:3000/ssrf-probe' })).rejects.toMatchObject({
      code: ErrorCode.MEDIA_SOURCE_NOT_ALLOWED,
      status: 400,
    });
    await expect(service.addAd(ADVERTISER, CAMPAIGN, { ...base, mediaUrl: 'http://169.254.169.254/latest/meta-data/' })).rejects.toMatchObject({ code: ErrorCode.MEDIA_SOURCE_NOT_ALLOWED });
    expect(prisma.ad.create).not.toHaveBeenCalled();
    expect(media.enqueue).not.toHaveBeenCalled();
  });

  it('storageKey=private/kyc/... (or another advertiser\'s creatives) -> 400 MEDIA_SOURCE_NOT_ALLOWED', async () => {
    for (const storageKey of ['private/kyc/other-user/front.jpg', `creatives/${uuid(9)}/2026-10-01/x.mp4`, `creatives/${ADVERTISER}/../private/exports/x.zip`]) {
      await expect(service.addAd(ADVERTISER, CAMPAIGN, { ...base, storageKey })).rejects.toMatchObject({
        code: ErrorCode.MEDIA_SOURCE_NOT_ALLOWED,
        details: { requiredPrefix: `creatives/${ADVERTISER}/` },
      });
    }
    expect(prisma.ad.create).not.toHaveBeenCalled();
  });

  it('a presigned key under creatives/<advertiserId>/ is accepted and the stored mediaUrl is derived server-side', async () => {
    const storageKey = `creatives/${ADVERTISER}/2026-10-01/clip.mp4`;
    const ad = await service.addAd(ADVERTISER, CAMPAIGN, { ...base, storageKey });
    expect(ad.mediaUrl).toBe(`http://localhost:9000/rap-media/${storageKey}`);
    expect(prisma.ad.create.mock.calls[0][0].data).toMatchObject({ storageKey, mediaUrl: `http://localhost:9000/rap-media/${storageKey}`, mediaStatus: 'processing' });
    expect(media.enqueue).toHaveBeenCalledTimes(1);
  });

  it('a mediaUrl pointing into our own bucket under the advertiser prefix is mapped to its key (backwards compatibility)', async () => {
    const storageKey = `creatives/${ADVERTISER}/2026-10-01/clip.mp4`;
    await service.addAd(ADVERTISER, CAMPAIGN, { ...base, mediaUrl: `http://localhost:9000/rap-media/${storageKey}` });
    expect(prisma.ad.create.mock.calls[0][0].data.storageKey).toBe(storageKey);
    // same bucket, someone else's prefix -> refused
    await expect(service.addAd(ADVERTISER, CAMPAIGN, { ...base, mediaUrl: `http://localhost:9000/rap-media/creatives/${uuid(9)}/x.mp4` })).rejects.toMatchObject({ code: ErrorCode.MEDIA_SOURCE_NOT_ALLOWED });
  });
});

describe('CampaignsService budget reservation (security audit #1: reject -> edit -> resubmit must never replay)', () => {
  let prisma: any;
  let wallet: FakeWallet;
  let service: CampaignsService;
  let lifecycle: CampaignLifecycleService;
  let row: ReturnType<typeof campaignRow>;

  beforeEach(() => {
    prisma = mockPrisma();
    wallet = new FakeWallet(6000);
    row = campaignRow();
    // the mocked Prisma campaign table is the single `row` object; updates mutate it like a real DB would
    prisma.advertiser.findUniqueOrThrow.mockResolvedValue({ verificationStatus: 'verified' });
    prisma.campaign.findFirst.mockImplementation(async () => ({ ...row }));
    prisma.campaign.findUnique.mockImplementation(async () => ({ ...row }));
    prisma.campaign.findUniqueOrThrow.mockImplementation(async () => ({ ...row }));
    prisma.campaign.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.status && row.status !== where.status) return { count: 0 };
      applyUpdate(data);
      return { count: 1 };
    });
    prisma.campaign.update.mockImplementation(async ({ data }: any) => {
      applyUpdate(data);
      return { ...row };
    });
    prisma.advertiserWalletLedger.aggregate.mockImplementation(async () => ({ _sum: { amountEtb: wallet.netReservedFor().negated() } }));
    prisma.adCompletion.groupBy.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([{ id: CAMPAIGN }]);
    const config = testConfig();
    const audit = mockAudit();
    lifecycle = new CampaignLifecycleService(prisma, wallet as never, audit, config);
    service = new CampaignsService(
      prisma,
      config,
      { publicUrl: (k: string) => `http://s3/${k}` } as never,
      wallet as never,
      audit,
      { missingConsents: jest.fn().mockResolvedValue([]) } as never,
      { isEnabled: () => false, enqueue: jest.fn() } as never,
    );

    function applyUpdate(data: Record<string, any>) {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && 'increment' in v) (row as any)[k] = ((row as any)[k] ?? 0) + Number(v.increment);
        else if (v !== undefined) (row as any)[k] = v;
      }
    }
  });

  /** Admin rejection as AdminReviewService does it: lock, flip status, refund the unspent reservation. */
  async function rejectAsAdmin() {
    const locked = await lifecycle.lockCampaign(prisma, CAMPAIGN);
    await prisma.campaign.update({ where: { id: CAMPAIGN }, data: { status: 'rejected' } });
    await lifecycle.refundUnspent(prisma, locked!, 'rejected');
  }

  it('debits the full budget on the first submit with a per-submission key', async () => {
    await service.submit(ADVERTISER, CAMPAIGN);
    expect(row.status).toBe('pending_review');
    expect(row.submissionSeq).toBe(1);
    expect(wallet.balance.toNumber()).toBe(1000);
    expect(wallet.entries.has(reservationKey(CAMPAIGN, 1))).toBe(true);
    expect(wallet.netReservedFor().toNumber()).toBe(5000);
  });

  it('REGRESSION: submit -> reject -> raise budget x2000 -> submit must debit the new budget or fail INSUFFICIENT_WALLET_BALANCE', async () => {
    await service.submit(ADVERTISER, CAMPAIGN);
    await rejectAsAdmin();
    expect(wallet.balance.toNumber()).toBe(6000); // refunded
    expect(wallet.entries.has(refundKey(CAMPAIGN, 1, 'rejected'))).toBe(true);
    expect(row.budgetReservedEtb.toNumber()).toBe(0);

    // advertiser edits the rejected campaign: status -> draft, budget x2000
    await service.update(ADVERTISER, CAMPAIGN, { budgetEtb: 10_000_000 });
    expect(row.status).toBe('draft');
    expect(row.budgetEtb.toNumber()).toBe(10_000_000);

    // the old code replayed `campaign_budget_reservation:<id>` here and set reserved = 10,000,000 for free
    await expect(service.submit(ADVERTISER, CAMPAIGN)).rejects.toMatchObject({
      code: ErrorCode.INSUFFICIENT_WALLET_BALANCE,
      status: 422,
    });
    expect(wallet.balance.toNumber()).toBe(6000);
    expect(wallet.netReservedFor().isZero()).toBe(true);
    expect(row.budgetReservedEtb.toNumber()).toBe(0);
    // the in-transaction status claim is rolled back in production; the mock cannot roll back, so only the money
    // invariants are asserted here (the e2e test covers the status).
  });

  it('a resubmission the wallet CAN afford is debited again under a NEW key (never the refunded one)', async () => {
    await service.submit(ADVERTISER, CAMPAIGN);
    await rejectAsAdmin();
    await service.update(ADVERTISER, CAMPAIGN, { budgetEtb: 5500 });
    await service.submit(ADVERTISER, CAMPAIGN);
    expect(row.submissionSeq).toBe(2);
    expect(wallet.entries.has(reservationKey(CAMPAIGN, 2))).toBe(true);
    expect(wallet.balance.toNumber()).toBe(500);
    expect(wallet.netReservedFor().toNumber()).toBe(5500);
    expect(row.budgetReservedEtb.toNumber()).toBe(5500);
    // a second rejection refunds under its own key too (the first refund key must not swallow it)
    await rejectAsAdmin();
    expect(wallet.entries.has(refundKey(CAMPAIGN, 2, 'rejected'))).toBe(true);
    expect(wallet.balance.toNumber()).toBe(6000);
  });

  it('treats a replayed reservation entry as a hard failure (campaign must not go live unfunded)', async () => {
    wallet.entries.set(reservationKey(CAMPAIGN, 1), { amountEtb: D(-5000), entryType: 'campaign_budget_reservation' });
    await expect(service.submit(ADVERTISER, CAMPAIGN)).rejects.toMatchObject({ code: ErrorCode.CAMPAIGN_INVALID_STATE });
    expect(wallet.balance.toNumber()).toBe(6000);
  });

  it('refuses to change the budget of a draft/rejected campaign while funds are still reserved for it', async () => {
    await service.submit(ADVERTISER, CAMPAIGN);
    // simulate a rejection whose refund did not happen (status flipped, reservation still in the ledger)
    row.status = 'rejected';
    await expect(service.update(ADVERTISER, CAMPAIGN, { budgetEtb: 9999 })).rejects.toMatchObject({
      code: ErrorCode.CAMPAIGN_INVALID_STATE,
      details: { netReservedEtb: 5000 },
    });
    // title edits are still fine
    await expect(service.update(ADVERTISER, CAMPAIGN, { title: 'New title' })).resolves.toMatchObject({ title: 'New title' });
  });

  it('only funds the unspent remainder when a campaign that already spent part of its budget is resubmitted', async () => {
    await service.submit(ADVERTISER, CAMPAIGN); // -5000
    row.spentEtb = D(1200); // users were paid 1200 ETB worth of actions while it was live
    row.status = 'active';
    await rejectAsAdmin(); // refund 5000 - 1200 = 3800 -> balance 4800, reserved = 1200
    expect(wallet.balance.toNumber()).toBe(4800);
    expect(row.budgetReservedEtb.toNumber()).toBe(1200);
    await service.update(ADVERTISER, CAMPAIGN, { title: 'relaunch' }); // -> draft (budget unchanged)
    await service.submit(ADVERTISER, CAMPAIGN); // reserve budget - spent = 3800
    expect(wallet.balance.toNumber()).toBe(1000);
    expect(wallet.entries.get(reservationKey(CAMPAIGN, 2))?.amountEtb.toNumber()).toBe(-3800);
    expect(row.budgetReservedEtb.toNumber()).toBe(5000);
  });
});
