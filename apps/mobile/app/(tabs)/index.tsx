import type { AdFeedItem } from '@rap/shared';
import { ErrorCode } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isApiError } from '@/api/errors';
import { useFeed } from '@/api/queries/ads';
import { useBalance, useSummary } from '@/api/queries/users';
import { useAuthStore } from '@/auth/authStore';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { FeedCard, FeedCardSkeleton } from '@/features/feed/FeedCard';
import { feedEmptyKind } from '@/features/feed/feedState';
import { greetingKey } from '@/features/feed/greeting';
import { ReferralHomeCard } from '@/features/referrals/ReferralHomeCard';
import { BalanceCard } from '@/features/wallet/BalanceCard';
import { useInterruptedWatchSession } from '@/features/watch/useInterruptedWatchSession';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing, radii, minTouchTarget } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);

  const feed = useFeed();
  const balance = useBalance();
  const summary = useSummary();
  const interrupted = useInterruptedWatchSession();

  const ads = useMemo(() => feed.data?.pages.flatMap((p) => p.data) ?? [], [feed.data]);
  const meta = feed.data?.pages.at(-1)?.meta ?? feed.data?.pages[0]?.meta;
  const dailyLimit = meta?.dailyLimit ?? summary.data?.dailyLimit ?? 0;
  const dailyCompleted = meta?.dailyCompleted ?? summary.data?.todayCompletions ?? 0;
  const dailyRemaining = meta?.dailyRemaining ?? summary.data?.dailyRemaining ?? null;
  const unread = summary.data?.unreadNotifications ?? 0;

  const refreshing = feed.isRefetching && !feed.isFetchingNextPage;
  const refresh = useCallback(() => {
    void Promise.all([feed.refetch(), balance.refetch(), summary.refetch(), interrupted.recheck()]);
  }, [balance, feed, interrupted, summary]);

  const openAd = useCallback(
    (ad: AdFeedItem) => router.push({ pathname: '/ad/[id]', params: { id: ad.id } }),
    [router],
  );

  const firstName = user?.fullName?.trim().split(/\s+/)[0];
  const greeting = t(greetingKey(new Date().getHours()));

  const header = (
    <View style={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text variant="h2" weight="bold" accessibilityRole="header" testID="home-greeting">
            {firstName ? t('home.greetingWithName', { greeting, name: firstName }) : t('home.greetingFallback')}
          </Text>
          <Text variant="bodySmall" tone="secondary">
            {t('common.tagline')}
          </Text>
        </View>
        <Tappable
          onPress={() => router.push('/notifications')}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.notifications', { count: unread })}
          testID="home-notifications"
          style={[
            styles.bell,
            { width: minTouchTarget, height: minTouchTarget, borderRadius: radii.full, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Icon name="bell" color={colors.text} />
          {unread > 0 ? <View style={[styles.dot, { backgroundColor: colors.accent, borderColor: colors.surface }]} /> : null}
        </Tappable>
      </View>

      <BalanceCard balance={balance.data} loading={balance.isPending} compact onPress={() => router.push('/(tabs)/wallet')} />

      {interrupted.pending ? (
        <Card tone="accent" testID="interrupted-card">
          <Text variant="h3" weight="semibold">
            {t('ad.interrupted.title')}
          </Text>
          <Text variant="bodySmall" tone="secondary" style={{ marginTop: 4 }}>
            {t('ad.interrupted.resumeBody')}
          </Text>
          <View style={[styles.row, { marginTop: spacing.md, gap: spacing.sm }]}>
            <Button
              title={t('ad.interrupted.resume')}
              size="sm"
              fullWidth={false}
              style={{ flex: 1 }}
              onPress={() =>
                router.push({ pathname: '/ad/[id]', params: { id: interrupted.pending!.session.adId, resume: '1' } })
              }
            />
            <Button title={t('ad.interrupted.discard')} size="sm" variant="ghost" fullWidth={false} onPress={() => void interrupted.dismiss()} />
          </View>
        </Card>
      ) : null}

      {dailyLimit > 0 ? (
        <Card padding={spacing.md} testID="daily-progress">
          <View style={styles.row}>
            <Icon name="trendingUp" size={18} color={colors.primary} />
            <Text variant="bodySmall" weight="semibold" style={{ flex: 1, marginLeft: 8 }}>
              {t('home.todayProgress', { done: dailyCompleted, limit: dailyLimit })}
            </Text>
            {dailyRemaining !== null && dailyRemaining > 0 ? (
              <Text variant="caption" tone="muted">
                {t('home.todayRemaining', { count: dailyRemaining })}
              </Text>
            ) : null}
          </View>
          <ProgressBar
            progress={dailyLimit ? dailyCompleted / dailyLimit : 0}
            style={{ marginTop: spacing.sm }}
            accessibilityLabel={t('a11y.progress', { done: dailyCompleted, limit: dailyLimit })}
          />
        </Card>
      ) : summary.isPending ? (
        <Skeleton height={64} radius={radii.lg} />
      ) : null}

      <ReferralHomeCard onPress={() => router.push('/referrals')} />

      <Text variant="h3" weight="semibold" accessibilityRole="header">
        {t('home.adsHeading')}
      </Text>
    </View>
  );

  const renderEmpty = () => {
    if (feed.isPending) {
      return (
        <View style={{ gap: spacing.lg }}>
          <FeedCardSkeleton />
          <FeedCardSkeleton />
        </View>
      );
    }
    if (feed.isError) {
      const error = feed.error;
      const network = isApiError(error) && error.isNetworkError;
      if (isApiError(error) && error.code === ErrorCode.DAILY_LIMIT_REACHED) {
        return <EmptyState illustration="dailyDone" title={t('home.dailyDoneTitle')} body={t('home.dailyDoneBody', { limit: dailyLimit || 15 })} compact />;
      }
      return (
        <EmptyState
          illustration={network ? 'offline' : 'error'}
          title={network ? t('home.offlineTitle') : t('home.errorTitle')}
          body={network ? t('home.offlineBody') : errorMessage(error, t)}
          action={{ title: t('common.retry'), onPress: refresh, icon: 'refresh' }}
          compact
          testID="feed-error"
        />
      );
    }
    if (dailyRemaining === 0) {
      return (
        <EmptyState
          illustration="dailyDone"
          title={t('home.dailyDoneTitle')}
          body={t('home.dailyDoneBody', { limit: dailyLimit })}
          action={{ title: t('home.browseOffers'), onPress: () => router.push('/(tabs)/offers'), variant: 'secondary', icon: 'gift' }}
          compact
          testID="feed-daily-done"
        />
      );
    }
    if (feedEmptyKind(meta) === 'frequency_capped') {
      // Every remaining ad today is hidden by a campaign / advertiser frequency cap.
      return (
        <EmptyState
          illustration="dailyDone"
          title={t('home.frequencyCapTitle')}
          body={t('home.frequencyCapBody', { count: meta?.hiddenByFrequencyCap ?? 0 })}
          action={{ title: t('home.browseOffers'), onPress: () => router.push('/(tabs)/offers'), variant: 'secondary', icon: 'gift' }}
          compact
          testID="feed-frequency-capped"
        />
      );
    }
    return (
      <EmptyState
        illustration="emptyAds"
        title={t('home.noAdsTitle')}
        body={t('home.noAdsBody')}
        action={{ title: t('home.browseOffers'), onPress: () => router.push('/(tabs)/offers'), variant: 'secondary', icon: 'gift' }}
        compact
        testID="feed-empty"
      />
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]} testID="home-screen">
      <FlatList
        data={ads}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FeedCard ad={item} onPress={openAd} />}
        ListHeaderComponent={header}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={
          feed.isFetchingNextPage ? <FeedCardSkeleton /> : ads.length > 0 && !feed.hasNextPage ? <View style={{ height: spacing.lg }} /> : null
        }
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.lg }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={7}
        removeClippedSubviews
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  bell: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dot: { position: 'absolute', top: 9, right: 10, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
