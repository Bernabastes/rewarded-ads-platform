import {
  clampTrust,
  COMPLETION_RULES,
  type CompletionSignals,
  computeTrustScore,
  evaluateCompletion,
  type FraudThresholds,
} from './fraud.rules';

const thresholds: FraudThresholds = {
  flagThreshold: 40,
  rejectThreshold: 80,
  deviceSharedAccountsThreshold: 3,
  ipCompletionsPerHourThreshold: 30,
  minAccountAgeHoursForFullTrust: 24,
  minHeartbeatRatio: 0.6,
};

function signals(over: Partial<CompletionSignals> = {}): CompletionSignals {
  return {
    userId: 'u1',
    trustScore: 60,
    accountAgeHours: 200,
    adDurationSeconds: 30,
    watchDurationSeconds: 31,
    heartbeatCount: 2,
    expectedHeartbeats: 2,
    deviceFingerprint: 'fp',
    ipAddress: '1.2.3.4',
    todayCompletions: 2,
    dailyLimit: 15,
    distinctUsersOnDevice: 1,
    ipCompletionsLastHour: 1,
    userCompletionsLastHour: 1,
    recentBadCompletions: 0,
    ...over,
  };
}

describe('fraud rule engine', () => {
  it('a clean completion is valid with score 0', () => {
    const r = evaluateCompletion(signals(), thresholds);
    expect(r).toEqual({ score: 0, outcome: 'valid', hits: [], trustScoreDelta: 0 });
  });

  it('flags a device shared across accounts (high severity)', () => {
    const r = evaluateCompletion(signals({ distinctUsersOnDevice: 3 }), thresholds);
    expect(r.outcome).toBe('flagged');
    expect(r.hits.map((h) => h.ruleId)).toEqual(['DEVICE_SHARED_ACCOUNTS']);
    expect(r.score).toBe(45);
    expect(r.trustScoreDelta).toBe(-10);
  });

  it('rejects when several strong signals stack up', () => {
    const r = evaluateCompletion(
      signals({ distinctUsersOnDevice: 4, ipCompletionsLastHour: 50, trustScore: 20 }),
      thresholds,
    );
    expect(r.outcome).toBe('rejected');
    expect(r.score).toBe(Math.min(100, 45 + 25 + 25));
    expect(r.hits.map((h) => h.ruleId).sort()).toEqual([
      'DEVICE_SHARED_ACCOUNTS',
      'IP_VELOCITY',
      'LOW_TRUST_SCORE',
    ]);
  });

  it('low-weight rules alone stay valid but are reported', () => {
    const r = evaluateCompletion(signals({ watchDurationSeconds: 28 }), thresholds);
    expect(r.outcome).toBe('valid');
    expect(r.hits.map((h) => h.ruleId)).toEqual(['EARLY_COMPLETION']);
    expect(r.trustScoreDelta).toBe(0);
  });

  it('new accounts near the daily cap are flagged', () => {
    const r = evaluateCompletion(signals({ accountAgeHours: 2, todayCompletions: 10 }), thresholds);
    expect(r.hits.map((h) => h.ruleId)).toContain('NEW_ACCOUNT_HIGH_VOLUME');
  });

  it('sparse heartbeats and rapid sequential completions fire', () => {
    const r = evaluateCompletion(
      signals({ heartbeatCount: 6, expectedHeartbeats: 9, userCompletionsLastHour: 12 }),
      thresholds,
    );
    expect(r.hits.map((h) => h.ruleId).sort()).toEqual(['HEARTBEAT_SPARSE', 'RAPID_SEQUENTIAL_COMPLETIONS']);
    expect(r.outcome).toBe('valid'); // 15 + 20 = 35 < 40
  });

  it('repeat offenders get a high-severity hit', () => {
    const r = evaluateCompletion(signals({ recentBadCompletions: 3 }), thresholds);
    expect(r.hits[0].ruleId).toBe('REPEAT_OFFENDER');
    expect(r.hits[0].severity).toBe('high');
  });

  it('thresholds are configurable', () => {
    const strict = { ...thresholds, flagThreshold: 10, rejectThreshold: 20 };
    expect(evaluateCompletion(signals({ watchDurationSeconds: 28 }), strict).outcome).toBe('flagged');
    expect(evaluateCompletion(signals({ ipCompletionsLastHour: 30 }), strict).outcome).toBe('rejected');
  });

  it('every rule has a positive weight and a documented description', () => {
    for (const rule of COMPLETION_RULES) {
      expect(rule.scoreWeight).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(10);
      expect(rule.trustScoreDelta).toBeLessThanOrEqual(0);
    }
  });
});

describe('trust score math', () => {
  it('fresh account is 50', () => {
    expect(
      computeTrustScore({
        validCompletions: 0,
        completedWithdrawals: 0,
        openFlagsBySeverity: {},
        status: 'active',
      }),
    ).toBe(50);
  });

  it('grows with valid completions and completed withdrawals, capped', () => {
    expect(
      computeTrustScore({
        validCompletions: 20,
        completedWithdrawals: 1,
        openFlagsBySeverity: {},
        status: 'active',
      }),
    ).toBe(62);
    expect(
      computeTrustScore({
        validCompletions: 1000,
        completedWithdrawals: 100,
        openFlagsBySeverity: {},
        status: 'active',
      }),
    ).toBe(90);
  });

  it('open flags penalise by severity, capped at 60', () => {
    expect(
      computeTrustScore({
        validCompletions: 0,
        completedWithdrawals: 0,
        openFlagsBySeverity: { low: 1, medium: 1, high: 1 },
        status: 'active',
      }),
    ).toBe(28);
    expect(
      computeTrustScore({
        validCompletions: 0,
        completedWithdrawals: 0,
        openFlagsBySeverity: { critical: 5 },
        status: 'active',
      }),
    ).toBe(0);
    expect(
      computeTrustScore({
        validCompletions: 60,
        completedWithdrawals: 5,
        openFlagsBySeverity: { critical: 3 },
        status: 'active',
      }),
    ).toBe(30);
  });

  it('suspended accounts are capped at 20 and banned at 0', () => {
    expect(
      computeTrustScore({
        validCompletions: 100,
        completedWithdrawals: 10,
        openFlagsBySeverity: {},
        status: 'suspended',
      }),
    ).toBe(20);
    expect(
      computeTrustScore({
        validCompletions: 100,
        completedWithdrawals: 10,
        openFlagsBySeverity: {},
        status: 'banned',
      }),
    ).toBe(0);
  });

  it('clamps to 0..100', () => {
    expect(clampTrust(-5)).toBe(0);
    expect(clampTrust(105)).toBe(100);
    expect(clampTrust(42)).toBe(42);
  });
});
