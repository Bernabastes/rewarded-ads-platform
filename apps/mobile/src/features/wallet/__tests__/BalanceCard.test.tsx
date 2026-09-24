import type { BalanceResponse, LedgerEntry } from '@rap/shared';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders, useTestLanguage } from '../../../../test/render';
import { BalanceCard } from '../BalanceCard';
import { groupLedgerByDay } from '../LedgerRow';

const balance: BalanceResponse = {
  coinBalance: 12500,
  etbEquivalent: 125,
  coinsPerEtb: 100,
  ledgerChecksum: { entries: 12, ledgerSum: 12500, consistent: true },
  conversionNote: '100 coins = 1 ETB',
};

describe('BalanceCard', () => {
  afterEach(() => useTestLanguage('am'));

  it('renders coins, the ETB equivalent and the honest rate note', async () => {
    await useTestLanguage('en');
    const onWithdraw = jest.fn();
    await renderWithProviders(<BalanceCard balance={balance} onWithdraw={onWithdraw} onHistory={jest.fn()} />);

    expect(screen.getByTestId('balance-card-coins')).toHaveTextContent('12,500');
    expect(screen.getByTestId('balance-card-etb')).toHaveTextContent('≈ ETB 125.00');
    expect(screen.getByText('100 coins = 1 Birr')).toBeTruthy();
    await fireEvent.press(screen.getByText('Withdraw'));
    expect(onWithdraw).toHaveBeenCalled();
  });

  it('renders Amharic by default', async () => {
    await renderWithProviders(<BalanceCard balance={balance} compact />);
    expect(screen.getByText('ቀሪ ሂሳብዎ')).toBeTruthy();
    expect(screen.getByText('100 ኮይን = 1 ብር')).toBeTruthy();
    expect(screen.queryByText('ያውጡ')).toBeNull();
  });

  it('shows skeletons (never a raw number) while loading', async () => {
    await renderWithProviders(<BalanceCard balance={undefined} loading />);
    expect(screen.queryByTestId('balance-card-coins')).toBeNull();
    expect(screen.getByTestId('balance-card').props.accessibilityLabel).toBeTruthy();
  });
});

describe('groupLedgerByDay', () => {
  const entry = (id: string, createdAt: string, amount = 100): LedgerEntry => ({
    id,
    amount,
    balanceAfter: 1000,
    sourceType: 'ad_view',
    sourceId: null,
    description: null,
    createdAt,
  });

  it('groups consecutive entries by local day preserving order', async () => {
    const d = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString();
    const sections = groupLedgerByDay([entry('a', d(24, 10)), entry('b', d(24, 8)), entry('c', d(23, 22), -500), entry('d', d(1, 9))]);
    expect(sections.map((s) => [s.key, s.data.map((e) => e.id)])).toEqual([
      ['2026-09-24', ['a', 'b']],
      ['2026-09-23', ['c']],
      ['2026-09-01', ['d']],
    ]);
  });
});
