import type { AdCompletionResult } from '@rap/shared';
import { ErrorCode } from '@rap/shared';
import { screen, waitFor } from '@testing-library/react-native';

import AdResultScreen from '../../app/ad/result';
import { usersApi } from '@/api/endpoints/users';
import { useWatchResultStore } from '@/features/watch/watchResult';
import { renderWithProviders, useTestLanguage } from '../render';

jest.mock('@/api/endpoints/users', () => ({
  usersApi: {
    balance: jest.fn(),
    me: jest.fn(),
    summary: jest.fn(),
    ledger: jest.fn(),
  },
}));

const balanceMock = usersApi.balance as jest.Mock;

const context = { adId: 'ad-1', adTitle: 'Morning Roast launch', advertiserName: 'Buna Time', rewardCoins: 150 };
const base: AdCompletionResult = {
  completionId: 'comp-1',
  sessionId: 'sess-1',
  status: 'valid',
  coinReward: 150,
  watchDurationSeconds: 31,
  newBalance: 12650,
  reasonCode: null,
  fraudFlags: [],
  replayed: false,
};

describe('Ad result screen', () => {
  beforeEach(() => {
    balanceMock.mockResolvedValue({
      coinBalance: 12650,
      etbEquivalent: 126.5,
      coinsPerEtb: 100,
      ledgerChecksum: { entries: 1, ledgerSum: 12650, consistent: true },
      conversionNote: '',
    });
  });
  afterEach(async () => {
    useWatchResultStore.getState().clear();
    await useTestLanguage('am');
  });

  it('celebrates a valid completion and shows the refetched server balance', async () => {
    await useTestLanguage('en');
    useWatchResultStore.getState().setResult(base, context);
    await renderWithProviders(<AdResultScreen />);

    expect(screen.getByTestId('ad-result-valid')).toBeTruthy();
    expect(screen.getByText('Reward earned!')).toBeTruthy();
    expect(screen.getByTestId('coin-earned')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('12,650 coins')).toBeTruthy());
    expect(balanceMock).toHaveBeenCalled();
    expect(screen.getByText('ETB 126.50')).toBeTruthy();
  });

  it('explains a flagged completion honestly (no coins shown as earned)', async () => {
    await useTestLanguage('en');
    useWatchResultStore.getState().setResult({ ...base, status: 'flagged', coinReward: 0, newBalance: null }, context);
    await renderWithProviders(<AdResultScreen />);
    expect(screen.getByTestId('ad-result-flagged')).toBeTruthy();
    expect(screen.getByText('Under review')).toBeTruthy();
    expect(screen.queryByTestId('coin-earned')).toBeNull();
  });

  it('shows the localised rejection reason and the replay notice', async () => {
    useWatchResultStore.getState().setResult(
      { ...base, status: 'rejected', coinReward: 0, newBalance: null, reasonCode: ErrorCode.ATTENTION_CHECK_FAILED, replayed: true },
      context,
    );
    await renderWithProviders(<AdResultScreen />);
    expect(screen.getByTestId('ad-result-rejected')).toBeTruthy();
    expect(screen.getByTestId('result-reason')).toHaveTextContent('የትኩረት ጥያቄው መልስ ትክክል አልነበረም።');
    expect(screen.getByText('ይህ ውጤት ቀደም ብሎ ተመዝግቧል — ቀሪ ሂሳብዎ ሁለት ጊዜ አልተቀየረም።')).toBeTruthy();
  });

  it('redirects home when opened without a result', async () => {
    await renderWithProviders(<AdResultScreen />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/(tabs)');
  });
});
