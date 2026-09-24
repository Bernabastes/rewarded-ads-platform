import { CompletionStatus } from '@rap/shared';
import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useBalance, useInvalidateMoney } from '@/api/queries/users';
import { Illustration } from '@/components/illustrations/Illustration';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CoinEarnedAnimation } from '@/components/ui/CoinEarnedAnimation';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useWatchResultStore } from '@/features/watch/watchResult';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { formatCoins, formatCoinsAsEtb, formatEtb } from '@/utils/format';

export default function AdResultScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { spacing } = useTheme();
  const result = useWatchResultStore((s) => s.result);
  const context = useWatchResultStore((s) => s.context);
  const clear = useWatchResultStore((s) => s.clear);
  const invalidateMoney = useInvalidateMoney();
  const balance = useBalance(Boolean(result));

  // The completion response is NOT the balance source of truth: always refetch from the server.
  useEffect(() => {
    void invalidateMoney();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!result || !context) return <Redirect href="/(tabs)" />;

  const goHome = () => {
    clear();
    router.replace('/(tabs)');
  };
  const report = () => router.push({ pathname: '/report-ad', params: { adId: context.adId } });

  const reasonKey = result.reasonCode ? `ad.result.reasons.${result.reasonCode}` : 'ad.result.reasons.default';
  const reason = t(reasonKey, { defaultValue: t('ad.result.reasons.default') });

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      testID={`ad-result-${result.status}`}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button title={t('ad.result.watchAnother')} onPress={goHome} size="lg" icon="play" testID="result-home" />
          <Button title={t('ad.result.reportAd')} onPress={report} variant="ghost" icon="flag" size="sm" />
        </View>
      }
    >
      <View style={styles.center}>
        {result.status === CompletionStatus.valid ? (
          <>
            <CoinEarnedAnimation
              coins={result.coinReward}
              etbLabel={formatCoinsAsEtb(result.coinReward, balance.data?.coinsPerEtb ?? 100, t, language)}
            />
            <Animated.View entering={FadeInDown.delay(500)} style={[styles.center, { marginTop: spacing.xl }]}>
              <Text variant="h1" weight="bold" align="center" accessibilityRole="header">
                {t('ad.result.validTitle')}
              </Text>
              <Text variant="body" tone="secondary" align="center" style={{ marginTop: spacing.sm }}>
                {t('ad.result.validBody')}
              </Text>
            </Animated.View>
          </>
        ) : (
          <>
            <Illustration name={result.status === CompletionStatus.flagged ? 'review' : 'error'} size={170} />
            <Text variant="h1" weight="bold" align="center" style={{ marginTop: spacing.xl }} accessibilityRole="header">
              {result.status === CompletionStatus.flagged ? t('ad.result.flaggedTitle') : t('ad.result.rejectedTitle')}
            </Text>
            <Text variant="body" tone="secondary" align="center" style={{ marginTop: spacing.sm }}>
              {result.status === CompletionStatus.flagged ? t('ad.result.flaggedBody') : t('ad.result.rejectedBody')}
            </Text>
            {result.status === CompletionStatus.rejected ? (
              <Card tone="muted" style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} padding={spacing.md} testID="result-reason">
                <Text variant="bodySmall" weight="medium">
                  {reason}
                </Text>
              </Card>
            ) : null}
          </>
        )}

        {result.replayed ? (
          <Badge label={t('ad.result.replayed')} tone="info" icon="info" style={{ marginTop: spacing.lg }} size="md" />
        ) : null}

        <Card style={{ marginTop: spacing.xxl, alignSelf: 'stretch' }} testID="result-balance">
          <Text variant="label" tone="muted" weight="medium">
            {t('ad.result.newBalance')}
          </Text>
          {balance.data ? (
            <View style={styles.balanceRow}>
              <Text variant="h2" weight="bold">
                {t('money.coins', { count: balance.data.coinBalance })}
              </Text>
              <Text variant="body" tone="secondary">
                {formatEtb(balance.data.etbEquivalent, t, language)}
              </Text>
            </View>
          ) : (
            <Skeleton height={30} width={180} style={{ marginTop: 6 }} />
          )}
          <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
            {t('money.rate', { coins: formatCoins(balance.data?.coinsPerEtb ?? 100, language) })}
          </Text>
          <Text variant="caption" tone="muted">
            {context.adTitle}
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingTop: 24 },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 4, flexWrap: 'wrap' },
});
