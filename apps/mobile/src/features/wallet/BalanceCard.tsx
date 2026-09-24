import type { BalanceResponse } from '@rap/shared';
import { PLATFORM_DEFAULTS } from '@rap/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CoinMark } from '@/components/ui/CoinMark';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';
import { formatCoins, formatEtb, formatEtbNumber } from '@/utils/format';

export interface BalanceCardProps {
  balance: BalanceResponse | undefined;
  loading?: boolean;
  onWithdraw?: () => void;
  onHistory?: () => void;
  /** Compact variant for the home header (no action buttons). */
  compact?: boolean;
  onPress?: () => void;
  testID?: string;
}

/** Coins + honest ETB equivalent + the conversion rate, always from the server balance. */
export function BalanceCard({
  balance,
  loading,
  onWithdraw,
  onHistory,
  compact = false,
  onPress,
  testID = 'balance-card',
}: BalanceCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { spacing, isDark } = useTheme();

  const coinsPerEtb = balance?.coinsPerEtb ?? PLATFORM_DEFAULTS.COINS_PER_ETB;
  const coinsText = balance ? formatCoins(balance.coinBalance, language) : '';
  const etbText = balance ? formatEtb(balance.etbEquivalent, t, language) : '';
  const onCard = { primary: palette.white, secondary: 'rgba(255,255,255,0.78)' };

  return (
    <Card
      tone="primary"
      elevation="raised"
      onPress={onPress}
      testID={testID}
      accessibilityLabel={balance ? t('a11y.balanceCard', { coins: coinsText, etb: etbText }) : t('a11y.loading')}
      style={{ backgroundColor: isDark ? palette.forest[800] : palette.forest[600] }}
    >
      <View style={styles.headerRow}>
        <Text variant="label" weight="medium" style={{ color: onCard.secondary }}>
          {t('home.balanceTitle')}
        </Text>
        <CoinMark
          size={28}
          outerColor={palette.forest[100]}
          innerColor={palette.terracotta[400]}
          notchColor={palette.forest[600]}
        />
      </View>

      {loading || !balance ? (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Skeleton width={160} height={38} style={{ backgroundColor: 'rgba(255,255,255,0.22)' }} />
          <Skeleton width={110} height={18} style={{ backgroundColor: 'rgba(255,255,255,0.18)' }} />
        </View>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          <View style={styles.amountRow}>
            <Text variant="display" weight="bold" style={{ color: onCard.primary }} testID={`${testID}-coins`}>
              {coinsText}
            </Text>
            <Text variant="h3" weight="medium" style={{ color: onCard.secondary, marginBottom: 6 }}>
              {t('money.coinsLabel')}
            </Text>
          </View>
          <Text variant="h3" weight="semibold" style={{ color: onCard.primary }} testID={`${testID}-etb`}>
            {t('money.approxEtb', { amount: formatEtbNumber(balance.etbEquivalent, language) })}
          </Text>
        </View>
      )}

      <View style={[styles.rateRow, { marginTop: spacing.md }]}>
        <Text variant="caption" style={{ color: onCard.secondary }}>
          {t('money.rate', { coins: formatCoins(coinsPerEtb, language) })}
        </Text>
      </View>

      {!compact && (onWithdraw || onHistory) ? (
        <View style={[styles.actions, { marginTop: spacing.lg }]}>
          {onWithdraw ? (
            <Button
              title={t('balance.withdraw')}
              onPress={onWithdraw}
              variant="accent"
              icon="arrowUpRight"
              fullWidth={false}
              style={{ flex: 1 }}
            />
          ) : null}
          {onHistory ? (
            <Button
              title={t('balance.history')}
              onPress={onHistory}
              variant="secondary"
              icon="receipt"
              fullWidth={false}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', gap: 10 },
});
