// Runs against the built CJS bundle so the test also validates the build output.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateAge,
  coinsToEtb,
  computePlatformRevenueEtb,
  computeRewardEtb,
  etbToCoins,
  normalizeEthiopianPhone,
  roundEtb,
  ErrorCode,
  API_ROUTES,
} from '../dist/index.js';

test('etb <-> coins round trips at the default rate', () => {
  assert.equal(etbToCoins(1), 100);
  assert.equal(etbToCoins(1.5), 150);
  assert.equal(etbToCoins(0.01), 1);
  assert.equal(coinsToEtb(150), 1.5);
  assert.equal(coinsToEtb(12345), 123.45);
  assert.equal(coinsToEtb(etbToCoins(987.65)), 987.65);
});

test('reward split with 50% take rate', () => {
  assert.equal(computeRewardEtb(2), 1);
  assert.equal(computePlatformRevenueEtb(2), 1);
  assert.equal(computeRewardEtb(3.33), 1.67);
  assert.equal(computePlatformRevenueEtb(3.33), 1.66);
  assert.equal(computeRewardEtb(10, 0.3), 7);
  assert.throws(() => computeRewardEtb(10, 1));
});

test('roundEtb avoids float artefacts', () => {
  assert.equal(roundEtb(1.005), 1.01);
  assert.equal(roundEtb(0.1 + 0.2), 0.3);
});

test('calculateAge uses UTC calendar semantics', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  assert.equal(calculateAge(new Date('2008-09-24T00:00:00Z'), now), 18);
  assert.equal(calculateAge(new Date('2008-09-25T00:00:00Z'), now), 17);
  assert.equal(calculateAge(new Date('1990-01-01T00:00:00Z'), now), 36);
});

test('normalizeEthiopianPhone', () => {
  assert.equal(normalizeEthiopianPhone('0911223344'), '+251911223344');
  assert.equal(normalizeEthiopianPhone('+251 911 223 344'), '+251911223344');
  assert.equal(normalizeEthiopianPhone('251711223344'), '+251711223344');
  assert.equal(normalizeEthiopianPhone('12345'), null);
});

test('error codes and routes are exported', () => {
  assert.equal(ErrorCode.AGE_RESTRICTED, 'AGE_RESTRICTED');
  assert.equal(API_ROUTES.ads.complete('abc'), '/ads/watch-sessions/abc/complete');
});
