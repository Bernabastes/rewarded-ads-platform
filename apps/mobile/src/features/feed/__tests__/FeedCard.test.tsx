import type { AdFeedItem } from '@rap/shared';
import { fireEvent, screen } from '@testing-library/react-native';

import { i18n } from '@/i18n';
import { renderWithProviders, useTestLanguage } from '../../../../test/render';
import { FeedCard } from '../FeedCard';

const ad: AdFeedItem = {
  id: 'ad-1',
  campaignId: 'c-1',
  title: 'Morning Roast launch',
  advertiserName: 'Buna Time',
  mediaType: 'video',
  mediaUrl: 'https://cdn.test/ad.mp4',
  thumbnailUrl: 'https://cdn.test/thumb.jpg',
  durationSeconds: 30,
  rewardCoins: 150,
  rewardEtb: 1.5,
  estimatedSeconds: 45,
  hasAttentionCheck: true,
  targetActionType: 'video_view',
};

describe('FeedCard', () => {
  afterEach(() => useTestLanguage('am'));

  it('shows brand, title, reward, estimated time and the attention badge (English)', async () => {
    await useTestLanguage('en');
    const onPress = jest.fn();
    await renderWithProviders(<FeedCard ad={ad} onPress={onPress} />);

    expect(screen.getByText('Morning Roast launch')).toBeTruthy();
    expect(screen.getByText('Buna Time')).toBeTruthy();
    expect(screen.getByText('150 coins')).toBeTruthy();
    expect(screen.getByText('≈ ETB 1.50')).toBeTruthy();
    expect(screen.getByText('45s')).toBeTruthy();
    expect(screen.getByText('1 quick question')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('feed-card-ad-1'));
    expect(onPress).toHaveBeenCalledWith(ad);
  });

  it('renders Amharic copy by default and exposes an accessibility label', async () => {
    await useTestLanguage('am');
    await renderWithProviders(<FeedCard ad={{ ...ad, hasAttentionCheck: false }} onPress={jest.fn()} />);
    expect(screen.getByText('150 ኮይን')).toBeTruthy();
    expect(screen.queryByText(i18n.t('home.attentionBadge'))).toBeNull();
    const card = screen.getByTestId('feed-card-ad-1');
    expect(card.props.accessibilityLabel).toContain('Morning Roast launch');
    expect(card.props.accessibilityLabel).toContain('150');
  });
});
