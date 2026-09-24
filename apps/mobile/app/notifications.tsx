import type { NotificationItem, NotificationType } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMarkNotificationRead, useNotifications } from '@/api/queries/users';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useLanguage } from '@/i18n/useLanguage';
import { resolveNotificationTarget } from '@/notifications/push';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatRelative } from '@/utils/format';

const TYPE_ICONS: Record<NotificationType, IconName> = {
  reward_confirmed: 'star',
  reward_flagged: 'eye',
  withdrawal_status: 'wallet',
  new_offer: 'gift',
  account_status: 'shield',
  system: 'info',
};

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const query = useNotifications();
  const markRead = useMarkNotificationRead();
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);

  const open = useCallback(
    (item: NotificationItem) => {
      if (!item.readAt) markRead.mutate(item.id);
      const target = resolveNotificationTarget(item.type, item.data);
      router.push({ pathname: target.pathname, params: target.params } as never);
    },
    [markRead, router],
  );

  const renderItem = ({ item }: { item: NotificationItem }) => {
    const unread = !item.readAt;
    return (
      <Card onPress={() => open(item)} accessibilityLabel={`${unread ? t('notifications.unread') + '. ' : ''}${item.title}. ${item.body}`} testID={`notification-${item.id}`} style={unread ? { borderColor: colors.primary } : undefined}>
        <View style={styles.row}>
          <View style={[styles.icon, { borderRadius: radii.md, backgroundColor: unread ? colors.primarySoft : colors.surfaceMuted }]}>
            <Icon name={TYPE_ICONS[item.type] ?? 'bell'} size={18} color={unread ? colors.primary : colors.textSecondary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.titleRow}>
              <Text variant="body" weight={unread ? 'bold' : 'medium'} style={{ flex: 1 }} numberOfLines={2}>
                {item.title}
              </Text>
              {unread ? <Badge label={t('notifications.unread')} tone="accent" /> : null}
            </View>
            <Text variant="bodySmall" tone="secondary" numberOfLines={3}>
              {item.body}
            </Text>
            <Text variant="caption" tone="muted">
              {formatRelative(item.createdAt, t, language)}
            </Text>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]} testID="notifications-screen">
      <ScreenHeader title={t('notifications.title')} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }}
        ListEmptyComponent={
          query.isPending ? (
            <View style={{ gap: spacing.md }}>
              <Skeleton height={96} radius={16} />
              <Skeleton height={96} radius={16} />
              <Skeleton height={96} radius={16} />
            </View>
          ) : query.isError ? (
            <EmptyState illustration="error" title={t('common.somethingWrong')} body={errorMessage(query.error, t)} action={{ title: t('common.retry'), onPress: () => void query.refetch(), icon: 'refresh' }} compact />
          ) : (
            <EmptyState illustration="notifications" title={t('notifications.emptyTitle')} body={t('notifications.emptyBody')} compact testID="notifications-empty" />
          )
        }
        ListFooterComponent={query.isFetchingNextPage ? <Skeleton height={96} radius={16} /> : null}
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
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
