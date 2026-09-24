import { PLATFORM_DEFAULTS } from './constants';

/**
 * Money helpers. ETB amounts are handled as numbers with at most 2 decimals on
 * the wire; all arithmetic is done in integer cents/coins to avoid float drift.
 * The API performs the authoritative calculation with Decimal; these helpers
 * exist so frontends can show consistent previews.
 */

/** Round to 2 decimals using integer math (avoids 1.005 -> 1.00 float issues). */
export function roundEtb(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** ETB -> coins (integer). 1.50 ETB -> 150 coins at the default rate. */
export function etbToCoins(amountEtb: number, coinsPerEtb: number = PLATFORM_DEFAULTS.COINS_PER_ETB): number {
  if (!Number.isFinite(amountEtb)) throw new Error('amountEtb must be a finite number');
  return Math.round(roundEtb(amountEtb) * coinsPerEtb);
}

/** coins -> ETB (2 decimals). 150 coins -> 1.50 ETB at the default rate. */
export function coinsToEtb(coins: number, coinsPerEtb: number = PLATFORM_DEFAULTS.COINS_PER_ETB): number {
  if (!Number.isInteger(coins)) throw new Error('coins must be an integer');
  return roundEtb(coins / coinsPerEtb);
}

/**
 * Campaign economics: the advertiser pays `costPerActionEtb` per valid action,
 * the platform keeps `takeRate`, the user receives the remainder as coins.
 *   cost 2.00 ETB, take 0.5 -> reward 1.00 ETB (=100 coins), platform 1.00 ETB
 */
export function computeRewardEtb(
  costPerActionEtb: number,
  takeRate: number = PLATFORM_DEFAULTS.PLATFORM_TAKE_RATE,
): number {
  if (takeRate < 0 || takeRate >= 1) throw new Error('takeRate must be in [0, 1)');
  return roundEtb(costPerActionEtb * (1 - takeRate));
}

export function computePlatformRevenueEtb(
  costPerActionEtb: number,
  takeRate: number = PLATFORM_DEFAULTS.PLATFORM_TAKE_RATE,
): number {
  return roundEtb(costPerActionEtb - computeRewardEtb(costPerActionEtb, takeRate));
}

/** Format ETB for display, e.g. "ETB 1,250.50". */
export function formatEtb(amount: number, locale: string = 'en-ET'): string {
  return `ETB ${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

/** Format coins with thousands separators. */
export function formatCoins(coins: number, locale: string = 'en-ET'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(coins);
}

/** Age calculation (UTC calendar). The API uses this exact function for age verification. */
export function calculateAge(dateOfBirth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) age -= 1;
  return age;
}

/** Normalise an Ethiopian phone number to E.164 (+2519xxxxxxxx). Returns null when invalid. */
export function normalizeEthiopianPhone(input: string): string | null {
  const trimmed = input.replace(/[\s\-()]/g, '');
  const m = /^(?:\+?251|0)?([79]\d{8})$/.exec(trimmed);
  if (!m) return null;
  return `+251${m[1]}`;
}
