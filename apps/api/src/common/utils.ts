import { createHash, randomBytes, randomInt } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomNumericCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += String(randomInt(0, 10));
  return code;
}

/** UTC day key "YYYY-MM-DD" used for daily counters and buckets. */
export function utcDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

export function secondsUntilEndOfUtcDay(now: Date = new Date()): number {
  return Math.max(1, Math.ceil((endOfUtcDay(now).getTime() - now.getTime()) / 1000));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/** Mask all but the last 4 characters: +2519****1234 */
export function maskDestination(value: string): string {
  if (value.length <= 4) return '****';
  const visiblePrefix = value.startsWith('+') ? value.slice(0, 5) : value.slice(0, 2);
  return `${visiblePrefix}${'*'.repeat(Math.max(2, value.length - visiblePrefix.length - 4))}${value.slice(-4)}`;
}

export function parseDateRange(from?: string, to?: string, defaultDays = 30): { from: Date; to: Date } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : addDays(toDate, -defaultDays);
  if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime())) {
    throw new Error('Invalid date range');
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) toDate.setUTCHours(23, 59, 59, 999);
  return { from: fromDate, to: toDate };
}

export function eachUtcDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  while (cursor <= end && days.length < 400) {
    days.push(utcDayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
