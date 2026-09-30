import type { MyReferralsResponse } from '@rap/shared';
import { screen, waitFor } from '@testing-library/react-native';

import ReferralsScreen from '../../app/referrals';
import { usersApi } from '@/api/endpoints/users';
import { normalizeReferralCode, referralCodeLooksValid, shareTextFor } from '@/features/referrals/referrals';
import { renderWithProviders, useTestLanguage } from '../render';

jest.mock('@/api/endpoints/users', () => ({
  usersApi: { referrals: jest.fn(), me: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));

const referralsMock = usersApi.referrals as jest.Mock;

const data: MyReferralsResponse = {
  code: '779HLB',
  shareText: {
    en: 'Join me on Gize and earn Birr for watching ads. Use my code 779HLB when you sign up: https://gize.app/r/779HLB',
    am: 'Gize ላይ ማስታወቂያ እየተመለከቱ ብር ያግኙ። ሲመዘገቡ ኮዴን 779HLB ይጠቀሙ፦ https://gize.app/r/779HLB',
  },
  shareUrl: 'https://gize.app/r/779HLB',
  bonusCoins: { referrer: 500, referee: 200 },
  maxPerDay: 5,
  totals: { invited: 4, pending: 1, paid: 2, rejected: 1, coinsEarned: 1000 },
  referredBy: null,
  referrals: [
    { id: 'r1', status: 'paid', referee: { id: 'u1', displayName: 'Sara', joinedAt: '2026-09-19T14:31:11.759Z' }, referrerBonusCoins: 500, refereeBonusCoins: 200, qualifiedAt: '2026-09-18T06:54:49.490Z', paidAt: '2026-09-18T06:54:49.490Z', rejectionReason: null, createdAt: '2026-09-17T06:54:49.490Z' },
    { id: 'r2', status: 'pending', referee: { id: 'u2', displayName: 'Mahlet', joinedAt: '2026-09-28T10:00:00.000Z' }, referrerBonusCoins: 500, refereeBonusCoins: 200, qualifiedAt: null, paidAt: null, rejectionReason: null, createdAt: '2026-09-28T10:00:00.000Z' },
    { id: 'r3', status: 'qualified', referee: { id: 'u3', displayName: 'Dawit', joinedAt: '2026-09-27T10:00:00.000Z' }, referrerBonusCoins: 500, refereeBonusCoins: 200, qualifiedAt: '2026-09-27T12:00:00.000Z', paidAt: null, rejectionReason: null, createdAt: '2026-09-27T10:00:00.000Z' },
    { id: 'r4', status: 'rejected', referee: { id: 'u4', displayName: 'Kebede', joinedAt: '2026-09-26T10:00:00.000Z' }, referrerBonusCoins: 500, refereeBonusCoins: 200, qualifiedAt: null, paidAt: null, rejectionReason: 'self_referral_device', createdAt: '2026-09-26T10:00:00.000Z' },
  ],
};

describe('Referrals screen', () => {
  beforeEach(() => referralsMock.mockResolvedValue(data));
  afterEach(() => useTestLanguage('am'));

  it('shows the code, totals and one status chip per invite with the right explanation (English)', async () => {
    await useTestLanguage('en');
    await renderWithProviders(<ReferralsScreen />);

    await waitFor(() => expect(screen.getByTestId('referral-code')).toHaveTextContent('779HLB'));
    expect(screen.getByText('You get 500 coins and your friend gets 200 coins after their first rewarded ad.')).toBeTruthy();
    expect(screen.getByTestId('referral-totals')).toHaveTextContent(/4Invited/);
    expect(screen.getByTestId('referral-totals')).toHaveTextContent(/1,000Coins earned/);

    expect(screen.getByTestId('referral-r1')).toHaveTextContent(/Rewarded/);
    expect(screen.getByTestId('referral-r1')).toHaveTextContent(/\+500 coins added to your wallet\./);
    expect(screen.getByTestId('referral-r2')).toHaveTextContent(/Waiting for first ad/);
    expect(screen.getByTestId('referral-r3')).toHaveTextContent(/Bonus on hold/);
    expect(screen.getByTestId('referral-r4')).toHaveTextContent(/Not eligible/);
    expect(screen.getByTestId('referral-r4')).toHaveTextContent(/same device/);
    expect(screen.getByTestId('referral-share')).toBeTruthy();
    expect(screen.getByTestId('referral-copy')).toBeTruthy();
  });

  it('renders the Amharic copy by default and the empty state without invites', async () => {
    referralsMock.mockResolvedValue({ ...data, totals: { invited: 0, pending: 0, paid: 0, rejected: 0, coinsEarned: 0 }, referrals: [] });
    await renderWithProviders(<ReferralsScreen />);
    await waitFor(() => expect(screen.getByTestId('referral-empty')).toBeTruthy());
    expect(screen.getByText('የግብዣ ኮድዎ')).toBeTruthy();
  });
});

describe('referral helpers', () => {
  it('normalises typed codes and validates the format only', () => {
    expect(normalizeReferralCode(' 779-hlb ')).toBe('779HLB');
    expect(normalizeReferralCode('abcdefgh')).toBe('ABCDEF');
    expect(referralCodeLooksValid('779HLB')).toBe(true);
    // 0 / O / 1 / I are not in the alphabet.
    expect(referralCodeLooksValid('779HL0')).toBe(false);
    expect(referralCodeLooksValid('779HL')).toBe(false);
  });

  it('picks the share text for the UI language (om/ti fall back to Amharic)', () => {
    expect(shareTextFor(data, 'en')).toContain('Join me on Gize');
    expect(shareTextFor(data, 'am')).toContain('ኮዴን 779HLB');
    expect(shareTextFor(data, 'om')).toContain('ኮዴን 779HLB');
  });
});
