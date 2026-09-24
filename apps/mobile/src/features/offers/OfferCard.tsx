import type { OfferListItem } from '@rap/shared';
import { memo } from 'react';
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
import { formatCoins, formatEtbNumber } from '@/utils/format';

export interface OfferCardProps {
  offer: OfferListItem;
  /** Offers at or above this reward are highlighted as "high reward". */
  highRewardThreshold: number;
  onPress(offer: OfferListItem): void;
}

/** Reward at/above which an offer is highlighted: the 60th percentile of the list, min 100 coins. */
export function highRewardThreshold(offers: OfferListItem[]): number {
  if (offers.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = offers.map((o) => o.rewardCoins).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.6));
  return Math.max(100, sorted[idx]);
}

export const OfferCard = memo(function OfferCard({ offer, highRewardThreshold: threshold, onPress }: OfferCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, radii, spacing } = useTheme();
  const isHigh = offer.rewardCoins >= threshold;
  const done = offer.completionStatus !== null;
  const typeLabel = t(`offers.types.${offer.type}`);

  return (
    <Card
      onPress={() => onPress(offer)}
      elevation="raised"
      testID={`offer-card-${offer.id}`}
      accessibilityLabel={t('a11y.offerCard', { type: typeLabel, title: offer.title, coins: formatCoins(offer.rewardCoins, language), minutes: offer.estimatedMinutes })}
      style={isHigh && !done ? { borderWidth: 1.5, borderColor: colors.accent } : undefined}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { borderRadius: radii.md, backgroundColor: offer.type === 'survey' ? colors.primarySoft : colors.accentSoft }]}>
          <Icon name={offer.type === 'survey' ? 'clipboard' : 'download'} size={22} color={offer.type === 'survey' ? colors.primarySoftText : colors.accentSoftText} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.badges}>
            <Badge label={typeLabel} tone={offer.type === 'survey' ? 'primary' : 'accent'} />
            {isHigh && !done ? <Badge label={t('offers.highReward')} tone="warning" icon="star" /> : null}
            {done && offer.completionStatus ? <Badge label={t(`offers.status.${offer.completionStatus}`)} tone={offer.completionStatus === 'valid' ? 'success' : 'neutral'} /> : null}
          </View>
          <Text variant="h3" weight="semibold" numberOfLines={2}>
            {offer.title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {offer.advertiserName} · {t('offers.estimated', { minutes: offer.estimatedMinutes })}
          </Text>
        </View>
      </View>
      <View style={[styles.rewardRow, { marginTop: spacing.md, borderTopColor: colors.border }]}>
        <CoinMark size={20} />
        <Text variant="body" weight="bold" tone="primary">
          {t('money.coins', { count: offer.rewardCoins })}
        </Text>
        <Text variant="bodySmall" tone="muted">
          {t('money.approxEtb', { amount: formatEtbNumber(offer.rewardEtb, language) })}
        </Text>
        <View style={{ flex: 1 }} />
        <Icon name="chevronRight" size={20} color={colors.textMuted} />
      </View>
    </Card>
  );
});

export function OfferCardSkeleton() {
  const { spacing } = useTheme();
  return (
    <Card>
      <View style={styles.row}>
        <Skeleton height={44} width={44} radius={12} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton height={14} width={80} />
          <Skeleton height={22} width="80%" />
          <Skeleton height={12} width="50%" />
        </View>
      </View>
      <Skeleton height={18} width={140} style={{ marginTop: spacing.md }} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1 },
});
