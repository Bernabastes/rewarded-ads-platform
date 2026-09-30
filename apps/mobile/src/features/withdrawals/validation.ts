import type { KycTier, PayoutMethod, WithdrawalConfig, WithdrawalMethodInfo } from '@rap/shared';
import { coinsToEtb, etbToCoins, normalizeEthiopianPhone, roundEtb } from '@rap/shared';

export type AmountValidation =
  | { ok: true; amountEtb: number; coins: number; isLarge: boolean }
  | { ok: false; reason: 'invalid' | 'below_min' | 'insufficient'; amountEtb: number | null; maxEtb: number };

/** Parses user input like "50", "50.5", "1,250.00" or "1 250" into a positive ETB number (2 dp) or null. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('-')) return null;
  const cleaned = trimmed.replace(/[\s,]/g, '').replace(/[^\d.]/g, '');
  if (!cleaned || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return roundEtb(value);
}

/** Highest whole-cent ETB amount the balance can cover. */
export function maxWithdrawableEtb(balanceCoins: number, coinsPerEtb: number): number {
  return coinsToEtb(Math.max(0, Math.trunc(balanceCoins)), coinsPerEtb);
}

export function validateAmount(
  text: string,
  balanceCoins: number,
  config: Pick<WithdrawalConfig, 'minWithdrawalEtb' | 'coinsPerEtb' | 'largeWithdrawalThresholdEtb'>,
): AmountValidation {
  const maxEtb = maxWithdrawableEtb(balanceCoins, config.coinsPerEtb);
  const amountEtb = parseAmount(text);
  if (amountEtb === null) return { ok: false, reason: 'invalid', amountEtb: null, maxEtb };
  if (amountEtb < config.minWithdrawalEtb) return { ok: false, reason: 'below_min', amountEtb, maxEtb };
  const coins = etbToCoins(amountEtb, config.coinsPerEtb);
  if (coins > balanceCoins) return { ok: false, reason: 'insufficient', amountEtb, maxEtb };
  return { ok: true, amountEtb, coins, isLarge: amountEtb >= config.largeWithdrawalThresholdEtb };
}

export function validateDestination(kind: WithdrawalMethodInfo['destinationKind'], value: string): boolean {
  const trimmed = value.trim();
  if (kind === 'phone') return normalizeEthiopianPhone(trimmed) !== null;
  return /^\d{6,24}$/.test(trimmed.replace(/[\s-]/g, ''));
}

/** Server expects E.164 for phones; bank account numbers are sent as digits only. */
export function normalizeDestination(kind: WithdrawalMethodInfo['destinationKind'], value: string): string {
  const trimmed = value.trim();
  if (kind === 'phone') return normalizeEthiopianPhone(trimmed) ?? trimmed;
  return trimmed.replace(/[\s-]/g, '');
}

export function methodRequiresName(method: PayoutMethod): boolean {
  return method === 'bank';
}

export interface KycProjection {
  tier: KycTier;
  thresholdEtb: number;
  monthlyEtb: number;
  projectedEtb: number;
  /**
   * true when a `phone_only` user's rolling-30-day payouts + this request would reach the KYC threshold. The boundary is
   * inclusive (mirrors the API): a projected total equal to the limit already requires KYC.
   */
  exceeds: boolean;
  /** 0..1 share of the monthly allowance already used (capped at 1). */
  progress: number;
}

/** Client-side mirror of the API's KYC gate so the wallet can warn before `POST /withdrawals` answers 422 KYC_REQUIRED. */
export function kycProjection(
  config: Pick<WithdrawalConfig, 'kycTier' | 'kycRequiredAboveMonthlyEtb' | 'monthlyPayoutTotalEtb'>,
  amountEtb: number | null,
): KycProjection {
  const monthlyEtb = config.monthlyPayoutTotalEtb ?? 0;
  const thresholdEtb = config.kycRequiredAboveMonthlyEtb ?? 0;
  const projectedEtb = roundEtb(monthlyEtb + (amountEtb ?? 0));
  const exceeds = config.kycTier === 'phone_only' && thresholdEtb > 0 && projectedEtb >= thresholdEtb;
  return {
    tier: config.kycTier,
    thresholdEtb,
    monthlyEtb,
    projectedEtb,
    exceeds,
    progress: thresholdEtb > 0 ? Math.min(1, monthlyEtb / thresholdEtb) : 0,
  };
}

/** Quick-amount chips: minimum, a couple of round steps and "all", filtered to what the balance allows. */
export function quickAmounts(config: Pick<WithdrawalConfig, 'minWithdrawalEtb'>, maxEtb: number): number[] {
  const candidates = [config.minWithdrawalEtb, 100, 200, 500].filter(
    (value) => value >= config.minWithdrawalEtb && value <= maxEtb,
  );
  if (maxEtb >= config.minWithdrawalEtb && !candidates.includes(maxEtb)) candidates.push(maxEtb);
  return Array.from(new Set(candidates)).sort((a, b) => a - b).slice(0, 4);
}
