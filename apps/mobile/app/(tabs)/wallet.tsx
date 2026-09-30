import { PLATFORM_DEFAULTS } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isApiError } from '@/api/errors';
import { useBalance, useLedger } from '@/api/queries/users';
import { useWithdrawalConfig } from '@/api/queries/withdrawals';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME } from '@/config';
import { BalanceCard } from '@/features/wallet/BalanceCard';
import { groupLedgerByDay, LedgerRow, LedgerRowSkeleton } from '@/features/wallet/LedgerRow';
import { kycProjection } from '@/features/withdrawals/validation';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatCoins, formatDayHeader, formatEtb } from '@/utils/format';

export default function WalletScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const balance = useBalance();
  const ledger = useLedger();
  const config = useWithdrawalConfig();
  const entries = useMemo(() => ledger.data?.pages.flatMap((p) => p.data) ?? [], [ledger.data]);
  const sections = useMemo(() => groupLedgerByDay(entries), [entries]);
  const coinsPerEtb = balance.data?.coinsPerEtb ?? PLATFORM_DEFAULTS.COINS_PER_ETB;
  const kyc = config.data ? kycProjection(config.data, null) : null;

  const refresh = useCallback(() => {
    void Promise.all([balance.refetch(), ledger.refetch(), config.refetch()]);
  }, [balance, config, ledger]);

  const header = (
    <View style={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
      <Text variant="h1" weight="bold" accessibilityRole="header">
        {t('wallet.title')}
      </Text>
      <BalanceCard
        balance={balance.data}
        loading={balance.isPending}
        onWithdraw={() => router.push('/wallet/withdraw')}
        onHistory={() => router.push('/wallet/withdrawals')}
      />
      {kyc ? (
        <Card padding={spacing.md} testID="wallet-kyc-card">
          <View style={styles.noteRow}>
            <Icon name="shield" size={18} color={kyc.tier === 'id_verified' ? colors.success : colors.primary} />
            <View style={{ flex: 1, gap: 6 }}>
              <View style={styles.titleRow}>
                <Text variant="bodySmall" weight="semibold" style={{ flex: 1 }}>
                  {t('wallet.kyc.monthlyTitle')}
                </Text>
                <Badge
                  label={t(`kyc.tier.${kyc.tier}`)}
                  tone={kyc.tier === 'id_verified' ? 'success' : 'neutral'}
                  icon={kyc.tier === 'id_verified' ? 'circleCheck' : 'phone'}
                />
              </View>
              {kyc.tier === 'phone_only' ? (
                <>
                  <Text variant="caption" tone="secondary" testID="wallet-kyc-progress">
                    {t('wallet.kyc.monthlyProgress', { used: formatEtb(kyc.monthlyEtb, t, language), limit: formatEtb(kyc.thresholdEtb, t, language) })}
                  </Text>
                  <ProgressBar progress={kyc.progress} accessibilityLabel={t('wallet.kyc.monthlyProgress', { used: formatEtb(kyc.monthlyEtb, t, language), limit: formatEtb(kyc.thresholdEtb, t, language) })} />
                </>
              ) : (
                <Text variant="caption" tone="secondary">
                  {t('wallet.kyc.verifiedBody')}
                </Text>
              )}
              <Button
                title={kyc.tier === 'phone_only' ? t('wallet.kyc.verifyCta') : t('kyc.title')}
                onPress={() => router.push('/kyc')}
                size="sm"
                variant="ghost"
                fullWidth={false}
                icon="chevronRight"
                iconPosition="right"
                accessibilityHint={t('wallet.kyc.cardA11y')}
                testID="wallet-kyc-cta"
              />
            </View>
          </View>
        </Card>
      ) : null}
      <Card tone="muted" padding={spacing.md} testID="conversion-note">
        <View style={styles.noteRow}>
          <Icon name="info" size={18} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text variant="bodySmall" weight="semibold">
              {t('wallet.conversionTitle')}
            </Text>
            <Text variant="caption" tone="secondary" style={{ marginTop: 2 }}>
              {t('money.rateNote', { coins: formatCoins(coinsPerEtb, language), brand: BRAND_NAME })}
            </Text>
            {balance.data?.ledgerChecksum.consistent ? (
              <View style={[styles.noteRow, { marginTop: 6, gap: 4 }]}>
                <Icon name="circleCheck" size={14} color={colors.success} />
                <Text variant="caption" tone="success">
                  {t('wallet.integrityOk')}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Card>
      <Text variant="h3" weight="semibold" accessibilityRole="header">
        {t('wallet.ledgerTitle')}
      </Text>
    </View>
  );

  const empty = () => {
    if (ledger.isPending) {
      return (
        <View>
          <LedgerRowSkeleton />
          <LedgerRowSkeleton />
          <LedgerRowSkeleton />
        </View>
      );
    }
    if (ledger.isError) {
      const network = isApiError(ledger.error) && ledger.error.isNetworkError;
      return (
        <EmptyState
          illustration={network ? 'offline' : 'error'}
          title={network ? t('common.offline') : t('common.somethingWrong')}
          body={errorMessage(ledger.error, t)}
          action={{ title: t('common.retry'), onPress: refresh, icon: 'refresh' }}
          compact
        />
      );
    }
    return <EmptyState illustration="wallet" title={t('wallet.emptyTitle')} body={t('wallet.emptyBody')} compact testID="ledger-empty" />;
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]} testID="wallet-screen">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <LedgerRow entry={item} />}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
            <Text variant="label" weight="semibold" tone="muted">
              {formatDayHeader(section.key, t, language)}
            </Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={ledger.isFetchingNextPage ? <LedgerRowSkeleton /> : <View style={{ height: spacing.xxl }} />}
        onEndReached={() => {
          if (ledger.hasNextPage && !ledger.isFetchingNextPage) void ledger.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={ledger.isRefetching && !ledger.isFetchingNextPage} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxxl }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        windowSize={9}
        style={{ borderRadius: radii.lg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHeader: { paddingTop: 16, paddingBottom: 6 },
});
