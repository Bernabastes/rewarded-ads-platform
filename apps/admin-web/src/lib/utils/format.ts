import { coinsToEtb, formatCoins as sharedFormatCoins, formatEtb as sharedFormatEtb } from '@rap/shared';

const LOCALE = 'en-ET';

/** ETB amounts arrive as JSON numbers (or numeric strings from Decimal fields); normalise defensively. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function formatEtb(value: unknown): string {
  return sharedFormatEtb(toNumber(value), LOCALE);
}

/** Compact ETB for tight table cells: "1,250.50" without the currency prefix. */
export function formatEtbBare(value: unknown): string {
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    toNumber(value),
  );
}

export function formatCoins(value: unknown): string {
  return sharedFormatCoins(Math.round(toNumber(value)), LOCALE);
}

/** "+500 coins (ETB 5.00)" style helper for signed adjustments. */
export function formatSignedCoins(coins: number, coinsPerEtb?: number): string {
  const sign = coins > 0 ? '+' : coins < 0 ? '−' : '';
  return `${sign}${formatCoins(Math.abs(coins))} coins (${formatEtb(coinsToEtb(Math.abs(Math.trunc(coins)), coinsPerEtb))})`;
}

export function formatInt(value: unknown): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(toNumber(value));
}

export function formatPercent(ratio: unknown, digits = 1): string {
  return `${(toNumber(ratio) * 100).toFixed(digits)}%`;
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(d);
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = (d.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(d);
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r.toString().padStart(2, '0')}s` : `${r}s`;
}

/** "abcd1234…" short id for dense tables. */
export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return '—';
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

export function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** snake_case / SCREAMING_SNAKE enum values → "Snake case". */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const lower = value.replace(/[_-]+/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** ISO date "YYYY-MM-DD" in UTC for a Date. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
