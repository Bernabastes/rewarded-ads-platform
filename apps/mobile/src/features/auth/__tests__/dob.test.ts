import {
  birthYearRange,
  convertParts,
  defaultCalendarFor,
  dobPayload,
  ethiopianDaysInTypedMonth,
  isoToEthiopian,
  monthLabel,
  resolveDob,
} from '../dob';

const NOW = new Date('2026-09-29T12:00:00Z');

describe('Ethiopian date of birth', () => {
  it('defaults Amharic speakers to the Ethiopian calendar and everyone else to Gregorian', () => {
    expect(defaultCalendarFor('am')).toBe('ethiopian');
    expect(defaultCalendarFor('en')).toBe('gregorian');
    expect(defaultCalendarFor('om')).toBe('gregorian');
  });

  it('converts an Ethiopian birth date to the Gregorian wire format and computes the age', () => {
    const resolved = resolveDob('ethiopian', { day: '5', month: '13', year: '1985' }, NOW);
    expect(resolved).not.toBeNull();
    // Pagume 5, 1985 E.C. = 10 September 1993 (matches the API's own conversion).
    expect(resolved?.iso).toBe('1993-09-10');
    expect(resolved?.gregorian).toEqual({ year: 1993, month: 9, day: 10 });
    expect(resolved?.ethiopian).toEqual({ year: 1985, month: 13, day: 5 });
    expect(resolved?.age).toBe(33);
  });

  it('accepts Pagume 6 only in Ethiopian leap years (year % 4 === 3)', () => {
    expect(resolveDob('ethiopian', { day: '6', month: '13', year: '1987' }, NOW)?.iso).toBe('1995-09-11');
    expect(resolveDob('ethiopian', { day: '6', month: '13', year: '1985' }, NOW)).toBeNull();
    expect(resolveDob('ethiopian', { day: '7', month: '13', year: '1987' }, NOW)).toBeNull();
    expect(ethiopianDaysInTypedMonth({ day: '', month: '13', year: '1987' })).toBe(6);
    expect(ethiopianDaysInTypedMonth({ day: '', month: '13', year: '1985' })).toBe(5);
    // Year not typed yet: do not block entry.
    expect(ethiopianDaysInTypedMonth({ day: '', month: '13', year: '' })).toBe(6);
    expect(ethiopianDaysInTypedMonth({ day: '', month: '4', year: '1985' })).toBe(30);
  });

  it('rejects impossible or incomplete dates in both calendars', () => {
    expect(resolveDob('ethiopian', { day: '31', month: '1', year: '1985' }, NOW)).toBeNull();
    expect(resolveDob('ethiopian', { day: '1', month: '14', year: '1985' }, NOW)).toBeNull();
    expect(resolveDob('ethiopian', { day: '1', month: '1', year: '85' }, NOW)).toBeNull();
    expect(resolveDob('gregorian', { day: '30', month: '2', year: '1990' }, NOW)).toBeNull();
    expect(resolveDob('gregorian', { day: '29', month: '2', year: '2000' }, NOW)?.iso).toBe('2000-02-29');
    expect(resolveDob('gregorian', { day: '29', month: '2', year: '1900' }, NOW)).toBeNull();
    expect(resolveDob('gregorian', { day: '', month: '2', year: '1990' }, NOW)).toBeNull();
  });

  it('rejects dates in the future', () => {
    expect(resolveDob('gregorian', { day: '30', month: '9', year: '2026' }, NOW)).toBeNull();
    expect(resolveDob('ethiopian', { day: '30', month: '1', year: '2019' }, NOW)).toBeNull();
  });

  it('sends exactly one representation to the API', () => {
    const resolved = resolveDob('ethiopian', { day: '5', month: '13', year: '1985' }, NOW)!;
    expect(dobPayload('ethiopian', resolved)).toEqual({ dateOfBirthEthiopian: { year: 1985, month: 13, day: 5 } });
    expect(dobPayload('gregorian', resolved)).toEqual({ dateOfBirth: '1993-09-10' });
  });

  it('converts typed parts when the calendar toggle changes, and clears invalid input', () => {
    expect(convertParts('ethiopian', 'gregorian', { day: '5', month: '13', year: '1985' }, NOW)).toEqual({ day: '10', month: '9', year: '1993' });
    expect(convertParts('gregorian', 'ethiopian', { day: '10', month: '9', year: '1993' }, NOW)).toEqual({ day: '5', month: '13', year: '1985' });
    expect(convertParts('gregorian', 'ethiopian', { day: '', month: '', year: '' }, NOW)).toEqual({ day: '', month: '', year: '' });
    const same = { day: '1', month: '1', year: '2000' };
    expect(convertParts('gregorian', 'gregorian', same, NOW)).toBe(same);
  });

  it('labels months in the UI script and offers helpers for profile display', () => {
    expect(monthLabel(13, 'am')).toBe('ጳጉሜ');
    expect(monthLabel(13, 'en')).toBe('Pagume');
    expect(monthLabel(1, 'ti')).toBe('መስከረም');
    expect(isoToEthiopian('1993-09-10')).toEqual({ year: 1985, month: 13, day: 5 });
    expect(isoToEthiopian('not-a-date')).toBeNull();
    expect(birthYearRange('ethiopian', NOW).max).toBe(2019);
    expect(birthYearRange('gregorian', NOW)).toEqual({ min: 1906, max: 2026 });
  });
});
