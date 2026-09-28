// Ethiopian <-> Gregorian calendar conversion (runs against the built CJS bundle like money.test.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ethiopianMonthLength,
  ethiopianToGregorian,
  formatEthiopianDate,
  formatIsoDate,
  gregorianToEthiopian,
  isEthiopianLeapYear,
  isValidEthiopianDate,
  parseIsoDate,
} from '../dist/index.js';

test('Ethiopian new year (Meskerem 1) falls on 11 September, or 12 September before a Gregorian leap year', () => {
  assert.deepEqual(ethiopianToGregorian({ year: 2016, month: 1, day: 1 }), { year: 2023, month: 9, day: 12 });
  assert.deepEqual(ethiopianToGregorian({ year: 2017, month: 1, day: 1 }), { year: 2024, month: 9, day: 11 });
  assert.deepEqual(ethiopianToGregorian({ year: 2018, month: 1, day: 1 }), { year: 2025, month: 9, day: 11 });
  assert.deepEqual(ethiopianToGregorian({ year: 2020, month: 1, day: 1 }), { year: 2027, month: 9, day: 12 });
});

test('well-known dates convert both ways', () => {
  // Ethiopian millennium: Meskerem 1, 2000 = 12 Sep 2007
  assert.deepEqual(ethiopianToGregorian({ year: 2000, month: 1, day: 1 }), { year: 2007, month: 9, day: 12 });
  assert.deepEqual(gregorianToEthiopian({ year: 2007, month: 9, day: 12 }), { year: 2000, month: 1, day: 1 });
  // Ethiopian Christmas (Genna) 2016 E.C. fell on Tahsas 28 (the year after Pagume 6) = 7 Jan 2024
  assert.deepEqual(ethiopianToGregorian({ year: 2016, month: 4, day: 28 }), { year: 2024, month: 1, day: 7 });
  assert.deepEqual(ethiopianToGregorian({ year: 2016, month: 4, day: 29 }), { year: 2024, month: 1, day: 8 });
  // ... and on Tahsas 29 in an ordinary year = 7 Jan 2025
  assert.deepEqual(ethiopianToGregorian({ year: 2017, month: 4, day: 29 }), { year: 2025, month: 1, day: 7 });
  // Adwa victory day Yekatit 23 = 2 March (non-leap Gregorian year)
  assert.deepEqual(ethiopianToGregorian({ year: 2015, month: 6, day: 23 }), { year: 2023, month: 3, day: 2 });
  assert.deepEqual(gregorianToEthiopian({ year: 2023, month: 3, day: 2 }), { year: 2015, month: 6, day: 23 });
});

test('leap years and Pagume length', () => {
  assert.equal(isEthiopianLeapYear(2015), true); // 2015 % 4 === 3
  assert.equal(isEthiopianLeapYear(2016), false);
  assert.equal(isEthiopianLeapYear(2019), true);
  assert.equal(ethiopianMonthLength(2015, 13), 6);
  assert.equal(ethiopianMonthLength(2016, 13), 5);
  assert.equal(ethiopianMonthLength(2016, 5), 30);
  // Pagume 6, 2015 is the day before Meskerem 1, 2016
  assert.deepEqual(ethiopianToGregorian({ year: 2015, month: 13, day: 6 }), { year: 2023, month: 9, day: 11 });
  assert.deepEqual(gregorianToEthiopian({ year: 2023, month: 9, day: 11 }), { year: 2015, month: 13, day: 6 });
  // Pagume 5, 2016 -> 10 Sep 2024 (non-leap: only 5 days)
  assert.deepEqual(ethiopianToGregorian({ year: 2016, month: 13, day: 5 }), { year: 2024, month: 9, day: 10 });
});

test('invalid Ethiopian dates are rejected', () => {
  assert.equal(isValidEthiopianDate({ year: 2016, month: 13, day: 6 }), false); // not a leap year
  assert.equal(isValidEthiopianDate({ year: 2015, month: 13, day: 6 }), true);
  assert.equal(isValidEthiopianDate({ year: 2016, month: 13, day: 7 }), false);
  assert.equal(isValidEthiopianDate({ year: 2016, month: 14, day: 1 }), false);
  assert.equal(isValidEthiopianDate({ year: 2016, month: 0, day: 1 }), false);
  assert.equal(isValidEthiopianDate({ year: 2016, month: 3, day: 31 }), false);
  assert.equal(isValidEthiopianDate({ year: 2016, month: 3, day: 0 }), false);
  assert.equal(isValidEthiopianDate({ year: 2016.5, month: 3, day: 1 }), false);
  assert.throws(() => ethiopianToGregorian({ year: 2016, month: 13, day: 6 }), RangeError);
  assert.throws(() => gregorianToEthiopian({ year: 2023, month: 2, day: 29 }), RangeError);
});

test('round trip over every day of a 4-year cycle (covers Gregorian 29 Feb and Ethiopian Pagume 6)', () => {
  let count = 0;
  for (let year = 2012; year <= 2015; year++) {
    for (let month = 1; month <= 13; month++) {
      const len = ethiopianMonthLength(year, month);
      for (let day = 1; day <= len; day++) {
        const g = ethiopianToGregorian({ year, month, day });
        assert.deepEqual(gregorianToEthiopian(g), { year, month, day });
        count++;
      }
    }
  }
  assert.equal(count, 365 * 3 + 366);
});

test('iso helpers and formatting', () => {
  assert.deepEqual(parseIsoDate('1994-03-21'), { year: 1994, month: 3, day: 21 });
  assert.equal(parseIsoDate('1994-02-30'), null);
  assert.equal(parseIsoDate('21/03/1994'), null);
  assert.equal(formatIsoDate({ year: 1994, month: 3, day: 1 }), '1994-03-01');
  assert.equal(formatEthiopianDate({ year: 2016, month: 1, day: 12 }, 'en'), '12 Meskerem 2016');
  assert.equal(formatEthiopianDate({ year: 2016, month: 13, day: 5 }), '5 ጳጉሜ 2016');
  // an 18th birthday computed through the Ethiopian calendar: Megabit 12, 1986 = 21 Mar 1994
  assert.deepEqual(ethiopianToGregorian({ year: 1986, month: 7, day: 12 }), { year: 1994, month: 3, day: 21 });
});
