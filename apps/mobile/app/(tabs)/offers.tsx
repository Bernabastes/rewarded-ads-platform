import type { OfferListItem, OfferType } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isApiError } from '@/api/errors';
import { useOffers } from '@/api/queries/ads';
import { Chip } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Text } from '@/components/ui/Text';
import { highRewardThreshold, OfferCard, OfferCardSkeleton } from '@/features/offers/OfferCard';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

type Filter = OfferType | 'all';
const FILTERS: Filter[] = ['all', 'survey', 'app_install'];

export default function OffersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const query = useOffers(filter);
  const offers = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const threshold = useMemo(() => highRewardThreshold(offers), [offers]);

  const open = useCallback(
    (offer: OfferListItem) => {
      if (offer.type === 'survey') router.push({ pathname: '/offers/survey/[id]', params: { id: offer.id } });
      else router.push({ pathname: '/offers/app-install/[id]', params: { id: offer.id } });
    },
    [router],
  );

  const header = (
    <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      <View>
        <Text variant="h1" weight="bold" accessibilityRole="header">
          {t('offers.title')}
        </Text>
        <Text variant="bodySmall" tone="secondary">
          {t('offers.subtitle')}
        </Text>
      </View>
      <View style={styles.filters} accessibilityRole="tablist">
        {FILTERS.map((f) => (
          <Chip key={f} label={t(`offers.filters.${f}`)} selected={filter === f} onPress={() => setFilter(f)} accessibilityLabel={t(`offers.filters.${f}`)} />
        ))}
      </View>
    </View>
  );

  const empty = () => {
    if (query.isPending) {
      return (
        <View style={{ gap: spacing.md }}>
          <OfferCardSkeleton />
          <OfferCardSkeleton />
          <OfferCardSkeleton />
        </View>
      );
    }
    if (query.isError) {
      const network = isApiError(query.error) && query.error.isNetworkError;
      return (
        <EmptyState
          illustration={network ? 'offline' : 'error'}
          title={network ? t('common.offline') : t('common.somethingWrong')}
          body={errorMessage(query.error, t)}
          action={{ title: t('common.retry'), onPress: () => void query.refetch(), icon: 'refresh' }}
          compact
        />
      );
    }
    return <EmptyState illustration="offers" title={t('offers.emptyTitle')} body={t('offers.emptyBody')} compact testID="offers-empty" />;
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]} testID="offers-screen">
      <FlatList
        data={offers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <OfferCard offer={item} highRewardThreshold={threshold} onPress={open} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={query.isFetchingNextPage ? <OfferCardSkeleton /> : null}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxxl, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        windowSize={7}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
