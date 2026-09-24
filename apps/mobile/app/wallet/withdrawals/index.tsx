import type { WithdrawalItem } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWithdrawals } from '@/api/queries/withdrawals';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { WithdrawalStatusBadge } from '@/features/withdrawals/WithdrawalTimeline';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatDateTime, formatEtb } from '@/utils/format';

export default function WithdrawalsHistoryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const query = useWithdrawals();
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const open = useCallback((item: WithdrawalItem) => router.push({ pathname: '/wallet/withdrawals/[id]', params: { id: item.id } }), [router]);

  const renderItem = ({ item }: { item: WithdrawalItem }) => (
    <Card onPress={() => open(item)} accessibilityLabel={`${formatEtb(item.amountEtb, t, language)} ${t(`withdraw.status.${item.status}`)}`} testID={`withdrawal-row-${item.id}`}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text variant="h3" weight="bold">
            {formatEtb(item.amountEtb, t, language)}
          </Text>
          <Text variant="caption" tone="muted">
            {item.payoutMethod} · {item.payoutDestination}
          </Text>
          <Text variant="caption" tone="muted">
            {formatDateTime(item.requestedAt, language)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <WithdrawalStatusBadge status={item.status} />
          <Icon name="chevronRight" size={18} color={colors.textMuted} />
        </View>
      </View>
    </Card>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]} testID="withdrawals-history">
      <ScreenHeader title={t('withdraw.historyTitle')} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        ListEmptyComponent={
          query.isPending ? (
            <View style={{ gap: spacing.md }}>
              <Skeleton height={92} radius={16} />
              <Skeleton height={92} radius={16} />
            </View>
          ) : query.isError ? (
            <EmptyState illustration="error" title={t('common.somethingWrong')} body={errorMessage(query.error, t)} action={{ title: t('common.retry'), onPress: () => void query.refetch(), icon: 'refresh' }} compact />
          ) : (
            <EmptyState
              illustration="wallet"
              title={t('withdraw.historyEmpty')}
              body={t('withdraw.historyEmptyBody')}
              action={{ title: t('withdraw.newWithdrawal'), onPress: () => router.push('/wallet/withdraw'), icon: 'arrowUpRight' }}
              compact
            />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? <Skeleton height={92} radius={16} /> : items.length > 0 ? <Button title={t('withdraw.newWithdrawal')} variant="secondary" onPress={() => router.push('/wallet/withdraw')} style={{ marginTop: spacing.md }} /> : null
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
