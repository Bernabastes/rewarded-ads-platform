/**
 * Ethiopian (Ge'ez, Amete Mihret) <-> Gregorian calendar conversion.
 *
 * The Ethiopian calendar has 12 months of 30 days plus a 13th month, Pagume (ጳጉሜ), of 5 days
 * (6 in leap years). A year is a leap year when `year % 4 === 3`. Conversion goes through the
 * Julian Day Number so both directions are exact for every date in the supported range.
 *
 * Used by the API to validate `dateOfBirthEthiopian` server-side (the stored value is Gregorian)
 * and by the mobile app to render an Ethiopian date picker.
 */

export interface CalendarDate {
  year: number;
  /** 1-based month. Ethiopian: 1-13 (13 = Pagume). Gregorian: 1-12. */
  month: number;
  /** 1-based day of month. */
  day: number;
}

/** Julian Day Number of Meskerem 1, 1 A.M. minus one (Beyene & Kudlek epoch offset). */
const JDN_EPOCH_AMETE_MIHRET = 1723856;

export const ETHIOPIAN_MONTHS = [
  { index: 1, am: 'መስከረም', en: 'Meskerem' },
  { index: 2, am: 'ጥቅምት', en: 'Tikimt' },
  { index: 3, am: 'ኅዳር', en: 'Hidar' },
  { index: 4, am: 'ታኅሣሥ', en: 'Tahsas' },
  { index: 5, am: 'ጥር', en: 'Tir' },
  { index: 6, am: 'የካቲት', en: 'Yekatit' },
  { index: 7, am: 'መጋቢት', en: 'Megabit' },
  { index: 8, am: 'ሚያዝያ', en: 'Miyazya' },
  { index: 9, am: 'ግንቦት', en: 'Ginbot' },
  { index: 10, am: 'ሰኔ', en: 'Sene' },
  { index: 11, am: 'ሐምሌ', en: 'Hamle' },
  { index: 12, am: 'ነሐሴ', en: 'Nehase' },
  { index: 13, am: 'ጳጉሜ', en: 'Pagume' },
] as const;

export function isEthiopianLeapYear(year: number): boolean {
  return ((year % 4) + 4) % 4 === 3;
}

/** Days in the given Ethiopian month (30, or 5/6 for Pagume). */
export function ethiopianMonthLength(year: number, month: number): number {
  if (month < 1 || month > 13) return 0;
  if (month <= 12) return 30;
  return isEthiopianLeapYear(year) ? 6 : 5;
}

export function isValidEthiopianDate(date: CalendarDate): boolean {
  const { year, month, day } = date;
  if (![year, month, day].every((n) => Number.isInteger(n))) return false;
  if (year < 1 || month < 1 || month > 13 || day < 1) return false;
  return day <= ethiopianMonthLength(year, month);
}

function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function gregorianMonthLength(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) return isGregorianLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidGregorianDate(date: CalendarDate): boolean {
  const { year, month, day } = date;
  if (![year, month, day].every((n) => Number.isInteger(n))) return false;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= gregorianMonthLength(year, month);
}

/* ------------------------------ JDN core ------------------------------ */

export function ethiopianToJdn(date: CalendarDate): number {
  const { year, month, day } = date;
  return JDN_EPOCH_AMETE_MIHRET + 365 + 365 * (year - 1) + Math.floor(year / 4) + 30 * month + day - 31;
}

export function jdnToEthiopian(jdn: number): CalendarDate {
  const offset = jdn - JDN_EPOCH_AMETE_MIHRET;
  const r = ((offset % 1461) + 1461) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor(offset / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

export function gregorianToJdn(date: CalendarDate): number {
  const { year, month, day } = date;
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

export function jdnToGregorian(jdn: number): CalendarDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/* ------------------------------ public API ------------------------------ */

/** Ethiopian -> Gregorian. Throws RangeError for an invalid Ethiopian date (e.g. Pagume 6 in a non-leap year). */
export function ethiopianToGregorian(date: CalendarDate): CalendarDate {
  if (!isValidEthiopianDate(date)) {
    throw new RangeError(`Invalid Ethiopian date ${date.year}-${date.month}-${date.day}`);
  }
  return jdnToGregorian(ethiopianToJdn(date));
}

/** Gregorian -> Ethiopian. Throws RangeError for an invalid Gregorian date. */
export function gregorianToEthiopian(date: CalendarDate): CalendarDate {
  if (!isValidGregorianDate(date)) {
    throw new RangeError(`Invalid Gregorian date ${date.year}-${date.month}-${date.day}`);
  }
  return jdnToEthiopian(gregorianToJdn(date));
}

/** Parse `YYYY-MM-DD` (Gregorian, as used on the wire) into a CalendarDate; `null` when malformed/invalid. */
export function parseIsoDate(value: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidGregorianDate(date) ? date : null;
}

/** Format a CalendarDate as `YYYY-MM-DD` (zero padded; used for Gregorian wire dates). */
export function formatIsoDate(date: CalendarDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** Human-readable Ethiopian date, e.g. "12 መስከረም 2016" (am) or "12 Meskerem 2016" (en). */
export function formatEthiopianDate(date: CalendarDate, locale: 'am' | 'en' = 'am'): string {
  const month = ETHIOPIAN_MONTHS[date.month - 1];
  return `${date.day} ${month ? month[locale] : date.month} ${date.year}`;
}

/** Today's date in the Ethiopian calendar (UTC day; Ethiopia is UTC+3 all year). */
export function todayEthiopian(now: Date = new Date()): CalendarDate {
  return gregorianToEthiopian({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  });
}
