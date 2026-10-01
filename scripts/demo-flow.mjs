#!/usr/bin/env node
/**
 * Cross-surface demo flow against a running stack (default http://localhost:3000). Drives the exact API calls the
 * three frontends make, in the order an investor demo would show them, and asserts every money-relevant outcome:
 *
 *   advertiser registers (accepting terms) -> admin verifies -> top-up (mock gateway) -> campaign + REAL creative
 *   upload (presigned PUT) -> media pipeline (ffprobe + 720p transcode + poster) -> submit -> admin approves
 *   campaign and ad -> new user (OTP, age gate, Ethiopian DOB echo, consent) watches with server heartbeats
 *   -> completion credited (idempotent, replay reports the balance) -> advertiser analytics (raw vs fraud-filtered)
 *   -> user verifies a NEW payout destination (partner name lookup + OTP re-check) -> withdrawal with an
 *   Idempotency-Key (held: first withdrawal) -> finance approves -> payout worker completes
 *   -> admin revenue dashboard reflects spend / rewards / payout / referral cost line.
 *
 *   node scripts/demo-flow.mjs                      # API on http://localhost:3000
 *   node scripts/demo-flow.mjs http://host:3000
 * Requires OTP_DEV_ECHO=true on the API (default in .env.example), the workers enabled (QUEUES_ENABLED=true) and
 * the seed applied (legal documents + demo admins).
 */
import { readFile } from 'node:fs/promises';

