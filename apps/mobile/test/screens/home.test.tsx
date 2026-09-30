import type { Paginated, AdFeedMeta, AdFeedItem } from '@rap/shared';
import { screen, waitFor } from '@testing-library/react-native';

import HomeScreen from '../../app/(tabs)/index';
import { adsApi } from '@/api/endpoints/ads';
import { usersApi } from '@/api/endpoints/users';
import { useAuthStore } from '@/auth/authStore';
import { renderWithProviders, useTestLanguage } from '../render';

jest.mock('@/api/endpoints/ads', () => ({ adsApi: { feed: jest.fn() } }));
jest.mock('@/api/endpoints/users', () => ({
  usersApi: { balance: jest.fn(), summary: jest.fn(), me: jest.fn(), referrals: jest.fn() },
}));
jest.mock('@/features/watch/useInterruptedWatchSession', () => ({
  useInterruptedWatchSession: () => ({ pending: null, recheck: jest.fn(async () => undefined), dismiss: jest.fn(async () => undefined) }),
}));

const feedMock = adsApi.feed as jest.Mock;
const balanceMock = usersApi.balance as jest.Mock;
const summaryMock = usersApi.summary as jest.Mock;
const referralsMock = usersApi.referrals as jest.Mock;

function page(meta: Partial<AdFeedMeta>, data: AdFeedItem[] = []): Paginated<AdFeedItem, AdFeedMeta> {
  return {
    data,
    meta: { page: 1, limit: 20, total: data.length, dailyLimit: 15, dailyCompleted: 3, dailyRemaining: 12, hiddenByFrequencyCap: 0, ...meta },
  };
}

describe('Home feed empty states', () => {
  beforeEach(() => {
    balanceMock.mockResolvedValue({ coinBalance: 1200, etbEquivalent: 12, coinsPerEtb: 100, ledgerChecksum: { entries: 3, ledgerSum: 1200, consistent: true }, conversionNote: '' });
    summaryMock.mockResolvedValue({ coinBalance: 1200, etbEquivalent: 12, todayCompletions: 3, dailyLimit: 15, dailyRemaining: 12, totalEarnedCoins: 1200, totalWithdrawnEtb: 0, pendingWithdrawalsEtb: 0, unreadNotifications: 0, availableAds: 0, availableOffers: 2 });
    referralsMock.mockResolvedValue({ code: 'ABCDEF', shareText: { en: '', am: '' }, shareUrl: '', bonusCoins: { referrer: 500, referee: 200 }, maxPerDay: 5, totals: { invited: 0, pending: 0, paid: 0, rejected: 0, coinsEarned: 0 }, referredBy: null, referrals: [] });
    useAuthStore.setState({ status: 'signedIn', user: { fullName: 'Abebe Kebede' } as never });
  });
  afterEach(async () => {
    useAuthStore.setState({ status: 'signedOut', user: null });
    await useTestLanguage('am');
  });

  it('explains frequency caps when every remaining ad is hidden by an advertiser cap', async () => {
    await useTestLanguage('en');
    feedMock.mockResolvedValue(page({ hiddenByFrequencyCap: 2 }));
    await renderWithProviders(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('feed-frequency-capped')).toBeTruthy());
    expect(screen.getByText("You have seen today's ads from these advertisers")).toBeTruthy();
    expect(screen.getByText(/2 ads are waiting for you tomorrow/)).toBeTruthy();
    expect(screen.queryByTestId('feed-empty')).toBeNull();
    expect(screen.getByTestId('home-referral-card')).toBeTruthy();
  });

  it('keeps the daily-done state when the daily cap is reached, even with capped ads', async () => {
    feedMock.mockResolvedValue(page({ dailyRemaining: 0, dailyCompleted: 15, hiddenByFrequencyCap: 4 }));
    await renderWithProviders(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('feed-daily-done')).toBeTruthy());
    expect(screen.queryByTestId('feed-frequency-capped')).toBeNull();
  });

  it('falls back to the plain empty state', async () => {
    feedMock.mockResolvedValue(page({}));
    await renderWithProviders(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('feed-empty')).toBeTruthy());
  });
});
