import type { AdFeedItem } from '@rap/shared';
import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { CoinMark } from '@/components/ui/CoinMark';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCoins, formatEstimatedTime, formatEtbNumber } from '@/utils/format';

export interface FeedCardProps {
  ad: AdFeedItem;
  onPress(ad: AdFeedItem): void;
  testID?: string;
}

const THUMB_HEIGHT = 168;

export const FeedCard = memo(function FeedCard({ ad, onPress, testID }: FeedCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, radii, spacing } = useTheme();
  const time = formatEstimatedTime(ad.estimatedSeconds, t);
  const coins = formatCoins(ad.rewardCoins, language);
  const etbNumber = formatEtbNumber(ad.rewardEtb, language);
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <Card
      padding={0}
      elevation="raised"
      onPress={() => onPress(ad)}
      testID={testID ?? `feed-card-${ad.id}`}
      accessibilityLabel={t('a11y.adCard', { title: ad.title, brand: ad.advertiserName, coins, time })}
      accessibilityHint={t('home.watch')}
      style={styles.card}
    >
      <View style={[styles.thumbWrap, { backgroundColor: colors.surfaceMuted }]}>
        {ad.thumbnailUrl && !thumbFailed ? (
          <Image
            source={{ uri: ad.thumbnailUrl }}
            onError={() => setThumbFailed(true)}
            style={styles.thumb}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Icon name="video" size={40} color={colors.textMuted} strokeWidth={1.4} />
          </View>
        )}
        <View style={[styles.playBadge, { backgroundColor: 'rgba(29,26,23,0.72)', borderRadius: radii.full }]}>
          <Icon name="play" size={14} color="#FFFFFF" filled />
          <Text variant="caption" weight="semibold" style={{ color: '#FFFFFF' }}>
            {time}
          </Text>
        </View>
        {ad.hasAttentionCheck ? (
          <Badge label={t('home.attentionBadge')} tone="accent" icon="helpCircle" style={styles.attentionBadge} />
        ) : null}
      </View>

      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <View>
          <Text variant="caption" tone="muted" weight="medium" numberOfLines={1}>
            {ad.advertiserName}
          </Text>
          <Text variant="h3" weight="semibold" numberOfLines={2} style={{ marginTop: 2 }}>
            {ad.title}
          </Text>
        </View>
        <View style={styles.rewardRow}>
          <View style={styles.rewardLeft}>
            <CoinMark size={22} />
            <Text variant="body" weight="bold" tone="primary">
              {t('money.coins', { count: ad.rewardCoins })}
            </Text>
            <Text variant="bodySmall" tone="muted">
              {t('money.approxEtb', { amount: etbNumber })}
            </Text>
          </View>
          <Icon name="chevronRight" size={20} color={colors.textMuted} />
        </View>
      </View>
    </Card>
  );
});

export function FeedCardSkeleton() {
  const { spacing } = useTheme();
  return (
    <Card padding={0} style={styles.card}>
      <Skeleton height={THUMB_HEIGHT} radius={0} />
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Skeleton width={90} height={12} />
        <Skeleton width="80%" height={22} />
        <Skeleton width={140} height={18} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  thumbWrap: { height: THUMB_HEIGHT, position: 'relative' },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  attentionBadge: { position: 'absolute', left: 12, top: 12 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rewardLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap' },
});
