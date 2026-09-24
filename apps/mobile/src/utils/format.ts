import type { Language } from '@rap/shared';
import { coinsToEtb, roundEtb } from '@rap/shared';
import type { TFunction } from 'i18next';

import { getCurrentLanguage, getLocale } from '@/i18n';

type NumberOptions = Intl.NumberFormatOptions;

function safeNumberFormat(locale: string, options?: NumberOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat('en', options);
  }
}

export function formatNumber(value: number, language: Language = getCurrentLanguage(), options?: NumberOptions) {
  return safeNumberFormat(getLocale(language), options).format(value);
}

/** Integer coins with thousands separators: 12500 -> "12,500". */
export function formatCoins(coins: number, language: Language = getCurrentLanguage()): string {
  return formatNumber(Math.trunc(coins), language, { maximumFractionDigits: 0 });
}

/** ETB with exactly 2 decimals: 1250.5 -> "1,250.50". Currency label is added by i18n (`money.etb`). */
export function formatEtbNumber(amount: number, language: Language = getCurrentLanguage()): string {
  return formatNumber(roundEtb(amount), language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Localised "ETB 12.50" / "12.50 ብር". */
export function formatEtb(amount: number, t: TFunction, language: Language = getCurrentLanguage()): string {
  return t('money.etb', { amount: formatEtbNumber(amount, language) });
}

/** Localised ETB equivalent of a coin amount at the server-provided rate. */
export function formatCoinsAsEtb(
  coins: number,
  coinsPerEtb: number,
  t: TFunction,
  language: Language = getCurrentLanguage(),
): string {
  return formatEtb(coinsToEtb(Math.trunc(coins), coinsPerEtb), t, language);
}

/** "0:45", "1:05", "12:00". */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Human estimate: < 60s -> "30s", otherwise rounded-up minutes -> "2 min". */
export function formatEstimatedTime(totalSeconds: number, t: TFunction): string {
  if (totalSeconds < 60) return t('common.secondsShort', { count: Math.max(1, Math.round(totalSeconds)) });
  return t('common.minutesShort', { count: Math.ceil(totalSeconds / 60) });
}

/** Local calendar day key "YYYY-MM-DD" used to group ledger entries. */
export function dayKey(iso: string, now?: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  void now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDayHeader(
  key: string,
  t: TFunction,
  language: Language = getCurrentLanguage(),
  now: Date = new Date(),
): string {
  const todayKey = dayKey(now.toISOString());
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === todayKey) return t('common.today');
  if (key === dayKey(yesterday.toISOString())) return t('common.yesterday');
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  try {
    return new Intl.DateTimeFormat(getLocale(language), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    }).format(date);
  } catch {
    return key;
  }
}

export function formatDateTime(iso: string, language: Language = getCurrentLanguage()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(getLocale(language), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function formatDate(iso: string, language: Language = getCurrentLanguage()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(getLocale(language), { day: 'numeric', month: 'long', year: 'numeric' }).format(
      date,
    );
  } catch {
    return date.toLocaleDateString();
  }
}

export function formatTime(iso: string, language: Language = getCurrentLanguage()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(getLocale(language), { hour: '2-digit', minute: '2-digit' }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

/** "Just now" / "5 min ago" / "3 h ago" / full date beyond a day. */
export function formatRelative(
  iso: string,
  t: TFunction,
  language: Language = getCurrentLanguage(),
  now: Date = new Date(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMin = Math.round((now.getTime() - then) / 60000);
  if (diffMin < 1) return t('common.justNow');
  if (diffMin < 60) return t('common.minutesAgo', { count: diffMin });
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return t('common.hoursAgo', { count: diffHours });
  return formatDateTime(iso, language);
}

/** Masks all but the last 4 characters: "+251911000000" -> "+2519****0000". */
export function maskDestination(value: string): string {
  if (value.length <= 4) return value;
  const visibleStart = value.startsWith('+') ? 5 : 2;
  if (value.length <= visibleStart + 4) return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
  return `${value.slice(0, visibleStart)}${'*'.repeat(value.length - visibleStart - 4)}${value.slice(-4)}`;
}
