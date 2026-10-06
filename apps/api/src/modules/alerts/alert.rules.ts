import type { AlertSeverity } from '@prisma/client';

/** Output of a rule evaluation: zero or more alerts to raise. Pure functions so they are unit-testable. */
export interface RuleAlert {
  type: string;
  severity: AlertSeverity;
  title: string;
  payload: Record<string, unknown>;
  /** Alerts with the same dedupe key are not re-raised within ALERT_DEDUPE_MINUTES. */
  dedupeKey: string;
}

export const ALERT_TYPES = {
  ledgerDrift: 'LEDGER_DRIFT',
  payoutFailureRate: 'PAYOUT_FAILURE_RATE',
  accountMinting: 'ACCOUNT_MINTING',
  spendVelocity: 'SPEND_VELOCITY',
  otpSpike: 'OTP_SPIKE',
  /** Security audit #11: too many payout-destination partner lookups from one IP (enumeration attempt). */
  destinationLookupSpike: 'DESTINATION_LOOKUP_SPIKE',
  /** Phase 5b New-2: a payout stayed `processing` without a partner for too long (worker crash) and was parked. */
  payoutStuckProcessing: 'PAYOUT_STUCK_PROCESSING',
  /** Phase 5c New-10: an admin account hit the account-wide TOTP failure cap (password likely compromised). */
  adminMfaBruteForce: 'ADMIN_MFA_BRUTE_FORCE',
} as const;

/* ------------------------------ payout failure rate ------------------------------ */

export function evaluatePayoutFailureRate(
  input: { completed: number; failed: number },
  cfg: { threshold: number; minSample: number },
): RuleAlert | null {
  const total = input.completed + input.failed;
  if (total < cfg.minSample) return null;
  const rate = input.failed / total;
  if (rate <= cfg.threshold) return null;
  return {
    type: ALERT_TYPES.payoutFailureRate,
    severity: rate >= Math.min(1, cfg.threshold * 2) ? 'critical' : 'warning',
    title: `Payout failure rate ${(rate * 100).toFixed(0)}% over the last hour (${input.failed}/${total})`,
    payload: { failed: input.failed, completed: input.completed, rate: Number(rate.toFixed(3)), threshold: cfg.threshold },
    dedupeKey: 'payout_failure_rate',
  };
}

/* ------------------------------ account minting ------------------------------ */

export function evaluateAccountMinting(
  rows: Array<{ fingerprint: string; accounts: number }>,
  cfg: { accountsPerDevicePerHour: number },
): RuleAlert[] {
  return rows
    .filter((r) => r.accounts > cfg.accountsPerDevicePerHour)
    .map((r) => ({
      type: ALERT_TYPES.accountMinting,
      severity: r.accounts >= cfg.accountsPerDevicePerHour * 3 ? 'critical' : 'warning',
      title: `${r.accounts} accounts created from one device in the last hour`,
      payload: { deviceFingerprint: r.fingerprint, accounts: r.accounts, threshold: cfg.accountsPerDevicePerHour },
      dedupeKey: `account_minting:${r.fingerprint}`,
    }));
}

/* ------------------------------ spend velocity ------------------------------ */

export interface CampaignSpendWindow {
  campaignId: string;
  title: string;
  advertiserName: string;
  lastHourEtb: number;
  /** Spend over the trailing 7 days EXCLUDING the last hour. */
  trailing7dEtb: number;
}

/**
 * Last-hour spend vs. the trailing 7-day hourly average. New campaigns (average 0) alert once they burn more than
 * the minimum in an hour: `lastHour > max(multiplier * avg, minEtb)`.
 */
export function evaluateSpendVelocity(
  rows: CampaignSpendWindow[],
  cfg: { multiplier: number; minEtb: number },
): RuleAlert[] {
  const alerts: RuleAlert[] = [];
  for (const r of rows) {
    if (r.lastHourEtb < cfg.minEtb) continue;
    const hourlyAvg = r.trailing7dEtb / 167;
    const limit = Math.max(cfg.multiplier * hourlyAvg, cfg.minEtb);
    if (r.lastHourEtb <= limit) continue;
    alerts.push({
      type: ALERT_TYPES.spendVelocity,
      severity: hourlyAvg > 0 && r.lastHourEtb > cfg.multiplier * 2 * hourlyAvg ? 'critical' : 'warning',
      title: `Campaign "${r.title}" spent ${r.lastHourEtb.toFixed(2)} ETB in the last hour (avg ${hourlyAvg.toFixed(2)} ETB/h)`,
      payload: {
        campaignId: r.campaignId,
        advertiserName: r.advertiserName,
        lastHourEtb: Number(r.lastHourEtb.toFixed(2)),
        trailingHourlyAvgEtb: Number(hourlyAvg.toFixed(2)),
        multiplier: cfg.multiplier,
      },
      dedupeKey: `spend_velocity:${r.campaignId}`,
    });
  }
  return alerts;
}

/* ------------------------------ OTP spike ------------------------------ */

export function evaluateOtpSpike(
  rows: Array<{ ip: string; requests: number }>,
  cfg: { requestsPerIpPerHour: number },
): RuleAlert[] {
  return rows
    .filter((r) => r.requests > cfg.requestsPerIpPerHour)
    .map((r) => ({
      type: ALERT_TYPES.otpSpike,
      severity: r.requests >= cfg.requestsPerIpPerHour * 3 ? 'critical' : 'warning',
      title: `${r.requests} OTP requests from ${r.ip} in the last hour`,
      payload: { ip: r.ip, requests: r.requests, threshold: cfg.requestsPerIpPerHour },
      dedupeKey: `otp_spike:${r.ip}`,
    }));
}

/* ------------------------------ ledger drift ------------------------------ */

export function ledgerDriftAlert(drift: {
  userId: string;
  cachedBalance: number;
  ledgerSum: number;
  runId: string;
}): RuleAlert {
  return {
    type: ALERT_TYPES.ledgerDrift,
    severity: 'critical',
    title: `Ledger drift for user ${drift.userId}: cached ${drift.cachedBalance} vs ledger ${drift.ledgerSum}`,
    payload: { ...drift, difference: drift.cachedBalance - drift.ledgerSum },
    dedupeKey: `ledger_drift:${drift.userId}`,
  };
}
