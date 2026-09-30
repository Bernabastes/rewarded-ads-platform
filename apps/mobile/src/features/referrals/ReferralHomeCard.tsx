import { PLATFORM_DEFAULTS } from '@rap/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useReferrals } from '@/api/queries/users';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCoins } from '@/utils/format';

/** Home teaser for the referral programme: the bonus amount and, once invites exist, a tiny tally. */
export function ReferralHomeCard({ onPress }: { onPress(): void }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const referrals = useReferrals();
  const bonus = referrals.data?.bonusCoins.referrer ?? PLATFORM_DEFAULTS.REFERRAL_BONUS_COINS;
  const totals = referrals.data?.totals;

  return (
    <Card onPress={onPress} accessibilityLabel={t('referrals.homeA11y', { coins: formatCoins(bonus, language) })} testID="home-referral-card" tone="accent" padding={spacing.md}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.surface, borderRadius: radii.md }]}>
          <Icon name="gift" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" weight="semibold">
            {t('referrals.homeTitle', { coins: formatCoins(bonus, language) })}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={2}>
            {totals && totals.invited > 0
              ? t('referrals.homeTally', { invited: totals.invited, paid: totals.paid })
              : t('referrals.homeBody')}
          </Text>
        </View>
        <Icon name="chevronRight" size={18} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
