import { createI18n } from '@/i18n';

import {
  dayKey,
  formatClock,
  formatCoins,
  formatCoinsAsEtb,
  formatDayHeader,
  formatEstimatedTime,
  formatEtb,
  formatEtbNumber,
  formatRelative,
  maskDestination,
} from '../format';

const en = createI18n('en');
const am = createI18n('am');

describe('format helpers', () => {
  it('formats coins as integers with separators', () => {
    expect(formatCoins(1250, 'en')).toBe('1,250');
    expect(formatCoins(1250.9, 'en')).toBe('1,250');
    expect(formatCoins(0, 'am')).toBe('0');
  });

  it('formats ETB with two decimals and a localised currency label', () => {
    expect(formatEtbNumber(1250.5, 'en')).toBe('1,250.50');
    expect(formatEtbNumber(0.005, 'en')).toBe('0.01');
    expect(formatEtb(12.5, en.t, 'en')).toBe('ETB 12.50');
    expect(formatEtb(12.5, am.t, 'am')).toBe('12.50 ብር');
  });

  it('converts coins to ETB at the server rate before formatting', () => {
    expect(formatCoinsAsEtb(150, 100, en.t, 'en')).toBe('ETB 1.50');
    expect(formatCoinsAsEtb(150, 50, en.t, 'en')).toBe('ETB 3.00');
  });

  it('formats clock and estimated time', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.7)).toBe('1:05');
    expect(formatClock(3600)).toBe('60:00');
    expect(formatEstimatedTime(30, en.t)).toBe('30s');
    expect(formatEstimatedTime(61, en.t)).toBe('2 min');
    expect(formatEstimatedTime(45, am.t)).toBe('45 ሰከንድ');
  });

  it('groups by local calendar day and labels today / yesterday', () => {
    const now = new Date(2026, 8, 24, 10, 0, 0);
    const today = new Date(2026, 8, 24, 8, 30).toISOString();
    const yesterday = new Date(2026, 8, 23, 23, 59).toISOString();
    const older = new Date(2026, 8, 1, 12, 0).toISOString();
    expect(dayKey(today)).toBe('2026-09-24');
    expect(formatDayHeader(dayKey(today), en.t, 'en', now)).toBe('Today');
    expect(formatDayHeader(dayKey(yesterday), en.t, 'en', now)).toBe('Yesterday');
    expect(formatDayHeader(dayKey(yesterday), am.t, 'am', now)).toBe('ትናንት');
    expect(formatDayHeader(dayKey(older), en.t, 'en', now)).toMatch(/Sep/);
  });

  it('formats relative time', () => {
    const now = new Date('2026-09-24T10:00:00Z');
    expect(formatRelative('2026-09-24T09:59:40Z', en.t, 'en', now)).toBe('Just now');
    expect(formatRelative('2026-09-24T09:45:00Z', en.t, 'en', now)).toBe('15 min ago');
    expect(formatRelative('2026-09-24T07:00:00Z', en.t, 'en', now)).toBe('3 h ago');
    expect(formatRelative('2026-09-20T07:00:00Z', en.t, 'en', now)).toMatch(/2026/);
  });

  it('masks destinations keeping the last four characters', () => {
    expect(maskDestination('+251911000000')).toBe('+2519****0000');
    expect(maskDestination('1000123456789')).toBe('10*******6789');
    expect(maskDestination('1234')).toBe('1234');
  });
});
