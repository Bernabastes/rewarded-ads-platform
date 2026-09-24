/**
 * Demo seed: makes every dashboard look alive.
 *   pnpm --filter @rap/api seed          (resets ALL data first - development only)
 *
 * All coin balances are produced through the SAME ledger write path as the API (applyLedgerEntry), so the seeded
 * ledger is internally consistent and the reconciliation job reports zero drift.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { applyLedgerEntry } from '../src/modules/ledger/ledger.core';

const prisma = new PrismaClient();

const COINS_PER_ETB = Number(process.env.COINS_PER_ETB ?? 100);
const TAKE_RATE = Number(process.env.PLATFORM_TAKE_RATE ?? 0.5);
const ADMIN_PASSWORD = 'Admin123!';
const ADVERTISER_PASSWORD = 'Advertiser123!';

/* ------------------------------ deterministic helpers ------------------------------ */

let seedState = 20260924;
function rand(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const daysAgo = (days: number, hour = int(6, 22), minute = int(0, 59)) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, minute, int(0, 59), int(0, 999));
  return d;
};
const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const reward = (cost: number) =>
  dec(cost)
    .mul(1 - TAKE_RATE)
    .toDecimalPlaces(2);
const coins = (etb: Prisma.Decimal | number) => dec(etb).mul(COINS_PER_ETB).round().toNumber();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const SAMPLE = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample';
const VIDEOS = [
  { file: 'ForBiggerBlazes', duration: 15 },
  { file: 'ForBiggerEscapes', duration: 15 },
  { file: 'ForBiggerFun', duration: 60 },
  { file: 'ForBiggerJoyrides', duration: 15 },
  { file: 'ForBiggerMeltdowns', duration: 15 },
  { file: 'BigBuckBunny', duration: 30 },
  { file: 'ElephantsDream', duration: 30 },
  { file: 'Sintel', duration: 45 },
];
const video = (i: number) => ({
  mediaUrl: `${SAMPLE}/${VIDEOS[i % VIDEOS.length].file}.mp4`,
  thumbnailUrl: `${SAMPLE}/images/${VIDEOS[i % VIDEOS.length].file}.jpg`,
  durationSeconds: VIDEOS[i % VIDEOS.length].duration,
});

const USER_NAMES = [
  'አበበ ቢቂላ',
  'Tigist Haile',
  'ሰላማዊት ተስፋዬ',
  'Dawit Mekonnen',
  'ሄኖክ ግርማ',
  'Marta Alemu',
  'ዮናስ ታደሰ',
  'Hanna Bekele',
  'ሳሙኤል ወልደ',
  'Rahel Girma',
  'ብሩክ አስፋው',
  'Kalkidan Tesfaye',
  'ናትናኤል ከበደ',
  'Mahlet Yohannes',
  'ኤፍሬም ደሳለኝ',
  'Sara Mulugeta',
  'ቤተልሔም አበራ',
  'Yared Solomon',
  'ሊያ ተክሌ',
  'Biniam Assefa',
  'ሜሮን ፍቅሩ',
  'Eyob Negash',
  'ሩት ዘውዴ',
  'Amanuel Tsegaye',
  'ፍሬህይወት ገብሬ',
];

async function ledger(tx: Prisma.TransactionClient, input: Parameters<typeof applyLedgerEntry>[1]) {
  return applyLedgerEntry(tx, input);
}

async function audit(data: {
  actorType: 'admin' | 'system' | 'user' | 'advertiser';
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  createdAt?: Date;
}) {
  await prisma.auditLog.create({
    data: {
      actorType: data.actorType,
      actorId: data.actorId ?? null,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId ?? null,
      beforeState:
        data.before === undefined
          ? Prisma.JsonNull
          : (JSON.parse(JSON.stringify(data.before)) as Prisma.InputJsonValue),
      afterState:
        data.after === undefined
          ? Prisma.JsonNull
          : (JSON.parse(JSON.stringify(data.after)) as Prisma.InputJsonValue),
      createdAt: data.createdAt ?? new Date(),
    },
  });
}

/* ------------------------------------- reset ------------------------------------- */

