import type { FraudSeverity } from '@prisma/client';

/** Signals gathered server-side for one ad completion attempt. All values come from server records. */
export interface CompletionSignals {
  userId: string;
  trustScore: number;
  accountAgeHours: number;
  adDurationSeconds: number;
  watchDurationSeconds: number;
  heartbeatCount: number;
  expectedHeartbeats: number;
  deviceFingerprint: string;
  ipAddress: string;
  /** Completions credited today (before this one). */
  todayCompletions: number;
  dailyLimit: number;
  /** Distinct users that used this device fingerprint in the look-back window (including this user). */
  distinctUsersOnDevice: number;
  /** Completions from this IP across all users in the last hour. */
  ipCompletionsLastHour: number;
  /** Completions by this user in the last hour. */
  userCompletionsLastHour: number;
  /** Previous flagged/rejected completions for this user in the last 7 days. */
  recentBadCompletions: number;
}

export interface FraudRuleHit {
  ruleId: string;
  severity: FraudSeverity;
  scoreWeight: number;
  trustScoreDelta: number;
  description: string;
  detail?: Record<string, unknown>;
}

export interface FraudRule {
  id: string;
  description: string;
  severity: FraudSeverity;
  scoreWeight: number;
  trustScoreDelta: number;
  test(s: CompletionSignals, t: FraudThresholds): { hit: boolean; detail?: Record<string, unknown> };
}

export interface FraudThresholds {
  flagThreshold: number;
  rejectThreshold: number;
  deviceSharedAccountsThreshold: number;
  ipCompletionsPerHourThreshold: number;
  minAccountAgeHoursForFullTrust: number;
  minHeartbeatRatio: number;
}

export const COMPLETION_RULES: FraudRule[] = [
  {
    id: 'DEVICE_SHARED_ACCOUNTS',
    description: 'Device fingerprint used by several different accounts (multi-account farming).',
    severity: 'high',
    scoreWeight: 45,
    trustScoreDelta: -10,
    test: (s, t) => ({
      hit: s.distinctUsersOnDevice >= t.deviceSharedAccountsThreshold,
      detail: { distinctUsersOnDevice: s.distinctUsersOnDevice, threshold: t.deviceSharedAccountsThreshold },
    }),
  },
  {
    id: 'IP_VELOCITY',
    description: 'Unusually many completions from the same IP address in the last hour (bot farm / proxy).',
    severity: 'medium',
    scoreWeight: 25,
    trustScoreDelta: -5,
    test: (s, t) => ({
      hit: s.ipCompletionsLastHour >= t.ipCompletionsPerHourThreshold,
      detail: { ipCompletionsLastHour: s.ipCompletionsLastHour, threshold: t.ipCompletionsPerHourThreshold },
    }),
  },
  {
    id: 'RAPID_SEQUENTIAL_COMPLETIONS',
    description: 'More than 12 completions by the same user within one hour (super-human pace).',
    severity: 'medium',
    scoreWeight: 20,
    trustScoreDelta: -3,
    test: (s) => ({
      hit: s.userCompletionsLastHour >= 12,
      detail: { userCompletionsLastHour: s.userCompletionsLastHour },
    }),
  },
  {
    id: 'LOW_TRUST_SCORE',
    description: 'Account trust score below 30.',
    severity: 'medium',
    scoreWeight: 25,
    trustScoreDelta: 0,
    test: (s) => ({ hit: s.trustScore < 30, detail: { trustScore: s.trustScore } }),
  },
  {
    id: 'NEW_ACCOUNT_HIGH_VOLUME',
    description: 'Account younger than the trust warm-up window already near the daily cap.',
    severity: 'medium',
    scoreWeight: 20,
    trustScoreDelta: -3,
    test: (s, t) => ({
      hit:
        s.accountAgeHours < t.minAccountAgeHoursForFullTrust &&
        s.todayCompletions >= Math.ceil(s.dailyLimit * 0.66),
      detail: { accountAgeHours: Math.round(s.accountAgeHours), todayCompletions: s.todayCompletions },
    }),
  },
  {
    id: 'HEARTBEAT_SPARSE',
    description: 'Heartbeats received but noticeably fewer than expected for the watch duration.',
    severity: 'low',
    scoreWeight: 15,
    trustScoreDelta: -1,
    test: (s, t) => {
      if (s.expectedHeartbeats === 0) return { hit: false };
      const ratio = s.heartbeatCount / s.expectedHeartbeats;
      return {
        hit: ratio >= t.minHeartbeatRatio && ratio < 0.85,
        detail: { heartbeatCount: s.heartbeatCount, expectedHeartbeats: s.expectedHeartbeats },
      };
    },
  },
  {
    id: 'EARLY_COMPLETION',
    description: 'Completed after the minimum watch ratio but before the ad actually ended.',
    severity: 'low',
    scoreWeight: 10,
    trustScoreDelta: 0,
    test: (s) => ({
      hit: s.watchDurationSeconds < s.adDurationSeconds,
      detail: { watchDurationSeconds: s.watchDurationSeconds, adDurationSeconds: s.adDurationSeconds },
    }),
  },
  {
    id: 'REPEAT_OFFENDER',
    description: 'Three or more flagged/rejected completions in the last 7 days.',
    severity: 'high',
    scoreWeight: 30,
    trustScoreDelta: -5,
    test: (s) => ({
      hit: s.recentBadCompletions >= 3,
      detail: { recentBadCompletions: s.recentBadCompletions },
    }),
  },
];

