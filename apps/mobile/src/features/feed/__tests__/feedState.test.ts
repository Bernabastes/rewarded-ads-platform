import { feedEmptyKind } from '../feedState';

describe('feedEmptyKind', () => {
  it('prefers the daily cap over frequency caps', () => {
    expect(feedEmptyKind({ dailyRemaining: 0, hiddenByFrequencyCap: 3 })).toBe('daily_done');
  });

  it('shows the frequency-cap state when the remaining ads are hidden by advertiser / campaign caps', () => {
    expect(feedEmptyKind({ dailyRemaining: 12, hiddenByFrequencyCap: 2 })).toBe('frequency_capped');
  });

  it('falls back to the plain empty state', () => {
    expect(feedEmptyKind({ dailyRemaining: 12, hiddenByFrequencyCap: 0 })).toBe('no_ads');
    expect(feedEmptyKind(null)).toBe('no_ads');
    expect(feedEmptyKind({ dailyRemaining: 5, hiddenByFrequencyCap: undefined as never })).toBe('no_ads');
  });
});
