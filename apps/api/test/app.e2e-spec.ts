/**
 * End-to-end smoke test against a REAL database + redis (skips itself when they are unreachable).
 * Requires the seed (`pnpm --filter @rap/api seed`) so that approved ads exist.
 *
 *   pnpm --filter @rap/api test:e2e
 */
import { type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import { loadDotenv } from '../src/config/dotenv';

loadDotenv();
process.env.NODE_ENV = 'test';
process.env.QUEUES_ENABLED = 'false';
process.env.RECONCILIATION_ENABLED = 'false';
process.env.OTP_DEV_ECHO = 'true';
process.env.MIN_WATCH_RATIO = '0.05';
process.env.HEARTBEAT_INTERVAL_SECONDS = '1';
process.env.OTP_RATE_LIMIT_PER_IP_PER_HOUR = '1000';
process.env.LOG_LEVEL = 'silent';

async function infraReachable(): Promise<boolean> {
  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    redis.disconnect();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('API e2e smoke (user money flow)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let reachable = false;

  beforeAll(async () => {
    reachable = await infraReachable();
    if (!reachable) {
      console.warn(
        'e2e: database/redis not reachable - skipping (start `docker compose up -d` and run the seed)',
      );
      return;
    }
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: false }));
    await app.init();
    http = request(app.getHttpServer());
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const skipIfUnreachable = () => {
    if (!reachable) {
      console.warn('skipped: infra unreachable');
      return true;
    }
    return false;
  };

  it('OTP -> profile -> feed -> watch -> complete -> balance -> adjustment -> withdrawal', async () => {
    if (skipIfUnreachable()) return;
    const phone = `+2519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

    // OTP
    const otp = await http.post('/api/v1/auth/otp/request').send({ phoneNumber: phone }).expect(201);
    expect(otp.body.devCode).toHaveLength(6);
    const verify = await http
      .post('/api/v1/auth/otp/verify')
      .send({ phoneNumber: phone, code: otp.body.devCode, deviceFingerprint: 'fp-e2e' })
      .expect(201);
    const token = verify.body.tokens.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };
    expect(verify.body.isNewUser).toBe(true);

    // feed is blocked until the profile is complete
    await http
      .get('/api/v1/ads/feed')
      .set(auth)
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('PROFILE_INCOMPLETE'));

    // age gate
    await http
      .post('/api/v1/auth/users/complete-profile')
      .set(auth)
      .send({ fullName: 'Too Young', dateOfBirth: '2015-01-01' })
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('AGE_RESTRICTED'));
    // the minor's tokens are revoked; make a fresh adult
    const phone2 = `+2517${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const otp2 = await http.post('/api/v1/auth/otp/request').send({ phoneNumber: phone2 }).expect(201);
    const verify2 = await http
      .post('/api/v1/auth/otp/verify')
      .send({ phoneNumber: phone2, code: otp2.body.devCode })
      .expect(201);
    const adult = { Authorization: `Bearer ${verify2.body.tokens.accessToken}` };
    const profile = await http
      .post('/api/v1/auth/users/complete-profile')
      .set(adult)
      .send({ fullName: 'E2E Adult', dateOfBirthEthiopian: { year: 1982, month: 10, day: 8 } }) // Sene 8, 1982 = 15 Jun 1990
      .expect(201);
    expect(profile.body.ageVerificationStatus).toBe('verified_adult');
    expect(profile.body.dateOfBirth).toBe('1990-06-15');
    expect(profile.body.referralCode).toHaveLength(6);

    // consent gate (Phase 4A): money endpoints are blocked until the current terms + privacy are accepted
    if (profile.body.requiresConsent.length > 0) {
      await http
        .get('/api/v1/ads/feed')
        .set(adult)
        .expect(403)
        .expect((r) => expect(r.body.code).toBe('CONSENT_REQUIRED'));
      for (const kind of profile.body.requiresConsent as string[]) {
        const state = profile.body.consents.find((c: { kind: string }) => c.kind === kind);
        await http
          .post('/api/v1/users/me/consents')
          .set(adult)
          .send({ kind, version: state.currentVersion })
          .expect(200);
      }
    }

    // feed
    const feed = await http.get('/api/v1/ads/feed').set(adult).expect(200);
    expect(feed.body.meta.dailyLimit).toBeGreaterThan(0);
    expect(typeof feed.body.meta.hiddenByFrequencyCap).toBe('number');
    if (feed.body.data.length === 0) throw new Error('No approved ads in the database - run the seed first');
    const ad = [...feed.body.data].sort((a, b) => a.durationSeconds - b.durationSeconds)[0];

    // watch session
    const session = await http
      .post(`/api/v1/ads/${ad.id}/watch-sessions`)
      .set(adult)
      .send({ deviceFingerprint: 'fp-e2e-adult' })
      .expect(201);
    expect(session.body.minWatchSeconds).toBeGreaterThanOrEqual(1);

    let attentionAnswerIndex: number | undefined;
    if (session.body.attentionQuestion) {
      const admin = await http
        .post('/api/v1/auth/admin/login')
        .send({ email: 'reviewer@rap.et', password: 'Admin123!' })
        .expect(201);
      const adminAd = await http
        .get(`/api/v1/admin/ads/${ad.id}`)
        .set({ Authorization: `Bearer ${admin.body.tokens.accessToken}` })
        .expect(200);
      attentionAnswerIndex = adminAd.body.attentionQuestions.find(
        (q: { id: string }) => q.id === session.body.attentionQuestion.id,
      ).correctIndex;
    }

    await sleep((session.body.minWatchSeconds + 0.3) * 1000);
    await http
      .post(`/api/v1/ads/watch-sessions/${session.body.sessionId}/heartbeat`)
      .set(adult)
      .send({})
      .expect(201);
    const done = await http
      .post(`/api/v1/ads/watch-sessions/${session.body.sessionId}/complete`)
      .set(adult)
      .send({ attentionAnswerIndex })
      .expect(201);
    expect(['valid', 'flagged']).toContain(done.body.status);
    const replay = await http
      .post(`/api/v1/ads/watch-sessions/${session.body.sessionId}/complete`)
      .set(adult)
      .send({ attentionAnswerIndex })
      .expect(201);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.completionId).toBe(done.body.completionId);
    // F3: a replay reports the current balance instead of null
    expect(typeof replay.body.newBalance).toBe('number');

    // balance from ledger
    const balance = await http.get('/api/v1/users/me/balance').set(adult).expect(200);
    const expected = done.body.status === 'valid' ? ad.rewardCoins : 0;
    expect(balance.body.coinBalance).toBe(expected);
    expect(balance.body.ledgerChecksum.consistent).toBe(true);

    // two-step adjustment to fund a withdrawal
    const finance = await http
      .post('/api/v1/auth/admin/login')
      .send({ email: 'finance@rap.et', password: 'Admin123!' })
      .expect(201);
    const superAdmin = await http
      .post('/api/v1/auth/admin/login')
      .send({ email: 'super@rap.et', password: 'Admin123!' })
      .expect(201);
    const fin = { Authorization: `Bearer ${finance.body.tokens.accessToken}` };
    const sup = { Authorization: `Bearer ${superAdmin.body.tokens.accessToken}` };
    const adj = await http
      .post('/api/v1/admin/coin-adjustments')
      .set(fin)
      .send({ userId: verify2.body.user.id, amount: 6000, reason: 'e2e funding' })
      .expect(201);
    await http
      .post(`/api/v1/admin/coin-adjustments/${adj.body.id}/approve`)
      .set(fin)
      .send({})
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('ADJUSTMENT_SELF_APPROVAL_FORBIDDEN'));
    const executed = await http
      .post(`/api/v1/admin/coin-adjustments/${adj.body.id}/approve`)
      .set(sup)
      .send({ note: 'ok' })
      .expect(201);
    expect(executed.body.status).toBe('executed');

    // withdrawal (first-ever -> review), then finance approval -> pending (queues disabled in tests)
    await http
      .post('/api/v1/withdrawals')
      .set(adult)
      .send({ amountEtb: 10, payoutMethod: 'telebirr', payoutDestination: phone2 })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('BELOW_MIN_WITHDRAWAL'));
    // Phase 4A: a NEW destination needs a partner lookup + OTP re-check first
    await http
      .post('/api/v1/withdrawals')
      .set(adult)
      .send({ amountEtb: 50, payoutMethod: 'telebirr', payoutDestination: phone2 })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('DESTINATION_NOT_VERIFIED'));
    const resolved = await http
      .post('/api/v1/withdrawals/destinations/resolve')
      .set(adult)
      .send({ payoutMethod: 'telebirr', payoutDestination: phone2 })
      .expect(200);
    expect(resolved.body.accountName).toBeTruthy();
    expect(resolved.body.otpRequired).toBe(true);
    const destOtp = await http.post('/api/v1/withdrawals/destinations/otp/request').set(adult).expect(200);
    await http
      .post('/api/v1/withdrawals/destinations/otp/verify')
      .set(adult)
      .send({
        code: destOtp.body.devCode,
        payoutMethod: 'telebirr',
        payoutDestination: resolved.body.normalizedDestination,
      })
      .expect(200);
    const wdBody = {
      amountEtb: 50,
      payoutMethod: 'telebirr',
      payoutDestination: resolved.body.normalizedDestination,
    };
    const idemKey = `e2e-${Date.now()}`;
    const wd = await http
      .post('/api/v1/withdrawals')
      .set({ ...adult, 'Idempotency-Key': idemKey })
      .send(wdBody)
      .expect(201);
    expect(wd.body.status).toBe('flagged_for_review');
    expect(wd.body.reviewReasons).toContain('first_withdrawal');
    expect(wd.body.destinationAccountName).toBe(resolved.body.accountName);
    // Idempotency-Key: same payload replays, different payload is refused
    const wdReplay = await http
      .post('/api/v1/withdrawals')
      .set({ ...adult, 'Idempotency-Key': idemKey })
      .send(wdBody)
      .expect(201);
    expect(wdReplay.body.id).toBe(wd.body.id);
    expect(wdReplay.headers['idempotent-replayed']).toBe('true');
    await http
      .post('/api/v1/withdrawals')
      .set({ ...adult, 'Idempotency-Key': idemKey })
      .send({ ...wdBody, amountEtb: 60 })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('IDEMPOTENCY_KEY_REUSED'));
    const afterHold = await http.get('/api/v1/users/me/balance').set(adult).expect(200);
    expect(afterHold.body.coinBalance).toBe(expected + 6000 - 5000);
    const approved = await http
      .post(`/api/v1/admin/withdrawals/${wd.body.id}/approve`)
      .set(fin)
      .send({ note: 'e2e' })
      .expect(201);
    expect(approved.body.status).toBe('pending');

    // Phase 4C: the destination is now KNOWN and can be referenced by id (no number, no lookup, no OTP);
    // with a withdrawal already in flight the request stops at the in-flight rule, proving the id resolved.
    const knownList = await http.get('/api/v1/withdrawals/destinations').set(adult).expect(200);
    const knownId = knownList.body.find((d: { known: boolean }) => d.known)?.id as string;
    expect(knownId).toBeTruthy();
    await http
      .post('/api/v1/withdrawals')
      .set(adult)
      .send({ amountEtb: 50, payoutMethod: 'telebirr', payoutDestinationId: knownId })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('WITHDRAWAL_PENDING_EXISTS'));
    await http
      .post('/api/v1/withdrawals')
      .set(adult)
      .send({ amountEtb: 50, payoutMethod: 'bank', payoutDestinationId: knownId })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe('INVALID_PAYOUT_DESTINATION'));

    // RBAC: reviewer cannot touch withdrawals
    const reviewer = await http
      .post('/api/v1/auth/admin/login')
      .send({ email: 'reviewer@rap.et', password: 'Admin123!' })
      .expect(201);
    await http
      .get('/api/v1/admin/withdrawals')
      .set({ Authorization: `Bearer ${reviewer.body.tokens.accessToken}` })
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('ROLE_NOT_ALLOWED'));

    // audit trail exists
    const audit = await http.get(`/api/v1/admin/audit-log?targetId=${wd.body.id}`).set(sup).expect(200);
    expect(audit.body.meta.total).toBeGreaterThanOrEqual(2);
  }, 60_000);

  /**
   * Security audit #1 (CRITICAL) - the exact exploit sequence: submit (wallet debited) -> admin rejects (refund)
   * -> advertiser edits the rejected campaign (status -> draft) with a budget x2000 -> resubmits. Before the fix the
   * second reservation replayed the first idempotency key: no debit, no balance check, `budget_reserved_etb` set to
   * the unfunded budget. Now every submission is keyed by `submission_seq` and the wallet balance is asserted under
   * the row lock, so the resubmission must either debit the FULL new budget or fail with INSUFFICIENT_WALLET_BALANCE.
   */
  it('REGRESSION #1: reject -> edit budget x2000 -> resubmit cannot replay the budget reservation', async () => {
    if (skipIfUnreachable()) return;
    const login = await http
      .post('/api/v1/auth/advertiser/login')
      .send({ email: 'growth@addisfintech.et', password: 'Advertiser123!' })
      .expect(201);
    const adv = { Authorization: `Bearer ${login.body.tokens.accessToken}` };
    const advertiserId = login.body.advertiser.id as string;

    // make sure the wallet can afford exactly one small budget (top-up through the mock checkout)
    const topup = await http
      .post('/api/v1/billing/topups')
      .set(adv)
      .send({ amountEtb: 300, returnUrl: 'http://localhost:5173/billing/return' })
      .expect(201);
    await http.post(`/api/v1/billing/mock-checkout/${topup.body.txRef}/pay`).send({ outcome: 'success' }).expect(201);
    const balance0 = Number((await http.get('/api/v1/billing/balance').set(adv).expect(200)).body.balanceEtb);
    expect(balance0).toBeGreaterThanOrEqual(300);

    const budget = 100;
    const campaign = await http
      .post('/api/v1/campaigns')
      .set(adv)
      .send({ title: `Replay regression ${Date.now()}`, budgetEtb: budget, costPerActionEtb: 2, targetActionType: 'video_view', attentionCheckEnabled: false })
      .expect(201);
    const campaignId = campaign.body.id as string;
    // test env: the media pipeline is disabled, so the creative is `ready` immediately (storageKey must be the
    // advertiser's own creatives prefix - security audit #2)
    await http
      .post(`/api/v1/campaigns/${campaignId}/ads`)
      .set(adv)
      .send({ title: 'Replay creative', storageKey: `creatives/${advertiserId}/2026-10-01/replay.mp4`, mediaType: 'video', durationSeconds: 15 })
      .expect(201);

    const submitted = await http.post(`/api/v1/campaigns/${campaignId}/submit`).set(adv).expect(201);
    expect(submitted.body.status).toBe('pending_review');
    expect(submitted.body.submissionSeq).toBe(1);
    const balance1 = Number((await http.get('/api/v1/billing/balance').set(adv).expect(200)).body.balanceEtb);
    expect(balance1).toBeCloseTo(balance0 - budget, 2);

    // admin rejects -> refund
    const reviewer = await http.post('/api/v1/auth/admin/login').send({ email: 'reviewer@rap.et', password: 'Admin123!' }).expect(201);
    const rev = { Authorization: `Bearer ${reviewer.body.tokens.accessToken}` };
    await http.post(`/api/v1/admin/campaigns/${campaignId}/reject`).set(rev).send({ reason: 'Regression test rejection' }).expect(201);
    const balance2 = Number((await http.get('/api/v1/billing/balance').set(adv).expect(200)).body.balanceEtb);
    expect(balance2).toBeCloseTo(balance0, 2);

    // advertiser edits the rejected campaign: budget x2000 -> status back to draft
    const edited = await http.patch(`/api/v1/campaigns/${campaignId}`).set(adv).send({ budgetEtb: budget * 2000 }).expect(200);
    expect(edited.body.status).toBe('draft');
    expect(Number(edited.body.budgetEtb)).toBe(budget * 2000);

    // THE EXPLOIT: resubmit. Must NOT replay the refunded reservation.
    const replay = await http.post(`/api/v1/campaigns/${campaignId}/submit`).set(adv);
    expect(replay.status).toBe(422);
    expect(replay.body.code).toBe('INSUFFICIENT_WALLET_BALANCE');
    const after = await http.get(`/api/v1/campaigns/${campaignId}`).set(adv).expect(200);
    expect(after.body.status).toBe('draft'); // the transaction rolled back the status claim
    expect(Number(after.body.budgetReservedEtb)).toBe(0);
    const balance3 = Number((await http.get('/api/v1/billing/balance').set(adv).expect(200)).body.balanceEtb);
    expect(balance3).toBeCloseTo(balance0, 2);

    // a budget the wallet can afford is debited again in full under a NEW key (seq 2)
    await http.patch(`/api/v1/campaigns/${campaignId}`).set(adv).send({ budgetEtb: budget }).expect(200);
    const resubmitted = await http.post(`/api/v1/campaigns/${campaignId}/submit`).set(adv).expect(201);
    expect(resubmitted.body.submissionSeq).toBe(2);
    expect(Number(resubmitted.body.budgetReservedEtb)).toBe(budget);
    const balance4 = Number((await http.get('/api/v1/billing/balance').set(adv).expect(200)).body.balanceEtb);
    expect(balance4).toBeCloseTo(balance0 - budget, 2);
    // clean up: reject again so the regression campaign does not stay in the review queue (refund keyed by seq 2)
    await http.post(`/api/v1/admin/campaigns/${campaignId}/reject`).set(rev).send({ reason: 'Regression test cleanup' }).expect(201);
    const balance5 = Number((await http.get('/api/v1/billing/balance').set(adv).expect(200)).body.balanceEtb);
    expect(balance5).toBeCloseTo(balance0, 2);
  }, 60_000);

  it('refresh token rotation detects reuse', async () => {
    if (skipIfUnreachable()) return;
    const login = await http
      .post('/api/v1/auth/admin/login')
      .send({ email: 'support@rap.et', password: 'Admin123!' })
      .expect(201);
    const first = login.body.tokens.refreshToken;
    const rotated = await http.post('/api/v1/auth/refresh').send({ refreshToken: first }).expect(201);
    expect(rotated.body.refreshToken).not.toBe(first);
    await http
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('REFRESH_TOKEN_REUSED'));
    // the whole family is revoked, including the freshly rotated token
    await http.post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
  }, 30_000);

  it('serves the OpenAPI document', async () => {
    if (skipIfUnreachable()) return;
    const res = await http.get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});
