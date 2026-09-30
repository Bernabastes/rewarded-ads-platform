import { WithdrawalStatus } from '@rap/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { isWithdrawalActive, useWithdrawal } from '@/api/queries/withdrawals';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME } from '@/config';
import { WithdrawalStatusBadge, WithdrawalTimeline } from '@/features/withdrawals/WithdrawalTimeline';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatDateTime, formatEtb } from '@/utils/format';

export default function WithdrawalDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { colors, spacing } = useTheme();
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const query = useWithdrawal(id);
  const item = query.data;

  const goBack = () => {
    // After creating a request, "back" should land on the wallet rather than the form.
    if (created === '1') {
      router.replace('/(tabs)/wallet');
      return true;
    }
    return false;
  };

  if (query.isPending) {
    return (
      <Screen header={{ title: t('withdraw.title'), onBack: goBack }}>
        <SkeletonGroup>
          <Skeleton height={120} radius={16} />
          <Skeleton height={20} width="50%" />
          <Skeleton height={200} radius={16} />
        </SkeletonGroup>
      </Screen>
    );
  }
  if (query.isError || !item) {
    return (
      <Screen header={{ title: t('withdraw.title'), onBack: goBack }}>
        <EmptyState illustration="error" title={t('common.somethingWrong')} body={errorMessage(query.error, t)} action={{ title: t('common.retry'), onPress: () => void query.refetch(), icon: 'refresh' }} />
      </Screen>
    );
  }

  const provider = item.providerName ?? t('withdraw.providerFallback');
  const active = isWithdrawalActive(item);
  const refunded = item.status === WithdrawalStatus.failed || item.status === WithdrawalStatus.rejected;

  return (
    <Screen
      header={{ title: t('withdraw.title'), onBack: goBack }}
      testID={`withdrawal-detail-${item.status}`}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button title={t('common.goHome')} onPress={() => router.replace('/(tabs)/wallet')} variant={refunded ? 'primary' : 'secondary'} />
          {refunded ? <Button title={t('withdraw.newWithdrawal')} onPress={() => router.replace('/wallet/withdraw')} variant="ghost" /> : null}
        </View>
      }
    >
      <Animated.View entering={FadeInDown.duration(300)} style={{ gap: spacing.lg }}>
        <Card elevation="raised">
          <View style={styles.rowBetween}>
            <View>
              <Text variant="label" tone="muted" weight="medium">
                {t('withdraw.summaryAmount')}
              </Text>
              <Text variant="display" weight="bold" testID="withdrawal-amount">
                {formatEtb(item.amountEtb, t, language)}
              </Text>
              <Text variant="bodySmall" tone="secondary">
                {t('money.coins', { count: item.coinAmount })}
                {' · '}
                {item.payoutMethod}
                {' · '}
                {item.payoutDestination}
              </Text>
              {item.destinationAccountName ? (
                <View style={[styles.pollRow, { marginTop: 4 }]} testID="withdrawal-account-name">
                  <Icon name="circleCheck" size={14} color={colors.success} />
                  <Text variant="bodySmall" weight="medium">
                    {t('withdraw.verify.paidTo', { name: item.destinationAccountName })}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={[styles.rowBetween, { marginTop: spacing.md }]}>
            <WithdrawalStatusBadge status={item.status} />
            {active ? (
              <View style={styles.pollRow}>
                <Icon name="refresh" size={14} color={colors.textMuted} />
                <Text variant="caption" tone="muted">
                  {query.isFetching ? t('withdraw.refreshing') : t('withdraw.polling')}
                </Text>
              </View>
            ) : null}
          </View>
        </Card>

        <Card tone={item.status === WithdrawalStatus.flagged_for_review ? 'accent' : refunded ? 'muted' : 'surface'} testID="withdrawal-status-body">
          <Text variant="body" weight="medium">
            {t(`withdraw.statusBody.${item.status}`, { provider, brand: BRAND_NAME })}
          </Text>
          {item.status === WithdrawalStatus.flagged_for_review && item.reviewReasons.length > 0 ? (
            <View style={{ marginTop: spacing.md, gap: 4 }}>
              <Text variant="label" weight="semibold" tone="secondary">
                {t('withdraw.reviewReasons.title')}
              </Text>
              {item.reviewReasons.map((reason) => (
                <View key={reason} style={styles.reasonRow}>
                  <Icon name="circleDot" size={14} color={colors.textSecondary} />
                  <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                    {t(`withdraw.reviewReasons.${reason}`, { defaultValue: t('withdraw.reviewReasons.default') })}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {item.failureReason ? (
            <Text variant="bodySmall" tone="secondary" style={{ marginTop: spacing.sm }}>
              {t('withdraw.failureReason')}: {item.failureReason}
            </Text>
          ) : null}
        </Card>

        <Card>
          <WithdrawalTimeline item={item} />
        </Card>

        <Text variant="caption" tone="muted">
          {formatDateTime(item.requestedAt, language)}
          {item.processedAt ? ` → ${formatDateTime(item.processedAt, language)}` : ''}
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  pollRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