async function reset() {
  const tables = [
    'audit_log',
    'notifications',
    'device_push_tokens',
    'ad_reports',
    'coin_adjustment_requests',
    'withdrawal_approvals',
    'withdrawals',
    'fraud_flags',
    'coin_ledger',
    'ad_completions',
    'ad_watch_sessions',
    'attention_questions',
    'survey_responses',
    'surveys',
    'app_install_completions',
    'app_install_offers',
    'ads',
    'campaigns',
    'invoices',
    'advertiser_payments',
    'advertiser_wallet_ledger',
    'advertisers',
    'refresh_tokens',
    'otp_codes',
    'ledger_reconciliation_runs',
    'admin_users',
    'users',
  ];
  // TRUNCATE does not fire the append-only row triggers, so a dev reset stays possible.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/* -------------------------------------- main -------------------------------------- */

async function main() {
  console.log('Seeding demo data...');
  await reset();
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const advertiserHash = await bcrypt.hash(ADVERTISER_PASSWORD, 10);

  /* admins */
  const [superAdmin, reviewer, support, finance, finance2] = await Promise.all(
    [
      { email: 'super@rap.et', fullName: 'Selam Abraham', role: 'super_admin' as const },
      { email: 'reviewer@rap.et', fullName: 'Kebede Alemu', role: 'ad_reviewer' as const },
      { email: 'support@rap.et', fullName: 'Hiwot Tadesse', role: 'support' as const },
      { email: 'finance@rap.et', fullName: 'Mikias Berhanu', role: 'finance' as const },
      { email: 'finance2@rap.et', fullName: 'Aster Wolde', role: 'finance' as const },
    ].map((a) => prisma.adminUser.create({ data: { ...a, passwordHash, lastLoginAt: daysAgo(int(0, 3)) } })),
  );

  /* advertisers */
  const habesha = await prisma.advertiser.create({
    data: {
      businessName: 'Habesha Coffee Roasters PLC',
      businessRegistrationNumber: 'MT/AA/2/0012345/2015',
      contactEmail: 'ads@habesha-coffee.et',
      contactPhone: '+251911000001',
      passwordHash: advertiserHash,
      verificationStatus: 'verified',
      verifiedBy: support.id,
      verifiedAt: daysAgo(40),
      verificationNote: 'Trade licence verified',
      createdAt: daysAgo(45),
    },
  });
  const fintech = await prisma.advertiser.create({
    data: {
      businessName: 'Addis Fintech Solutions',
      businessRegistrationNumber: 'MT/AA/14/0098765/2016',
      contactEmail: 'growth@addisfintech.et',
      contactPhone: '+251911000002',
      passwordHash: advertiserHash,
      verificationStatus: 'verified',
      verifiedBy: support.id,
      verifiedAt: daysAgo(35),
      verificationNote: 'Verified against MoTRI registry',
      createdAt: daysAgo(38),
    },
  });
  const sheger = await prisma.advertiser.create({
    data: {
      businessName: 'Sheger Fashion House',
      businessRegistrationNumber: 'MT/AA/5/0045678/2017',
      contactEmail: 'hello@shegerfashion.et',
      contactPhone: '+251911000003',
      passwordHash: advertiserHash,
      verificationStatus: 'pending',
      createdAt: daysAgo(2),
    },
  });

  /* wallet top-ups (payments + invoices + wallet ledger) */
  async function topup(advertiserId: string, amount: number, when: Date, n: number) {
    const txRef = `RAP-SEED-${advertiserId.slice(0, 6).toUpperCase()}-${n}`;
    const payment = await prisma.advertiserPayment.create({
      data: {
        advertiserId,
        amountEtb: dec(amount),
        txRef,
        gateway: 'chapa',
        mock: true,
        status: 'completed',
        paidAt: when,
        createdAt: when,
        gatewayReference: `MOCK-${txRef}`,
        checkoutUrl: `http://localhost:3000/api/v1/billing/mock-checkout/${txRef}`,
      },
    });
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ wallet_balance_etb: Prisma.Decimal }>
      >`SELECT wallet_balance_etb FROM advertisers WHERE id = ${advertiserId}::uuid FOR UPDATE`;
      const after = dec(rows[0].wallet_balance_etb).plus(amount);
      await tx.advertiserWalletLedger.create({
        data: {
          advertiserId,
          amountEtb: dec(amount),
          balanceAfterEtb: after,
          entryType: 'topup',
          referenceType: 'payment',
          referenceId: payment.id,
          idempotencyKey: `topup:${payment.id}`,
          description: `Top-up ${txRef}`,
          createdAt: when,
        },
      });
      await tx.advertiser.update({ where: { id: advertiserId }, data: { walletBalanceEtb: after } });
    });
    await prisma.invoice.create({
      data: {
        advertiserId,
        invoiceNumber: `INV-${when.getUTCFullYear()}-${payment.id.slice(0, 8).toUpperCase()}`,
        status: 'paid',
        subtotalEtb: dec(amount),
        vatEtb: dec(0),
        totalEtb: dec(amount),
        lineItems: [
          {
            description: `Advertising wallet top-up (${txRef})`,
            quantity: 1,
            unitPriceEtb: amount,
            totalEtb: amount,
          },
        ],
        paymentId: payment.id,
        issuedAt: when,
        paidAt: when,
        createdAt: when,
      },
    });
    await audit({
      actorType: 'system',
      action: 'payment.settled_mock',
      targetType: 'advertiser_payment',
      targetId: payment.id,
      after: { amountEtb: amount, txRef },
      createdAt: when,
    });
  }
  await topup(habesha.id, 15000, daysAgo(30), 1);
  await topup(habesha.id, 5000, daysAgo(12), 2);
  await topup(fintech.id, 25000, daysAgo(28), 1);
  await topup(fintech.id, 10000, daysAgo(9), 2);
  // pending + failed payments for history
  await prisma.advertiserPayment.create({
    data: {
      advertiserId: fintech.id,
      amountEtb: dec(5000),
      txRef: 'RAP-SEED-PENDING-1',
      gateway: 'chapa',
      mock: true,
      status: 'pending',
      checkoutUrl: 'http://localhost:3000/api/v1/billing/mock-checkout/RAP-SEED-PENDING-1',
      createdAt: daysAgo(0, 8),
    },
  });
  await prisma.advertiserPayment.create({
    data: {
      advertiserId: habesha.id,
      amountEtb: dec(2000),
      txRef: 'RAP-SEED-FAILED-1',
      gateway: 'chapa',
      mock: true,
      status: 'failed',
      createdAt: daysAgo(5),
    },
  });

  /* campaigns */
  async function campaign(data: {
    advertiserId: string;
    title: string;
    description: string;
    budget: number;
    cost: number;
    type: 'video_view' | 'survey' | 'app_install';
    status: 'draft' | 'pending_review' | 'active' | 'paused' | 'completed' | 'rejected';
    createdDaysAgo: number;
    spent?: number;
    pausedReason?: string;
    rejectionReason?: string;
    reserve?: boolean;
    attention?: boolean;
  }) {
    const c = await prisma.campaign.create({
      data: {
        advertiserId: data.advertiserId,
        title: data.title,
        description: data.description,
        budgetEtb: dec(data.budget),
        spentEtb: dec(data.spent ?? 0),
        status: data.status,
        targetActionType: data.type,
        costPerActionEtb: dec(data.cost),
        rewardPerActionEtb: reward(data.cost),
        takeRateSnapshot: dec(TAKE_RATE),
        attentionCheckEnabled: data.attention ?? true,
        startDate: daysAgo(data.createdDaysAgo),
        endDate: data.status === 'completed' ? daysAgo(3) : null,
        submittedAt: data.status === 'draft' ? null : daysAgo(data.createdDaysAgo - 1),
        reviewedAt: ['active', 'paused', 'completed', 'rejected'].includes(data.status)
          ? daysAgo(data.createdDaysAgo - 2)
          : null,
        reviewedBy: ['active', 'paused', 'completed', 'rejected'].includes(data.status) ? reviewer.id : null,
        pausedReason: data.pausedReason,
        rejectionReason: data.rejectionReason,
        completedAt: data.status === 'completed' ? daysAgo(3) : null,
        budgetReservedEtb:
          data.reserve === false
            ? dec(0)
            : data.status === 'draft'
              ? dec(0)
              : dec(
                  data.status === 'completed' || data.status === 'rejected' ? (data.spent ?? 0) : data.budget,
                ),
        createdAt: daysAgo(data.createdDaysAgo),
      },
    });
    if (data.status !== 'draft') {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ wallet_balance_etb: Prisma.Decimal }>
        >`SELECT wallet_balance_etb FROM advertisers WHERE id = ${data.advertiserId}::uuid FOR UPDATE`;
        const after = dec(rows[0].wallet_balance_etb).minus(data.budget);
        await tx.advertiserWalletLedger.create({
          data: {
            advertiserId: data.advertiserId,
            amountEtb: dec(data.budget).negated(),
            balanceAfterEtb: after,
            entryType: 'campaign_budget_reservation',
            referenceType: 'campaign',
            referenceId: c.id,
            idempotencyKey: `campaign_budget_reservation:${c.id}`,
            description: `Budget reservation for "${data.title}"`,
            createdAt: daysAgo(data.createdDaysAgo - 1),
          },
        });
        await tx.advertiser.update({ where: { id: data.advertiserId }, data: { walletBalanceEtb: after } });
        if (data.status === 'completed' || data.status === 'rejected') {
          const refund = dec(data.budget).minus(data.spent ?? 0);
          if (refund.greaterThan(0)) {
            await tx.advertiserWalletLedger.create({
              data: {
                advertiserId: data.advertiserId,
                amountEtb: refund,
                balanceAfterEtb: after.plus(refund),
                entryType: 'campaign_budget_refund',
                referenceType: 'campaign',
                referenceId: c.id,
                idempotencyKey: `campaign_budget_refund:${c.id}:seed`,
                description: `Unspent budget released for "${data.title}"`,
                createdAt: daysAgo(3),
              },
            });
            await tx.advertiser.update({
              where: { id: data.advertiserId },
              data: { walletBalanceEtb: after.plus(refund) },
            });
          }
        }
      });
      await audit({
        actorType: 'advertiser',
        actorId: data.advertiserId,
        action: 'campaign.submitted',
        targetType: 'campaign',
        targetId: c.id,
        after: { status: 'pending_review', reservedEtb: data.budget },
        createdAt: daysAgo(data.createdDaysAgo - 1),
      });
      if (['active', 'paused', 'completed'].includes(data.status))
        await audit({
          actorType: 'admin',
          actorId: reviewer.id,
          action: 'campaign.approved',
          targetType: 'campaign',
          targetId: c.id,
          before: { status: 'pending_review' },
          after: { status: 'active' },
          createdAt: daysAgo(data.createdDaysAgo - 2),
        });
      if (data.status === 'rejected')
        await audit({
          actorType: 'admin',
          actorId: reviewer.id,
          action: 'campaign.rejected',
          targetType: 'campaign',
          targetId: c.id,
          before: { status: 'pending_review' },
          after: { status: 'rejected', reason: data.rejectionReason },
          createdAt: daysAgo(data.createdDaysAgo - 2),
        });
    }
    return c;
  }

  const cBuna = await campaign({
    advertiserId: habesha.id,
    title: 'Buna Time - Morning Roast launch',
    description: 'Introducing our single-origin Yirgacheffe morning roast. 30-second brand film.',
    budget: 5000,
    cost: 2,
    type: 'video_view',
    status: 'active',
    createdDaysAgo: 26,
  });
  const cLoyalty = await campaign({
    advertiserId: habesha.id,
    title: 'Habesha loyalty card awareness',
    description: 'Collect stamps, get the 10th cup free.',
    budget: 1500,
    cost: 1.5,
    type: 'video_view',
    status: 'paused',
    pausedReason: 'advertiser_paused',
    createdDaysAgo: 20,
  });
  const cSurvey = await campaign({
    advertiserId: habesha.id,
    title: 'Coffee taste preferences survey',
    description: 'Help us pick our next roast profile.',
    budget: 3000,
    cost: 10,
    type: 'survey',
    status: 'active',
    createdDaysAgo: 18,
    attention: false,
  });
  const cInstall = await campaign({
    advertiserId: fintech.id,
    title: 'Download AddisPay',
    description: 'Install AddisPay and open it once.',
    budget: 8000,
    cost: 20,
    type: 'app_install',
    status: 'active',
    createdDaysAgo: 24,
    attention: false,
  });
  const cSave = await campaign({
    advertiserId: fintech.id,
    title: 'Save with AddisPay - explainer',
    description: 'How goal-based savings work in AddisPay.',
    budget: 4000,
    cost: 2.5,
    type: 'video_view',
    status: 'active',
    createdDaysAgo: 22,
  });
  const cEid = await campaign({
    advertiserId: fintech.id,
    title: 'Eid transfer promo',
    description: 'Zero-fee transfers during the holiday week.',
    budget: 2000,
    cost: 2,
    type: 'video_view',
    status: 'pending_review',
    createdDaysAgo: 2,
  });
  const cOld = await campaign({
    advertiserId: fintech.id,
    title: 'AddisPay launch (Q2)',
    description: 'Launch campaign, fully delivered.',
    budget: 3000,
    cost: 2,
    type: 'video_view',
    status: 'completed',
    spent: 3000,
    createdDaysAgo: 34,
  });
  const cDraft = await campaign({
    advertiserId: sheger.id,
    title: 'Meskel collection',
    description: 'New season, new colours.',
    budget: 2500,
    cost: 2,
    type: 'video_view',
    status: 'draft',
    createdDaysAgo: 1,
  });
  await campaign({
    advertiserId: habesha.id,
    title: 'Happy hour (rejected)',
    description: 'Evening discounts.',
    budget: 800,
    cost: 2,
    type: 'video_view',
    status: 'rejected',
    rejectionReason: 'Creative promotes alcohol (banned topic).',
    createdDaysAgo: 15,
    spent: 0,
  });

  /* ads */
  const allChecked = {
    checks: {
      alcohol: true,
      gambling: true,
      restricted_medicine: true,
      political: true,
      tobacco: true,
      adult: true,
      weapons: true,
      misleading_financial: true,
    },
  };
  async function ad(
    campaignId: string,
    title: string,
    i: number,
    status: 'approved' | 'pending' | 'rejected',
    questions: Array<{ prompt: string; promptAm?: string; options: string[]; correctIndex: number }> = [],
    rejectionReason?: string,
  ) {
    const v = video(i);
    const created = await prisma.ad.create({
      data: {
        campaignId,
        title,
        description: `${title} - demo creative`,
        ...v,
        mediaType: 'video',
        reviewStatus: status,
        reviewedBy: status === 'pending' ? null : reviewer.id,
        reviewedAt: status === 'pending' ? null : daysAgo(int(5, 20)),
        rejectionReason,
        bannedTopicsChecklist: status === 'approved' ? allChecked : undefined,
        createdAt: daysAgo(int(2, 25)),
        attentionQuestions: {
          create: questions.map((q) => ({
            prompt: q.prompt,
            promptAm: q.promptAm,
            options: q.options,
            correctIndex: q.correctIndex,
          })),
        },
      },
    });
    if (status !== 'pending')
      await audit({
        actorType: 'admin',
        actorId: reviewer.id,
        action: status === 'approved' ? 'ad.approved' : 'ad.rejected',
        targetType: 'ad',
        targetId: created.id,
        before: { reviewStatus: 'pending' },
        after: { reviewStatus: status, reason: rejectionReason },
        createdAt: created.reviewedAt ?? new Date(),
      });
    return created;
  }
  const adBuna1 = await ad(cBuna.id, 'Morning Roast - 15s spot', 0, 'approved', [
    {
      prompt: 'Which product was featured?',
      promptAm: 'የቀረበው ምርት ምንድን ነው?',
      options: ['Morning Roast coffee', 'Green tea', 'Bottled water'],
      correctIndex: 0,
    },
  ]);
  const adBuna2 = await ad(cBuna.id, 'Morning Roast - origin story', 5, 'approved', [
    {
      prompt: 'Where are the beans from?',
      promptAm: 'ቡናው ከየት ነው?',
      options: ['Yirgacheffe', 'Brazil', 'Vietnam'],
      correctIndex: 0,
    },
  ]);
  await ad(cBuna.id, 'Morning Roast - vertical cut', 1, 'pending');
  const adLoyalty = await ad(cLoyalty.id, 'Loyalty card - 10th cup free', 3, 'approved', [
    { prompt: 'Which cup is free?', options: ['5th', '10th', '20th'], correctIndex: 1 },
  ]);
  const adSave1 = await ad(cSave.id, 'AddisPay savings goals', 2, 'approved', [
    {
      prompt: 'What feature was explained?',
      promptAm: 'የተገለጸው ባህሪ ምንድን ነው?',
      options: ['Loans', 'Savings goals', 'Insurance'],
      correctIndex: 1,
    },
  ]);
  const adSave2 = await ad(cSave.id, 'AddisPay - send money in seconds', 4, 'approved', [
    { prompt: 'How fast are transfers?', options: ['Seconds', 'Days', 'Weeks'], correctIndex: 0 },
  ]);
  await ad(cEid.id, 'Eid promo - 15s', 6, 'pending');
  const adOld = await ad(cOld.id, 'AddisPay launch film', 7, 'approved');
  await ad(cDraft.id, 'Meskel lookbook', 1, 'pending');
  await ad(
    cSave.id,
    'AddisPay - old cut',
    3,
    'rejected',
    [],
    'Text unreadable on small screens; please re-upload with larger captions.',
  );

  /* offers */
  const survey = await prisma.survey.create({
    data: {
      campaignId: cSurvey.id,
      title: 'Coffee taste preferences',
      description: '5 quick questions about how you drink coffee.',
      rewardEtb: reward(10),
      estimatedMinutes: 3,
      active: true,
      createdAt: daysAgo(17),
      details: {
        questions: [
          {
            id: 'q1',
            type: 'single_choice',
            prompt: 'How often do you drink coffee?',
            promptAm: 'ቡና ምን ያህል ጊዜ ይጠጣሉ?',
            options: ['Daily', 'Few times a week', 'Rarely'],
            required: true,
          },
          {
            id: 'q2',
            type: 'multi_choice',
            prompt: 'Which roast levels do you enjoy?',
            options: ['Light', 'Medium', 'Dark'],
            required: true,
          },
          {
            id: 'q3',
            type: 'rating',
            prompt: 'Rate the importance of origin (1-5)',
            min: 1,
            max: 5,
            required: true,
          },
          {
            id: 'q4',
            type: 'single_choice',
            prompt: 'Where do you usually buy coffee?',
            options: ['Supermarket', 'Local roaster', 'Online'],
            required: false,
          },
          {
            id: 'q5',
            type: 'text',
            prompt: 'Anything you would like to see from Habesha Coffee?',
            required: false,
          },
        ],
      },
    },
  });
  const installOffer = await prisma.appInstallOffer.create({
    data: {
      campaignId: cInstall.id,
      appName: 'AddisPay',
      packageName: 'et.addispay.app',
      storeUrl: 'https://play.google.com/store/apps/details?id=et.addispay.app',
      iconUrl: 'https://placehold.co/128x128/0f4c81/ffffff?text=AP',
      rewardEtb: reward(20),
      active: true,
      createdAt: daysAgo(23),
      details: {
        description: 'Mobile wallet with goal-based savings.',
        instructions:
          'Install AddisPay from the Play Store and open it once. Verification takes up to 24 hours.',
      },
    },
  });

  /* users */
  const sharedDevice = 'fp_shared_device_7f3a';
  const users = [] as Array<{
    id: string;
    name: string;
    phone: string;
    device: string;
    trust: number;
    status: string;
    createdAt: Date;
  }>;
  for (let i = 0; i < USER_NAMES.length; i++) {
    const name = USER_NAMES[i];
    const phone = `+2519${String(11000000 + i * 137).padStart(8, '0')}`;
    const status = i === 21 ? 'suspended' : i === 22 ? 'suspended' : i === 23 ? 'banned' : 'active';
    const device = i >= 18 && i <= 20 ? sharedDevice : `fp_${sha(phone).slice(0, 12)}`;
    const createdAt = daysAgo(i === 24 ? 0 : int(3, 40));
    const dob = i === 24 ? null : new Date(Date.UTC(1975 + int(0, 30), int(0, 11), int(1, 28)));
    const u = await prisma.user.create({
      data: {
        phoneNumber: phone,
        phoneVerifiedAt: createdAt,
        fullName: i === 24 ? null : name,
        dateOfBirth: dob,
        ageVerificationStatus: i === 24 ? 'pending' : 'verified_adult',
        deviceId: `dev-${i}`,
        languagePreference: i % 3 === 0 ? 'en' : 'am',
        trustScore:
          status === 'banned'
            ? 0
            : status === 'suspended'
              ? 15
              : i >= 18 && i <= 20
                ? int(25, 40)
                : int(45, 90),
        status: status as 'active' | 'suspended' | 'banned',
        statusReason:
          status === 'active'
            ? null
            : status === 'banned'
              ? 'Confirmed multi-account fraud ring'
              : 'Shared device across accounts; pending review',
        createdAt,
        lastLoginAt: daysAgo(int(0, 2)),
        lastIp: `196.188.${int(1, 254)}.${int(1, 254)}`,
      },
    });
    users.push({ id: u.id, name, phone, device, trust: u.trustScore, status, createdAt });
  }
  // age-rejected demo account
  await prisma.user.create({
    data: {
      phoneNumber: '+251900000017',
      phoneVerifiedAt: daysAgo(1),
      fullName: 'Kidus Tesfa',
      dateOfBirth: new Date(Date.UTC(2011, 5, 1)),
      ageVerificationStatus: 'rejected',
      statusReason: 'age_restricted:15',
      trustScore: 50,
      createdAt: daysAgo(1),
    },
  });

  /* completions + ledger */
  const approvedAds = [
    { ad: adBuna1, campaign: cBuna },
    { ad: adBuna2, campaign: cBuna },
    { ad: adLoyalty, campaign: cLoyalty },
    { ad: adSave1, campaign: cSave },
    { ad: adSave2, campaign: cSave },
    { ad: adOld, campaign: cOld },
  ];
  const spentByCampaign = new Map<string, Prisma.Decimal>();
  let flaggedCount = 0;
  const flaggedCompletionIds: string[] = [];
  for (const user of users) {
    if (user.status !== 'active' && user.status !== 'suspended') continue;
    const n = user.status === 'suspended' ? 6 : int(4, 14);
    const seen = new Set<string>();
    for (let k = 0; k < n; k++) {
      const pair = pick(approvedAds);
      if (seen.has(pair.ad.id)) continue;
      seen.add(pair.ad.id);
      const when = daysAgo(int(0, 27));
      const startedAt = new Date(when.getTime() - (pair.ad.durationSeconds + int(0, 5)) * 1000);
      const isBadDevice = user.device === sharedDevice;
      const roll = rand();
      const status: 'valid' | 'flagged' | 'rejected' =
        isBadDevice && roll < 0.6 ? 'flagged' : roll < 0.06 ? 'rejected' : roll < 0.12 ? 'flagged' : 'valid';
      const rewardEtb = pair.campaign.rewardPerActionEtb;
      const session = await prisma.adWatchSession.create({
        data: {
          userId: user.id,
          adId: pair.ad.id,
          startedAt,
          lastHeartbeatAt: when,
          heartbeatCount: Math.floor(pair.ad.durationSeconds / 10),
          expectedDurationSeconds: pair.ad.durationSeconds,
          expiresAt: new Date(startedAt.getTime() + 1800_000),
          deviceFingerprint: user.device,
          deviceId: `dev-${user.phone.slice(-2)}`,
          ipAddress: `196.188.${int(1, 254)}.${int(1, 254)}`,
          status: status === 'rejected' ? 'rejected' : 'completed',
          completedAt: when,
          rejectionCode: status === 'rejected' ? 'WATCH_DURATION_INSUFFICIENT' : null,
          createdAt: startedAt,
        },
      });
      const flags =
        status === 'flagged'
          ? isBadDevice
            ? ['DEVICE_SHARED_ACCOUNTS']
            : ['IP_VELOCITY', 'HEARTBEAT_SPARSE']
          : [];
      const completion = await prisma.adCompletion.create({
        data: {
          userId: user.id,
          adId: pair.ad.id,
          campaignId: pair.campaign.id,
          watchSessionId: session.id,
          startedAt,
          completedAt: when,
          watchDurationSeconds:
            status === 'rejected'
              ? Math.floor(pair.ad.durationSeconds * 0.5)
              : pair.ad.durationSeconds + int(0, 4),
          deviceFingerprint: user.device,
          ipAddress: session.ipAddress,
          fraudFlags: flags,
          fraudScore: status === 'flagged' ? int(40, 70) : status === 'rejected' ? 0 : int(0, 20),
          attentionAnswerCorrect: status === 'rejected' ? null : true,
          coinRewardAmount: status === 'valid' ? coins(rewardEtb) : 0,
          rewardEtb: status === 'valid' ? rewardEtb : 0,
          costEtb: status === 'valid' ? pair.campaign.costPerActionEtb : 0,
          status,
          rejectionCode: status === 'rejected' ? 'WATCH_DURATION_INSUFFICIENT' : null,
          createdAt: when,
        },
      });
      if (status === 'valid') {
        await prisma.$transaction((tx) =>
          ledger(tx, {
            userId: user.id,
            amount: coins(rewardEtb),
            sourceType: 'ad_view',
            sourceId: completion.id,
            idempotencyKey: `ad_completion:${session.id}`,
            description: `Reward for watching "${pair.ad.title}"`,
          }),
        );
        spentByCampaign.set(
          pair.campaign.id,
          (spentByCampaign.get(pair.campaign.id) ?? dec(0)).plus(pair.campaign.costPerActionEtb),
        );
        if (rand() < 0.5)
          await prisma.notification.create({
            data: {
              userId: user.id,
              type: 'reward_confirmed',
              title: 'Reward confirmed',
              body: `You earned ${coins(rewardEtb)} coins for watching "${pair.ad.title}".`,
              data: { completionId: completion.id },
              pushStatus: 'sent',
              sentAt: when,
              readAt: rand() < 0.5 ? when : null,
              createdAt: when,
            },
          });
      } else if (status === 'flagged') {
        flaggedCount++;
        flaggedCompletionIds.push(completion.id);
        for (const f of flags) {
          await prisma.fraudFlag.create({
            data: {
              userId: user.id,
              relatedEntityType: 'ad_completion',
              relatedEntityId: completion.id,
              flagType: f,
              severity: f === 'DEVICE_SHARED_ACCOUNTS' ? 'high' : f === 'IP_VELOCITY' ? 'medium' : 'low',
              description:
                f === 'DEVICE_SHARED_ACCOUNTS'
                  ? 'Device fingerprint used by several different accounts (multi-account farming).'
                  : f === 'IP_VELOCITY'
                    ? 'Unusually many completions from the same IP address in the last hour.'
                    : 'Heartbeats received but fewer than expected for the watch duration.',
              metadata: { score: 55, outcome: 'flagged' },
              trustScoreDelta: f === 'DEVICE_SHARED_ACCOUNTS' ? -10 : f === 'IP_VELOCITY' ? -5 : -1,
              resolved: rand() < 0.3,
              resolution: rand() < 0.5 ? 'dismissed' : 'escalated',
              resolvedBy: rand() < 0.5 ? support.id : null,
              createdAt: when,
            },
          });
        }
      }
    }
  }
  // fix resolved/resolution consistency and campaign spend
  await prisma.fraudFlag.updateMany({
    where: { resolved: false },
    data: { resolution: null, resolvedBy: null },
  });
  await prisma.fraudFlag.updateMany({
    where: { resolved: true, resolvedBy: null },
    data: { resolvedBy: support.id },
  });
  await prisma.$executeRaw`UPDATE fraud_flags SET resolved_at = created_at + interval '1 day', resolution_note = 'Reviewed during weekly fraud sweep' WHERE resolved = true`;
  for (const [campaignId, spent] of spentByCampaign) {
    if (campaignId === cOld.id) continue;
    await prisma.campaign.update({ where: { id: campaignId }, data: { spentEtb: spent } });
  }

  /* survey responses + app installs */
  for (const user of users.slice(0, 9)) {
    if (user.status !== 'active') continue;
    const when = daysAgo(int(0, 15));
    const response = await prisma.surveyResponse.create({
      data: {
        surveyId: survey.id,
        userId: user.id,
        answers: [
          { questionId: 'q1', value: String(int(0, 2)) },
          { questionId: 'q2', value: ['1', '2'] },
          { questionId: 'q3', value: int(3, 5) },
          { questionId: 'q4', value: '1' },
        ],
        coinReward: coins(survey.rewardEtb),
        status: 'valid',
        completedAt: when,
      },
    });
    await prisma.$transaction((tx) =>
      ledger(tx, {
        userId: user.id,
        amount: coins(survey.rewardEtb),
        sourceType: 'survey',
        sourceId: response.id,
        idempotencyKey: `survey_response:${response.id}`,
        description: `Survey: ${survey.title}`,
      }),
    );
    await prisma.campaign.update({
      where: { id: cSurvey.id },
      data: { spentEtb: { increment: cSurvey.costPerActionEtb } },
    });
  }
  const installVerified = await prisma.appInstallCompletion.create({
    data: {
      offerId: installOffer.id,
      userId: users[1].id,
      deviceFingerprint: users[1].device,
      status: 'valid',
      coinReward: coins(installOffer.rewardEtb),
      verifiedBy: support.id,
      verifiedAt: daysAgo(6),
      createdAt: daysAgo(7),
    },
  });
  await prisma.$transaction((tx) =>
    ledger(tx, {
      userId: users[1].id,
      amount: coins(installOffer.rewardEtb),
      sourceType: 'app_install',
      sourceId: installVerified.id,
      idempotencyKey: `app_install:${installVerified.id}`,
      description: 'Install verified: AddisPay',
    }),
  );
  await prisma.campaign.update({
    where: { id: cInstall.id },
    data: { spentEtb: { increment: cInstall.costPerActionEtb } },
  });
  await prisma.appInstallCompletion.create({
    data: {
      offerId: installOffer.id,
      userId: users[3].id,
      deviceFingerprint: users[3].device,
      proof: 'attribution-token-demo-3f9a',
      status: 'pending_verification',
      coinReward: coins(installOffer.rewardEtb),
      createdAt: daysAgo(0, 9),
    },
  });
  await prisma.appInstallCompletion.create({
    data: {
      offerId: installOffer.id,
      userId: users[5].id,
      deviceFingerprint: users[5].device,
      status: 'pending_verification',
      coinReward: coins(installOffer.rewardEtb),
      createdAt: daysAgo(1),
    },
  });

  /* withdrawals in every status */
  async function withdrawal(
    userIdx: number,
    amountEtb: number,
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'flagged_for_review' | 'rejected',
    opts: {
      isFirst?: boolean;
      dual?: boolean;
      approvals?: string[];
      failureReason?: string;
      daysAgo?: number;
      method?: 'telebirr' | 'bank' | 'cbe_birr';
    } = {},
  ) {
    const user = users[userIdx];
    const coinAmount = amountEtb * COINS_PER_ETB;
    const bal = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { coinBalance: true },
    });
    if (bal.coinBalance < coinAmount) {
      // top the demo account up through the two-step adjustment path so the ledger stays consistent
      const req = await prisma.coinAdjustmentRequest.create({
        data: {
          userId: user.id,
          amount: coinAmount,
          reason: 'Demo data: seed balance for withdrawal history',
          reference: 'SEED',
          status: 'executed',
          requestedBy: finance.id,
          approvedBy: superAdmin.id,
          executedAt: daysAgo(opts.daysAgo ?? 3),
          createdAt: daysAgo((opts.daysAgo ?? 3) + 1),
        },
      });
      const w = await prisma.$transaction((tx) =>
        ledger(tx, {
          userId: user.id,
          amount: coinAmount,
          sourceType: 'admin_adjustment',
          sourceId: req.id,
          idempotencyKey: `adjustment:${req.id}`,
          description: req.reason,
          createdBy: finance.id,
        }),
      );
      await prisma.coinAdjustmentRequest.update({
        where: { id: req.id },
        data: { ledgerEntryId: w.entry.id },
      });
      await audit({
        actorType: 'admin',
        actorId: superAdmin.id,
        action: 'coin_adjustment.approved',
        targetType: 'coin_adjustment_request',
        targetId: req.id,
        before: { status: 'pending_approval' },
        after: { status: 'executed', amount: coinAmount, requestedBy: finance.id, approvedBy: superAdmin.id },
        createdAt: req.executedAt!,
      });
    }
    const requestedAt = daysAgo(opts.daysAgo ?? int(0, 12));
    const method = opts.method ?? 'telebirr';
    const reviewReasons = [
      ...(opts.isFirst ? ['first_withdrawal'] : []),
      ...(opts.dual ? ['large_amount'] : []),
    ];
    const w = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        amountEtb: dec(amountEtb),
        coinAmount,
        payoutMethod: method,
        payoutDestination: method === 'bank' ? '1000234567890' : user.phone,
        destinationName: method === 'bank' ? user.name : null,
        bankCode: method === 'bank' ? '946' : null,
        status,
        reviewReasons,
        isFirstWithdrawal: Boolean(opts.isFirst),
        requiresDualApproval: Boolean(opts.dual),
        failureReason: opts.failureReason,
        providerName: ['processing', 'completed', 'failed'].includes(status)
          ? method === 'bank'
            ? 'chapa'
            : 'telebirr'
          : null,
        providerPayoutId: ['processing', 'completed', 'failed'].includes(status)
          ? `MOCK-TB-${requestedAt.getTime()}-SEED${userIdx}`
          : null,
        attempts: ['processing', 'completed', 'failed'].includes(status) ? 1 : 0,
        requestedAt,
        processedAt: ['completed', 'failed', 'rejected'].includes(status)
          ? new Date(requestedAt.getTime() + 3600_000)
          : null,
        processedBy: status === 'rejected' || (opts.approvals?.length ?? 0) > 0 ? finance.id : null,
        createdAt: requestedAt,
      },
    });
    const hold = await prisma.$transaction((tx) =>
      ledger(tx, {
        userId: user.id,
        amount: -coinAmount,
        sourceType: 'withdrawal',
        sourceId: w.id,
        idempotencyKey: `withdrawal_hold:${w.id}`,
        description: `Withdrawal ${amountEtb.toFixed(2)} ETB via ${method}`,
      }),
    );
    let reversalId: string | null = null;
    if (status === 'failed' || status === 'rejected') {
      const rev = await prisma.$transaction((tx) =>
        ledger(tx, {
          userId: user.id,
          amount: coinAmount,
          sourceType: 'withdrawal_reversal',
          sourceId: w.id,
          idempotencyKey: `withdrawal_reversal:${w.id}:${status === 'failed' ? 1 : 0}`,
          description:
            status === 'failed'
              ? `Payout failed: ${opts.failureReason}`
              : 'Withdrawal rejected: destination name mismatch',
        }),
      );
      reversalId = rev.entry.id;
    }
    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { ledgerHoldEntryId: hold.entry.id, ledgerReversalEntryId: reversalId },
    });
    for (const adminId of opts.approvals ?? [])
      await prisma.withdrawalApproval.create({
        data: {
          withdrawalId: w.id,
          adminId,
          decision: 'approved',
          note: 'Identity and destination verified',
          createdAt: new Date(requestedAt.getTime() + 1800_000),
        },
      });
    await audit({
      actorType: 'user',
      actorId: user.id,
      action: 'withdrawal.requested',
      targetType: 'withdrawal',
      targetId: w.id,
      after: { status: reviewReasons.length ? 'flagged_for_review' : 'pending', amountEtb, reviewReasons },
      createdAt: requestedAt,
    });
    if (status === 'completed')
      await audit({
        actorType: 'system',
        action: 'withdrawal.completed',
        targetType: 'withdrawal',
        targetId: w.id,
        before: { status: 'processing' },
        after: { status: 'completed' },
        createdAt: new Date(requestedAt.getTime() + 3600_000),
      });
    if (status === 'rejected')
      await audit({
        actorType: 'admin',
        actorId: finance.id,
        action: 'withdrawal.rejected',
        targetType: 'withdrawal',
        targetId: w.id,
        before: { status: 'flagged_for_review' },
        after: { status: 'rejected', reason: 'Destination name mismatch' },
        createdAt: new Date(requestedAt.getTime() + 3600_000),
      });
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'withdrawal_status',
        title: `Withdrawal ${status.replace(/_/g, ' ')}`,
        body: `Your withdrawal of ${amountEtb.toFixed(2)} ETB is ${status.replace(/_/g, ' ')}.`,
        data: { withdrawalId: w.id, status },
        pushStatus: 'sent',
        sentAt: requestedAt,
        createdAt: requestedAt,
      },
    });
    return w;
  }
  await withdrawal(1, 120, 'completed', { daysAgo: 10 });
  await withdrawal(1, 80, 'completed', { daysAgo: 4 });
  await withdrawal(3, 200, 'completed', { daysAgo: 8, method: 'bank' });
  await withdrawal(4, 60, 'pending', { daysAgo: 0 });
  await withdrawal(6, 150, 'processing', { daysAgo: 0 });
  await withdrawal(7, 90, 'failed', {
    daysAgo: 2,
    failureReason: 'MOCK: partner rejected the transfer (simulated failure)',
  });
  await withdrawal(8, 75, 'flagged_for_review', { isFirst: true, daysAgo: 0 });
  await withdrawal(9, 650, 'flagged_for_review', { dual: true, approvals: [finance.id], daysAgo: 1 });
  await withdrawal(10, 55, 'flagged_for_review', { isFirst: true, daysAgo: 1, method: 'cbe_birr' });
  await withdrawal(11, 100, 'rejected', { isFirst: true, daysAgo: 6 });

  /* coin adjustment requests: pending (awaiting second approval), rejected */
  const pendingAdj = await prisma.coinAdjustmentRequest.create({
    data: {
      userId: users[2].id,
      amount: 500,
      reason: 'Goodwill credit for video playback failure (ticket #452)',
      reference: 'TICKET-452',
      status: 'pending_approval',
      requestedBy: finance.id,
      createdAt: daysAgo(0, 10),
    },
  });
  await audit({
    actorType: 'admin',
    actorId: finance.id,
    action: 'coin_adjustment.requested',
    targetType: 'coin_adjustment_request',
    targetId: pendingAdj.id,
    after: { userId: users[2].id, amount: 500, status: 'pending_approval' },
    createdAt: pendingAdj.createdAt,
  });
  const rejectedAdj = await prisma.coinAdjustmentRequest.create({
    data: {
      userId: users[12].id,
      amount: -300,
      reason: 'Reverse suspected duplicate credit',
      status: 'rejected',
      requestedBy: finance2.id,
      rejectedBy: superAdmin.id,
      decisionNote: 'No duplicate found in ledger',
      createdAt: daysAgo(5),
      updatedAt: daysAgo(4),
    },
  });
  await audit({
    actorType: 'admin',
    actorId: superAdmin.id,
    action: 'coin_adjustment.rejected',
    targetType: 'coin_adjustment_request',
    targetId: rejectedAdj.id,
    before: { status: 'pending_approval' },
    after: { status: 'rejected' },
    createdAt: daysAgo(4),
  });

  /* extra fraud flags of varying severity */
  await prisma.fraudFlag.create({
    data: {
      userId: users[23].id,
      relatedEntityType: 'user',
      relatedEntityId: users[23].id,
      flagType: 'MULTI_ACCOUNT_RING',
      severity: 'critical',
      description: 'Confirmed ring of 6 accounts sharing devices and payout destination.',
      metadata: { accounts: 6 },
      trustScoreDelta: -50,
      resolved: true,
      resolution: 'confirmed',
      resolvedBy: support.id,
      resolvedAt: daysAgo(3),
      resolutionNote: 'Banned after review',
      createdAt: daysAgo(4),
    },
  });
  await prisma.fraudFlag.create({
    data: {
      userId: users[21].id,
      relatedEntityType: 'user',
      relatedEntityId: users[21].id,
      flagType: 'DEVICE_SHARED_ACCOUNTS',
      severity: 'high',
      description: 'Device fingerprint used by several different accounts (multi-account farming).',
      metadata: { distinctUsersOnDevice: 3 },
      trustScoreDelta: -10,
      resolved: false,
      createdAt: daysAgo(1),
    },
  });
  await prisma.fraudFlag.create({
    data: {
      userId: users[9].id,
      relatedEntityType: 'withdrawal',
      flagType: 'LARGE_WITHDRAWAL_LOW_HISTORY',
      severity: 'medium',
      description: 'Large withdrawal requested by an account with fewer than 20 completions.',
      trustScoreDelta: 0,
      resolved: false,
      createdAt: daysAgo(1),
    },
  });
  await prisma.fraudFlag.create({
    data: {
      userId: users[14].id,
      relatedEntityType: 'ad_completion',
      flagType: 'EARLY_COMPLETION',
      severity: 'low',
      description: 'Completed after the minimum watch ratio but before the ad actually ended.',
      trustScoreDelta: 0,
      resolved: false,
      createdAt: daysAgo(0, 7),
    },
  });
  await audit({
    actorType: 'admin',
    actorId: support.id,
    action: 'user.ban',
    targetType: 'user',
    targetId: users[23].id,
    before: { status: 'active' },
    after: { status: 'banned', reason: 'Confirmed multi-account fraud ring' },
    createdAt: daysAgo(3),
  });
  await audit({
    actorType: 'admin',
    actorId: support.id,
    action: 'user.suspend',
    targetType: 'user',
    targetId: users[21].id,
    before: { status: 'active' },
    after: { status: 'suspended', reason: 'Shared device across accounts; pending review' },
    createdAt: daysAgo(1),
  });

  /* ad reports, push tokens, advertiser verification audit */
  await prisma.adReport.create({
    data: {
      userId: users[4].id,
      adId: adSave2.id,
      reason: 'misleading',
      details: 'Claims zero fees but the app charges a transfer fee.',
      createdAt: daysAgo(0, 11),
    },
  });
  await prisma.adReport.create({
    data: {
      userId: users[6].id,
      adId: adBuna2.id,
      reason: 'broken_media',
      details: 'Video stops at 4 seconds.',
      createdAt: daysAgo(1),
    },
  });
  for (const user of users.slice(0, 12))
    await prisma.devicePushToken.create({
      data: {
        userId: user.id,
        token: `fcm-demo-${sha(user.phone).slice(0, 24)}`,
        platform: 'android',
        deviceId: `dev-${user.phone.slice(-2)}`,
      },
    });
  await audit({
    actorType: 'admin',
    actorId: support.id,
    action: 'advertiser.verified',
    targetType: 'advertiser',
    targetId: habesha.id,
    before: { verificationStatus: 'pending' },
    after: { verificationStatus: 'verified' },
    createdAt: daysAgo(40),
  });
  await audit({
    actorType: 'admin',
    actorId: support.id,
    action: 'advertiser.verified',
    targetType: 'advertiser',
    targetId: fintech.id,
    before: { verificationStatus: 'pending' },
    after: { verificationStatus: 'verified' },
    createdAt: daysAgo(35),
  });

  /* reconciliation run record */
  const [userCount] = await prisma.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT COUNT(*)::bigint AS count FROM users`;
  await prisma.ledgerReconciliationRun.create({
    data: {
      startedAt: daysAgo(0, 6),
      finishedAt: daysAgo(0, 6),
      usersChecked: Number(userCount.count),
      driftCount: 0,
      status: 'ok',
    },
  });

  const totals = await Promise.all([
    prisma.user.count(),
    prisma.campaign.count(),
    prisma.ad.count(),
    prisma.adCompletion.count(),
    prisma.coinLedger.count(),
    prisma.withdrawal.count(),
    prisma.fraudFlag.count(),
    prisma.auditLog.count(),
  ]);
  console.log(
    `Seed complete: ${totals[0]} users, ${totals[1]} campaigns, ${totals[2]} ads, ${totals[3]} completions (${flaggedCount} flagged), ${totals[4]} ledger entries, ${totals[5]} withdrawals, ${totals[6]} fraud flags, ${totals[7]} audit rows`,
  );
  console.log(
    'Admins: super@rap.et reviewer@rap.et support@rap.et finance@rap.et finance2@rap.et / Admin123!',
  );
  console.log(
    'Advertisers: ads@habesha-coffee.et growth@addisfintech.et (verified), hello@shegerfashion.et (pending) / Advertiser123!',
  );
  console.log(
    `Demo user phones: ${users
      .slice(0, 3)
      .map((u) => u.phone)
      .join(', ')} ... (OTP: use devCode from /auth/otp/request or OTP_DEV_FIXED_CODE)`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
