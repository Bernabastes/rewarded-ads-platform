import type { CalendarDate, EthiopianDate, Language } from '@rap/shared';
import {
  calculateAge,
  ethiopianMonthLength,
  ethiopianToGregorian,
  ETHIOPIAN_MONTHS,
  formatIsoDate,
  gregorianToEthiopian,
  isValidEthiopianDate,
  isValidGregorianDate,
  parseIsoDate,
  todayEthiopian,
} from '@rap/shared';

export type CalendarKind = 'ethiopian' | 'gregorian';

/** Raw text of the three date fields as typed by the user. */
export interface DobParts {
  day: string;
  month: string;
  year: string;
}

export const EMPTY_DOB: DobParts = { day: '', month: '', year: '' };

/** A fully validated birth date in both calendars plus the wire representation. */
export interface ResolvedDob {
  gregorian: CalendarDate;
  ethiopian: CalendarDate;
  /** `YYYY-MM-DD` (Gregorian) as the API stores it. */
  iso: string;
  age: number;
}

/** Ethiopian calendar is the everyday calendar for Amharic speakers; everyone else starts on Gregorian. */
export function defaultCalendarFor(language: Language): CalendarKind {
  return language === 'am' ? 'ethiopian' : 'gregorian';
}

function toInt(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

function partsToCalendarDate(parts: DobParts): CalendarDate | null {
  const day = toInt(parts.day);
  const month = toInt(parts.month);
  const year = toInt(parts.year);
  if (day === null || month === null || year === null) return null;
  if (parts.year.trim().length !== 4) return null;
  return { year, month, day };
}

function gregorianToUtcDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/**
 * Validates and converts the typed parts for the given calendar. Returns null while the input is
 * incomplete or impossible (e.g. Pagume 6 in a non-leap year, 30 February, a future date).
 */
export function resolveDob(kind: CalendarKind, parts: DobParts, now: Date = new Date()): ResolvedDob | null {
  const typed = partsToCalendarDate(parts);
  if (!typed) return null;
  let gregorian: CalendarDate;
  let ethiopian: CalendarDate;
  if (kind === 'ethiopian') {
    if (typed.year < 1800 || !isValidEthiopianDate(typed)) return null;
    ethiopian = typed;
    gregorian = ethiopianToGregorian(typed);
  } else {
    if (typed.year < 1900 || !isValidGregorianDate(typed)) return null;
    gregorian = typed;
    ethiopian = gregorianToEthiopian(typed);
  }
  const utc = gregorianToUtcDate(gregorian);
  if (utc.getTime() > now.getTime()) return null;
  return { gregorian, ethiopian, iso: formatIsoDate(gregorian), age: calculateAge(utc, now) };
}

/** Exactly one of the two DOB fields, as the API requires ("never both"). */
export type DobPayload = { dateOfBirth: string } | { dateOfBirthEthiopian: EthiopianDate };

export function dobPayload(kind: CalendarKind, resolved: ResolvedDob): DobPayload {
  if (kind === 'ethiopian') {
    const { year, month, day } = resolved.ethiopian;
    return { dateOfBirthEthiopian: { year, month, day } };
  }
  return { dateOfBirth: resolved.iso };
}

/** Days available for the currently typed Ethiopian year/month (30, or 5/6 for Pagume); 30 while unknown. */
export function ethiopianDaysInTypedMonth(parts: DobParts): number {
  const month = toInt(parts.month);
  const year = toInt(parts.year);
  if (month === null || month < 1 || month > 13) return 30;
  if (month <= 12) return 30;
  // Pagume: 6 days only in a known leap year; without a year assume the longer month so entry is not blocked.
  return year === null || parts.year.trim().length !== 4 ? 6 : ethiopianMonthLength(year, 13);
}

/** Converts the typed parts to the other calendar when they form a valid date, else clears them. */
export function convertParts(from: CalendarKind, to: CalendarKind, parts: DobParts, now: Date = new Date()): DobParts {
  if (from === to) return parts;
  const resolved = resolveDob(from, parts, now);
  if (!resolved) return EMPTY_DOB;
  const target = to === 'ethiopian' ? resolved.ethiopian : resolved.gregorian;
  return { day: String(target.day), month: String(target.month), year: String(target.year) };
}

/** Sensible year bounds for the pickers: an 18-year-old today back to ~120 years. */
export function birthYearRange(kind: CalendarKind, now: Date = new Date()): { min: number; max: number } {
  const maxYear = kind === 'ethiopian' ? todayEthiopian(now).year : now.getUTCFullYear();
  return { min: maxYear - 120, max: maxYear };
}

export function monthLabel(index: number, language: Language): string {
  const month = ETHIOPIAN_MONTHS[index - 1];
  if (!month) return String(index);
  return language === 'am' || language === 'ti' ? month.am : month.en;
}

/** "5 ጳጉሜ 1985 · Pagume" style label: primary name in the UI script, the other script as a hint. */
export function monthSecondaryLabel(index: number, language: Language): string {
  const month = ETHIOPIAN_MONTHS[index - 1];
  if (!month) return '';
  return language === 'am' || language === 'ti' ? month.en : month.am;
}

/** Ethiopian rendering of a stored Gregorian `YYYY-MM-DD` (null when the string is malformed). */
export function isoToEthiopian(iso: string | null | undefined): CalendarDate | null {
  if (!iso) return null;
  const parsed = parseIsoDate(iso);
  return parsed ? gregorianToEthiopian(parsed) : null;
}