const base = (process.argv[2] ?? process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const api = `${base}/api/v1`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin123!';

let step = 0;
const log = (msg) => console.log(`     ${msg}`);
const title = (msg) => console.log(`\n[${String(++step).padStart(2, ' ')}] ${msg}`);
const fail = (msg) => {
  console.error(`     FAIL ${msg}`);
  process.exit(1);
};
const assert = (cond, msg) => (cond ? log(`OK  ${msg}`) : fail(msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, { body, token, headers = {}, allowError = false } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok && !allowError) fail(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return { status: res.status, body: json, headers: res.headers };
}

const adminLogin = async (email) =>
  (await call('POST', '/auth/admin/login', { body: { email, password: ADMIN_PASSWORD } })).body.tokens
    .accessToken;

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();

  title('Stack health');
  const ready = await (await fetch(`${base}/health/ready`)).json();
  assert(ready.status === 'ready', `API ready (db=${ready.checks.database} redis=${ready.checks.redis})`);

  /* ---------------- advertiser onboarding ---------------- */
  title('Advertiser registers on the portal (accepting the current advertiser terms)');
  const advLegal = await call('GET', '/legal/current?audience=advertiser&locale=en');
  const advTerms = advLegal.body.documents.find((d) => d.kind === 'terms');
  assert(advTerms, `advertiser terms v${advTerms?.version} published (${advTerms?.locale})`);
  const advEmail = `demo-${stamp.toLowerCase()}@sheger-demo.et`;
  const reg = await call('POST', '/auth/advertiser/register', {
    body: {
      businessName: `Demo Bakery ${stamp}`,
      businessRegistrationNumber: `MT/AA/9/${stamp}/2018`,
      contactEmail: advEmail,
      contactPhone: '+251911555000',
      password: 'Advertiser123!',
      termsVersion: advTerms.version,
    },
  });
  let advToken = reg.body.tokens.accessToken;
  const advertiserId = reg.body.advertiser.id;
  assert(
    reg.body.advertiser.verificationStatus === 'pending',
    `registered ${advEmail} (pending verification)`,
  );
  assert(
    reg.body.advertiser.acceptedTermsVersion === advTerms.version &&
      reg.body.advertiser.requiresTermsAcceptance === false,
    'terms acceptance recorded at registration',
  );

  const draft = await call('POST', '/campaigns', {
    token: advToken,
    body: {
      title: `Fresh dabo every morning ${stamp}`,
      description: 'Demo campaign',
      budgetEtb: 300,
      costPerActionEtb: 2,
      targetActionType: 'video_view',
      frequencyCapPerUserPerDay: 2,
    },
  });
  const campaignId = draft.body.id;
  assert(
    draft.body.rewardPerActionEtb === 1 && draft.body.rewardCoins === 100,
    `draft campaign: cost 2.00 ETB -> reward 1.00 ETB = 100 coins`,
  );
  assert(draft.body.frequencyCapPerUserPerDay === 2, 'frequency cap stored (2 completions per user per day)');
  const blocked = await call('POST', `/campaigns/${campaignId}/submit`, {
    token: advToken,
    allowError: true,
  });
  assert(
    blocked.body.code === 'ADVERTISER_NOT_VERIFIED',
    'unverified advertiser cannot submit (ADVERTISER_NOT_VERIFIED)',
  );

  title('Admin (support) verifies the business');
  const supportToken = await adminLogin('support@rap.et');
  const verified = await call('POST', `/admin/advertisers/${advertiserId}/verify`, {
    token: supportToken,
    body: { note: 'Trade licence checked (demo)' },
  });
  assert(verified.body.verificationStatus === 'verified', 'advertiser verified');
  const me = await call('GET', '/advertisers/me', { token: advToken });
  assert(me.body.verificationStatus === 'verified', 'portal sees fresh status via GET /advertisers/me');

  title('Advertiser tops up the wallet (mock Chapa checkout)');
  const topup = await call('POST', '/billing/topups', {
    token: advToken,
    body: { amountEtb: 500, returnUrl: 'http://localhost:5173/billing/return' },
  });
  assert(
    topup.body.mock === true && topup.body.checkoutUrl,
    `checkout created ${topup.body.txRef} (mock=${topup.body.mock})`,
  );
  const page = await fetch(topup.body.checkoutUrl);
  const html = await page.text();
  assert(
    page.status === 200 && !/onclick=|<script>/.test(html) && /checkout\.js/.test(html),
    'hosted mock checkout page is CSP-compliant (external script, no inline handlers)',
  );
  const paid = await call('POST', `/billing/mock-checkout/${topup.body.txRef}/pay`, {
    body: { outcome: 'success' },
  });
  assert(
    paid.body.status === 'completed' && /paymentId=.*txRef=/.test(paid.body.returnUrl),
    `payment settled; returnUrl carries paymentId+txRef`,
  );
  const balance = await call('GET', '/billing/balance', { token: advToken });
  assert(balance.body.balanceEtb === 500, `wallet balance 500.00 ETB`);
  const invoices = await call('GET', '/billing/invoices', { token: advToken });
  assert(invoices.body.meta.total >= 1, `invoice issued (${invoices.body.data[0]?.invoiceNumber})`);

  title('Advertiser uploads a REAL creative (browser-style presigned PUT); media pipeline runs; campaign submitted');
  // F4: a genuine H.264 clip from the seed assets so the pipeline (probe + transcode + poster) and players work
  const media = await readFile(new URL('../apps/api/prisma/seed-assets/eid-promo.mp4', import.meta.url));
  const presign = await call('POST', '/campaigns/uploads/presign', {
    token: advToken,
    body: { fileName: 'dabo.mp4', contentType: 'video/mp4', sizeBytes: media.length },
  });
  const put = await fetch(presign.body.uploadUrl, {
    method: 'PUT',
    headers: presign.body.headers,
    body: media,
  });
  assert(
    put.status === 200,
    `PUT ${media.length} bytes to presigned URL on ${new URL(presign.body.uploadUrl).origin} -> ${put.status}`,
  );
  const ad = await call('POST', `/campaigns/${campaignId}/ads`, {
    token: advToken,
    body: {
      title: 'Fresh dabo - 15s',
      storageKey: presign.body.storageKey,
      mediaType: 'video',
      durationSeconds: 20, // deliberately wrong: the probe finds 15 s and corrects it
      attentionQuestions: [
        {
          prompt: 'What was baked?',
          promptAm: 'ምን ተጋገረ?',
          options: ['Dabo (bread)', 'Cake', 'Pizza'],
          correctIndex: 0,
        },
      ],
    },
  });
  assert(
    ad.body.reviewStatus === 'pending',
    `creative added (${ad.body.id}) -> review queue (media ${ad.body.mediaStatus})`,
  );
  // media.process: ffprobe -> 720p transcode -> poster. Approval is refused (MEDIA_NOT_READY) until it finishes.
  let processed = ad.body;
  for (let i = 0; i < 40 && processed.mediaStatus === 'processing'; i++) {
    await sleep(3000);
    const ads = await call('GET', `/campaigns/${campaignId}/ads`, { token: advToken });
    processed = ads.body.find((a) => a.id === ad.body.id);
  }
  assert(
    processed.mediaStatus === 'duration_corrected' && processed.durationSeconds === 15,
    `media pipeline finished: ${processed.mediaStatus} (declared ${processed.durationDeclaredSeconds}s, probed ${processed.durationProbedSeconds}s, ${processed.mediaProbe?.width}x${processed.mediaProbe?.height} ${processed.mediaProbe?.codec})`,
  );
  assert(
    /transcoded\.mp4$/.test(processed.mediaUrl) && /poster\.png$/.test(processed.thumbnailUrl ?? ''),
    `served from the 720p transcode with a generated poster`,
  );
  const transcoded = await fetch(processed.mediaUrl, { method: 'HEAD' });
  assert(transcoded.status === 200, `transcoded rendition is publicly reachable (${transcoded.headers.get('content-length')} bytes)`);
  const submitted = await call('POST', `/campaigns/${campaignId}/submit`, { token: advToken });
  assert(
    submitted.body.status === 'pending_review',
    'campaign submitted (budget 300 ETB reserved from the wallet)',
  );
  const afterReserve = await call('GET', '/billing/balance', { token: advToken });
  assert(
    afterReserve.body.balanceEtb === 200 && afterReserve.body.reservedEtb === 300,
    `wallet 200.00 available / 300.00 reserved`,
  );

  title('Admin (ad reviewer) approves the campaign and the creative with the banned-topics checklist');
  const reviewerToken = await adminLogin('reviewer@rap.et');
  const queue = await call('GET', '/admin/ads/review-queue?status=pending&limit=100', {
    token: reviewerToken,
  });
  const queued = queue.body.data.find((a) => a.id === ad.body.id);
  assert(queued && queued.mediaStatus === 'duration_corrected', 'creative visible in the review queue with its media status');
  const checks = Object.fromEntries(
    [
      'alcohol',
      'gambling',
      'restricted_medicine',
      'political',
      'tobacco',
      'adult',
      'weapons',
      'misleading_financial',
    ].map((k) => [k, true]),
  );
  const approvedAd = await call('POST', `/admin/ads/${ad.body.id}/approve`, {
    token: reviewerToken,
    body: { bannedTopicsChecklist: { checks }, note: 'Clean creative' },
  });
  assert(approvedAd.body.reviewStatus === 'approved', 'creative approved');
  const approvedCampaign = await call('POST', `/admin/campaigns/${campaignId}/approve`, {
    token: reviewerToken,
    body: { note: 'Approved for demo' },
  });
  assert(approvedCampaign.body.status === 'active', 'campaign active');

  /* ---------------- user side ---------------- */
  title('New user signs up on the mobile app (OTP, server-side age check, consent)');
  const phone = `+2519${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const otp = await call('POST', '/auth/otp/request', { body: { phoneNumber: phone } });
  if (!otp.body.devCode) fail('OTP_DEV_ECHO must be enabled for the demo flow');
  const verify = await call('POST', '/auth/otp/verify', {
    body: {
      phoneNumber: phone,
      code: otp.body.devCode,
      deviceId: 'demo-device',
      deviceFingerprint: `fp-demo-${stamp}`,
    },
  });
  const userToken = verify.body.tokens.accessToken;
  assert(verify.body.isNewUser, `user created (${phone})`);
  const profile = await call('POST', '/auth/users/complete-profile', {
    token: userToken,
    body: {
      fullName: 'Demo Watcher (ሰላም)',
      dateOfBirthEthiopian: { year: 1986, month: 7, day: 12 }, // Megabit 12, 1986 = 21 March 1994
      languagePreference: 'am',
    },
  });
  assert(
    profile.body.ageVerificationStatus === 'verified_adult' && profile.body.dateOfBirth === '1994-03-21',
    `profile complete via Ethiopian DOB (Megabit 12, 1986 -> ${profile.body.dateOfBirth}), verified adult`,
  );
  const gated = await call('GET', '/ads/feed', { token: userToken, allowError: true });
  assert(
    gated.status === 403 && gated.body.code === 'CONSENT_REQUIRED',
    `money endpoints blocked until consent (CONSENT_REQUIRED: ${gated.body.details?.requiresConsent})`,
  );
  for (const kind of profile.body.requiresConsent) {
    const current = profile.body.consents.find((c) => c.kind === kind);
    await call('POST', '/users/me/consents', {
      token: userToken,
      body: { kind, version: current.currentVersion },
    });
  }
  const consented = await call('GET', '/users/me', { token: userToken });
  assert(consented.body.requiresConsent.length === 0, 'terms + privacy accepted (current versions)');
  assert(consented.body.referralCode?.length === 6, `referral code issued (${consented.body.referralCode})`);

  title('User watches the new ad (server-timed session + heartbeats + attention question)');
  const feed = await call('GET', '/ads/feed?limit=50', { token: userToken });
  const feedAd = feed.body.data.find((a) => a.id === ad.body.id);
  assert(
    feedAd,
    `new ad is in the feed (${feed.body.data.length} ads, daily ${feed.body.meta.dailyCompleted}/${feed.body.meta.dailyLimit}, hiddenByFrequencyCap=${feed.body.meta.hiddenByFrequencyCap})`,
  );
  assert(feedAd.durationSeconds === 15, 'feed uses the probed (corrected) duration');
  const session = await call('POST', `/ads/${ad.body.id}/watch-sessions`, {
    token: userToken,
    body: { deviceFingerprint: `fp-demo-${stamp}`, deviceId: 'demo-device' },
  });
  log(
    `session ${session.body.sessionId}: minWatch ${session.body.minWatchSeconds}s, heartbeat every ${session.body.heartbeatIntervalSeconds}s, question: ${session.body.attentionQuestion?.prompt ?? 'none'}`,
  );
  let elapsed = 0;
  while (elapsed < session.body.minWatchSeconds + 1) {
    await sleep(session.body.heartbeatIntervalSeconds * 1000);
    elapsed += session.body.heartbeatIntervalSeconds;
    const hb = await call('POST', `/ads/watch-sessions/${session.body.sessionId}/heartbeat`, {
      token: userToken,
      body: { positionSeconds: elapsed },
    });
    log(`heartbeat #${hb.body.heartbeatCount} at ${hb.body.elapsedSeconds}s`);
  }
  // Pentest A3a: the options arrive in a per-session random order - answer with the position of the right text
  const answerIndex = session.body.attentionQuestion ? session.body.attentionQuestion.options.indexOf('Dabo (bread)') : undefined;
  assert(
    answerIndex === undefined || answerIndex >= 0,
    `attention options shuffled per session: ${JSON.stringify(session.body.attentionQuestion?.options)} -> correct at position ${answerIndex}`,
  );
  const done = await call('POST', `/ads/watch-sessions/${session.body.sessionId}/complete`, {
    token: userToken,
    body: { attentionAnswerIndex: answerIndex },
  });
  assert(
    done.body.status === 'valid' && done.body.coinReward === 100,
    `completion ${done.body.status}: +${done.body.coinReward} coins (watched ${done.body.watchDurationSeconds}s)`,
  );
  const replay = await call('POST', `/ads/watch-sessions/${session.body.sessionId}/complete`, {
    token: userToken,
    body: { attentionAnswerIndex: answerIndex },
  });
  assert(
    replay.body.replayed === true &&
      replay.body.completionId === done.body.completionId &&
      replay.body.newBalance === 100,
    `replaying the completion never double-credits and reports the current balance (${replay.body.newBalance})`,
  );
  const userBalance = await call('GET', '/users/me/balance', { token: userToken });
  assert(
    userBalance.body.coinBalance === 100 && userBalance.body.ledgerChecksum.consistent,
    `balance 100 coins (=1.00 ETB), ledger checksum consistent`,
  );
  const recent = await call('GET', '/users/me/recently-watched', { token: userToken });
  assert(recent.body.data[0]?.adId === ad.body.id, 'recently-watched lists the ad (report-an-ad flow)');

  title('Advertiser analytics show the completion (raw vs fraud-filtered)');
  const analytics = await call('GET', `/campaigns/${campaignId}/analytics`, { token: advToken });
  const t = analytics.body.totals;
  assert(
    t.rawViews >= 1 && t.validCompletions === 1 && t.spendEtb === 2,
    `rawViews=${t.rawViews} validCompletions=${t.validCompletions} spend=${t.spendEtb} ETB remaining=${t.remainingEtb} fraudFilteredRate=${t.fraudFilteredRate}`,
  );
  const detail = await call('GET', `/campaigns/${campaignId}`, { token: advToken });
  assert(
    detail.body.spentEtb === 2 && detail.body.validCompletions === 1,
    'campaign detail: spent 2.00 ETB, 1 valid completion',
  );

  title('User verifies a NEW payout destination (partner lookup + OTP) and requests a withdrawal with an Idempotency-Key');
  const financeToken = await adminLogin('finance@rap.et');
  const superToken = await adminLogin('super@rap.et');
  // fund the demo user through the two-step adjustment so 50 ETB can be withdrawn
  const adj = await call('POST', '/admin/coin-adjustments', {
    token: financeToken,
    body: {
      userId: verify.body.user.id,
      amount: 5000,
      reason: 'Demo flow: fund withdrawal',
      reference: `DEMO-${stamp}`,
    },
  });
  const selfApprove = await call('POST', `/admin/coin-adjustments/${adj.body.id}/approve`, {
    token: financeToken,
    body: {},
    allowError: true,
  });
  assert(
    selfApprove.body.code === 'ADJUSTMENT_SELF_APPROVAL_FORBIDDEN',
    'requesting admin cannot approve their own adjustment',
  );
  const executed = await call('POST', `/admin/coin-adjustments/${adj.body.id}/approve`, {
    token: superToken,
    body: { note: 'second admin' },
  });
  assert(executed.body.status === 'executed', 'adjustment executed by a different admin (+5000 coins)');

  const wdConfig = await call('GET', '/withdrawals/config', { token: userToken });
  assert(
    wdConfig.body.kycTier === 'phone_only' && wdConfig.body.kycRequiredAboveMonthlyEtb > 0,
    `withdrawal config: kycTier=${wdConfig.body.kycTier}, KYC at/above ${wdConfig.body.kycRequiredAboveMonthlyEtb} ETB / 30 days, ${wdConfig.body.knownDestinations.length} known destinations`,
  );
  const blockedWd = await call('POST', '/withdrawals', {
    token: userToken,
    body: { amountEtb: 50, payoutMethod: 'telebirr', payoutDestination: phone },
    allowError: true,
  });
  assert(
    blockedWd.body.code === 'DESTINATION_NOT_VERIFIED',
    'a NEW destination must be resolved first (DESTINATION_NOT_VERIFIED)',
  );
  const resolved = await call('POST', '/withdrawals/destinations/resolve', {
    token: userToken,
    body: { payoutMethod: 'telebirr', payoutDestination: phone },
  });
  // Security audit #11: a NEW destination is not looked up at the partner until the OTP re-check succeeded
  assert(
    resolved.body.accountName === null && resolved.body.lookupPerformed === false && resolved.body.otpRequired === true,
    `new destination: no partner lookup yet (holder name hidden), OTP re-check required; ${resolved.body.lookupsRemainingToday} lookups left today`,
  );
  const otpOnly = await call('POST', '/withdrawals', {
    token: userToken,
    body: { amountEtb: 50, payoutMethod: 'telebirr', payoutDestination: resolved.body.normalizedDestination },
    allowError: true,
  });
  assert(otpOnly.body.code === 'DESTINATION_NOT_VERIFIED', 'without the OTP step nothing is verified (DESTINATION_NOT_VERIFIED)');
  const destOtp = await call('POST', '/withdrawals/destinations/otp/request', { token: userToken });
  const destVerified = await call('POST', '/withdrawals/destinations/otp/verify', {
    token: userToken,
    body: {
      code: destOtp.body.devCode,
      payoutMethod: 'telebirr',
      payoutDestination: resolved.body.normalizedDestination,
    },
  });
  assert(
    destVerified.body.accountName && destVerified.body.provider,
    `OTP verified -> partner lookup: account holder "${destVerified.body.accountName}" via ${destVerified.body.provider} (mock=${destVerified.body.mock})`,
  );
  const idemKey = `demo-wd-${stamp}`;
  const wdBody = {
    amountEtb: 50,
    payoutMethod: 'telebirr',
    payoutDestination: resolved.body.normalizedDestination,
  };
  const wd = await call('POST', '/withdrawals', {
    token: userToken,
    headers: { 'Idempotency-Key': idemKey },
    body: wdBody,
  });
  assert(
    wd.body.status === 'flagged_for_review' && wd.body.reviewReasons.includes('first_withdrawal'),
    `withdrawal ${wd.body.id} held for review [${wd.body.reviewReasons}]`,
  );
  assert(
    wd.body.destinationAccountName === destVerified.body.accountName,
    'verified account holder name snapshotted on the withdrawal',
  );
  const wdReplay = await call('POST', '/withdrawals', {
    token: userToken,
    headers: { 'Idempotency-Key': idemKey },
    body: wdBody,
  });
  assert(
    wdReplay.body.id === wd.body.id && wdReplay.headers.get('idempotent-replayed') === 'true',
    'same Idempotency-Key replays the stored response (no second hold)',
  );
  const wdReused = await call('POST', '/withdrawals', {
    token: userToken,
    headers: { 'Idempotency-Key': idemKey },
    body: { ...wdBody, amountEtb: 60 },
    allowError: true,
  });
  assert(
    wdReused.status === 409 && wdReused.body.code === 'IDEMPOTENCY_KEY_REUSED',
    'same key + different payload -> 409 IDEMPOTENCY_KEY_REUSED',
  );
  const held = await call('GET', '/users/me/balance', { token: userToken });
  assert(held.body.coinBalance === 100, `5000 coins held exactly once (balance ${held.body.coinBalance})`);

  title('Finance approves; payout completes through the partner');
  const approvedWd = await call('POST', `/admin/withdrawals/${wd.body.id}/approve`, {
    token: financeToken,
    body: { note: 'KYC ok (demo)' },
  });
  assert(
    ['pending', 'processing', 'completed'].includes(approvedWd.body.status),
    `finance approved -> ${approvedWd.body.status}`,
  );
  let final = null;
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const w = await call('GET', `/withdrawals/${wd.body.id}`, { token: userToken });
    log(`payout status: ${w.body.status}${w.body.providerName ? ` via ${w.body.providerName}` : ''}`);
    if (['completed', 'failed'].includes(w.body.status)) {
      final = w.body;
      break;
    }
  }
  if (!final) fail('payout did not finish (is the worker running? QUEUES_ENABLED=true)');
  assert(
    final.status === 'completed' || final.status === 'failed',
    `payout ${final.status} (${final.providerPayoutId})`,
  );
  const afterPayout = await call('GET', '/users/me/balance', { token: userToken });
  assert(
    afterPayout.body.coinBalance === (final.status === 'completed' ? 100 : 5100) &&
      afterPayout.body.ledgerChecksum.consistent,
    `balance after payout ${afterPayout.body.coinBalance}, ledger consistent`,
  );
  const known = await call('GET', '/withdrawals/destinations', { token: userToken });
  assert(known.body.some((d) => d.known), 'destination is now known (no lookup/OTP needed next time)');
  // Phase 4C: a second request can reference the known destination by id (no number, no lookup, no OTP)
  const knownId = known.body.find((d) => d.known).id;
  const byId = await call('POST', '/withdrawals', {
    token: userToken,
    body: { amountEtb: 50, payoutMethod: 'telebirr', payoutDestinationId: knownId },
    allowError: true,
  });
  // The id lookup runs BEFORE the rate-limit / in-flight / balance gates, so any of those codes proves the
  // destination gates were satisfied without a number, lookup or OTP (the demo user hit the 3/day limit above).
  assert(
    ['WITHDRAWAL_RATE_LIMITED', 'INSUFFICIENT_BALANCE', 'WITHDRAWAL_PENDING_EXISTS'].includes(byId.body.code),
    `withdrawal by payoutDestinationId passes the destination gates and stops at a later money gate (${byId.body.code})`,
  );
  const foreignId = await call('POST', '/withdrawals', {
    token: userToken,
    body: { amountEtb: 50, payoutMethod: 'bank', payoutDestinationId: knownId },
    allowError: true,
  });
  assert(foreignId.body.code === 'INVALID_PAYOUT_DESTINATION', 'a known id used with another method is refused (INVALID_PAYOUT_DESTINATION)');

  title('Support impersonation is read-only and audited');
  const imp = await call('POST', `/admin/users/${verify.body.user.id}/impersonate`, {
    token: supportToken,
    body: { reason: `Demo ticket ${stamp}` },
  });
  const impBalance = await call('GET', '/users/me/balance', { token: imp.body.accessToken });
  assert(impBalance.body.coinBalance === afterPayout.body.coinBalance, 'impersonation token can READ the user\'s balance');
  const impWrite = await call('PATCH', '/users/me', {
    token: imp.body.accessToken,
    body: { languagePreference: 'en' },
    allowError: true,
  });
  assert(impWrite.status === 403 && impWrite.body.code === 'IMPERSONATION_READ_ONLY', 'mutations are refused (IMPERSONATION_READ_ONLY)');
  const impAudit = await call('GET', `/admin/audit-log?action=impersonation.read&targetId=${verify.body.user.id}`, {
    token: superToken,
  });
  assert(impAudit.body.meta.total >= 1, `${impAudit.body.meta.total} impersonation read(s) audited`);

  title('Admin revenue dashboard and alerts reflect the flow');
  const revenue = await call('GET', '/admin/revenue/overview', { token: financeToken });
  const r = revenue.body.totals;
  assert(
    r.advertiserSpendEtb >= 2 && r.platformRevenueEtb >= 1 && r.topupsEtb >= 500,
    `spend ${r.advertiserSpendEtb} ETB, rewards ${r.userRewardsEtb} ETB, platform revenue ${r.platformRevenueEtb} ETB, referral bonuses ${r.referralBonusesEtb} ETB, net ${r.netPlatformRevenueEtb} ETB, top-ups ${r.topupsEtb} ETB, payouts completed ${r.payoutsCompletedEtb} ETB`,
  );
  const byAdvertiser = revenue.body.byAdvertiser.find((a) => a.advertiserId === advertiserId);
  assert(
    byAdvertiser?.spendEtb === 2,
    `advertiser appears in the spend breakdown (${byAdvertiser?.businessName})`,
  );
  const wallet = await call('GET', `/admin/advertisers/${advertiserId}/wallet`, { token: financeToken });
  assert(
    wallet.body.ledger.meta.total >= 2 && wallet.body.payments.meta.total === 1,
    `admin wallet view: ${wallet.body.ledger.meta.total} ledger rows, ${wallet.body.payments.meta.total} payment`,
  );
  const audit = await call('GET', `/admin/audit-log?targetId=${wd.body.id}`, { token: superToken });
  assert(audit.body.meta.total >= 3, `${audit.body.meta.total} audit rows for the withdrawal`);
  const rules = await call('POST', '/admin/alerts/run-rules', { token: superToken });
  assert(Array.isArray(rules.body.rules) && rules.body.rules.length === 4, `alert rules evaluated: ${rules.body.rules.map((x) => `${x.rule}=${x.raised}`).join(' ')}`);
  const alerts = await call('GET', '/admin/alerts?limit=5', { token: superToken });
  assert(typeof alerts.body.meta.openCount === 'number', `alerts page: ${alerts.body.meta.total} alerts, ${alerts.body.meta.openCount} open, notifiers ${alerts.body.meta.notifiers.map((n) => n.name).join('+')}`);

  console.log('\nDEMO FLOW PASSED');
  console.log(`  advertiser: ${advEmail} / Advertiser123!   campaign: ${campaignId}`);
  console.log(`  user: ${phone} (OTP via devCode or 123456)   withdrawal: ${wd.body.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