export interface FraudEvaluation {
  score: number;
  outcome: 'valid' | 'flagged' | 'rejected';
  hits: FraudRuleHit[];
  trustScoreDelta: number;
}

/** Pure rule evaluation: deterministic, unit-testable, no I/O. */
export function evaluateCompletion(
  signals: CompletionSignals,
  thresholds: FraudThresholds,
  rules: FraudRule[] = COMPLETION_RULES,
): FraudEvaluation {
  const hits: FraudRuleHit[] = [];
  for (const rule of rules) {
    const r = rule.test(signals, thresholds);
    if (r.hit) {
      hits.push({
        ruleId: rule.id,
        severity: rule.severity,
        scoreWeight: rule.scoreWeight,
        trustScoreDelta: rule.trustScoreDelta,
        description: rule.description,
        detail: r.detail,
      });
    }
  }
  const score = Math.min(
    100,
    hits.reduce((sum, h) => sum + h.scoreWeight, 0),
  );
  const outcome =
    score >= thresholds.rejectThreshold
      ? 'rejected'
      : score >= thresholds.flagThreshold
        ? 'flagged'
        : 'valid';
  const trustScoreDelta = outcome === 'valid' ? 0 : hits.reduce((sum, h) => sum + h.trustScoreDelta, 0);
  return { score, outcome, hits, trustScoreDelta };
}

/** Penalty per open (not dismissed) fraud flag when recomputing a trust score. */
export const SEVERITY_TRUST_PENALTY: Record<FraudSeverity, number> = {
  low: 2,
  medium: 5,
  high: 15,
  critical: 30,
};

export interface TrustScoreInputs {
  validCompletions: number;
  completedWithdrawals: number;
  openFlagsBySeverity: Partial<Record<FraudSeverity, number>>;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
}

/**
 * Deterministic trust score (0..100, default 50 for a fresh account):
 *   50 + min(30, valid completions * 0.5) + min(10, completed withdrawals * 2) - min(60, sum(open flag penalties))
 *   suspended accounts are capped at 20, banned at 0.
 */
export function computeTrustScore(input: TrustScoreInputs): number {
  const positive = Math.min(30, input.validCompletions * 0.5) + Math.min(10, input.completedWithdrawals * 2);
  const penalties = (Object.entries(input.openFlagsBySeverity) as Array<[FraudSeverity, number]>).reduce(
    (sum, [severity, count]) => sum + SEVERITY_TRUST_PENALTY[severity] * (count ?? 0),
    0,
  );
  let score = 50 + positive - Math.min(60, penalties);
  if (input.status === 'suspended') score = Math.min(score, 20);
  if (input.status === 'banned' || input.status === 'deleted') score = 0;
  return clampTrust(Math.round(score));
}

export function clampTrust(value: number): number {
  return Math.max(0, Math.min(100, value));
}
