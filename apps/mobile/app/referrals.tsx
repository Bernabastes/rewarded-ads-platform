import type { ReferralItem } from '@rap/shared';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useReferrals } from '@/api/queries/users';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { BRAND_NAME } from '@/config';
import { REFERRAL_STATUS_TONE, shareTextFor } from '@/features/referrals/referrals';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';
import { errorMessage } from '@/utils/errorMessage';
import { formatCoins, formatDate } from '@/utils/format';

/** Profile → Invite friends: my code, share / copy, how the bonus works and the status of every invite. */
export default function ReferralsScreen() {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, spacing, radii, isDark } = useTheme();
  const query = useReferrals();
  const data = query.data;

  const copyCode = async () => {
    if (!data) return;
    await Clipboard.setStringAsync(data.code);
    toast.success(t('referrals.copied'));
  };

  const share = async () => {
    if (!data) return;
    const message = shareTextFor(data, language);
    try {
      await Share.share({ message, url: data.shareUrl, title: t('referrals.shareTitle', { brand: BRAND_NAME }) });
    } catch {
      // No native share sheet (desktop web): copy the text instead.
      await Clipboard.setStringAsync(message);
      toast.info(t('referrals.copiedShareText'));
    }
  };

  return (
    <Screen header={{ title: t('referrals.title') }} onRefresh={() => void query.refetch()} refreshing={query.isRefetching} testID="referrals-screen">
      {query.isPending ? (
        <SkeletonGroup>
          <Skeleton height={180} radius={16} />
          <Skeleton height={120} radius={16} />
          <Skeleton height={80} radius={16} />
        </SkeletonGroup>
      ) : query.isError || !data ? (
        <EmptyState illustration="error" title={t('common.somethingWrong')} body={errorMessage(query.error, t)} action={{ title: t('common.retry'), onPress: () => void query.refetch(), icon: 'refresh' }} />
      ) : (
        <Animated.View entering={FadeInDown.duration(300)} style={{ gap: spacing.lg }}>
          <Card tone="primary" elevation="raised" style={{ backgroundColor: isDark ? palette.forest[800] : palette.forest[600] }} testID="referral-code-card">
            <Text variant="label" weight="medium" style={{ color: 'rgba(255,255,255,0.8)' }}>
              {t('referrals.yourCode')}
            </Text>
            <Text variant="display" weight="bold" style={[styles.code, { color: palette.white }]} accessibilityLabel={t('referrals.codeA11y', { code: data.code.split('').join(' ') })} testID="referral-code">
              {data.code}
            </Text>
            <Text variant="bodySmall" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {t('referrals.codeBody', { coins: formatCoins(data.bonusCoins.referrer, language), friendCoins: formatCoins(data.bonusCoins.referee, language) })}
            </Text>
            <View style={[styles.actions, { marginTop: spacing.lg }]}>
              <Button title={t('referrals.share')} onPress={() => void share()} variant="accent" icon="send" fullWidth={false} style={{ flex: 1 }} testID="referral-share" />
              <Button title={t('referrals.copy')} onPress={() => void copyCode()} variant="secondary" icon="clipboard" fullWidth={false} style={{ flex: 1 }} testID="referral-copy" />
            </View>
          </Card>

          <Card>
            <Text variant="h3" weight="semibold" accessibilityRole="header">
              {t('referrals.howTitle')}
            </Text>
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {(['step1', 'step2', 'step3'] as const).map((key, index) => (
                <View key={key} style={styles.stepRow}>
                  <View style={[styles.stepNumber, { backgroundColor: colors.primarySoft, borderRadius: radii.full }]}>
                    <Text variant="caption" weight="bold" tone="primary">
                      {index + 1}
                    </Text>
                  </View>
                  <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                    {t(`referrals.how.${key}`, {
                      brand: BRAND_NAME,
                      coins: formatCoins(data.bonusCoins.referrer, language),
                      friendCoins: formatCoins(data.bonusCoins.referee, language),
                      maxPerDay: data.maxPerDay,
                    })}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <View style={styles.totals} testID="referral-totals">
            <TotalTile label={t('referrals.totals.invited')} value={String(data.totals.invited)} />
            <TotalTile label={t('referrals.totals.pending')} value={String(data.totals.pending)} />
            <TotalTile label={t('referrals.totals.paid')} value={String(data.totals.paid)} />
            <TotalTile label={t('referrals.totals.coinsEarned')} value={formatCoins(data.totals.coinsEarned, language)} accent />
          </View>

          {data.referredBy ? (
            <Card tone="muted" padding={spacing.md} testID="referral-referred-by">
              <View style={styles.rowBetween}>
                <Text variant="bodySmall" weight="medium" style={{ flex: 1 }}>
                  {t('referrals.referredBy', { coins: formatCoins(data.referredBy.bonusCoins, language) })}
                </Text>
                <Badge label={t(`referrals.status.${data.referredBy.status}`)} tone={REFERRAL_STATUS_TONE[data.referredBy.status]} />
              </View>
            </Card>
          ) : null}

          <Text variant="h3" weight="semibold" accessibilityRole="header">
            {t('referrals.listTitle')}
          </Text>
          {data.referrals.length === 0 ? (
            <EmptyState illustration="offers" title={t('referrals.emptyTitle')} body={t('referrals.emptyBody')} compact testID="referral-empty" />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {data.referrals.map((item) => (
                <ReferralRow key={item.id} item={item} />
              ))}
            </View>
          )}
        </Animated.View>
      )}
    </Screen>
  );
}

function TotalTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const { colors, radii, spacing } = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: accent ? colors.accentSoft : colors.surface, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md }]}>
      <Text variant="h3" weight="bold" style={accent ? { color: colors.accentSoftText } : undefined}>
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

function ReferralRow({ item }: { item: ReferralItem }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const detail = (() => {
    switch (item.status) {
      case 'paid':
        return t('referrals.detail.paid', { coins: formatCoins(item.referrerBonusCoins, language) });
      case 'qualified':
        return t('referrals.detail.qualified');
      case 'rejected':
        return t(`referrals.rejection.${item.rejectionReason ?? 'default'}`, { defaultValue: t('referrals.rejection.default') });
      default:
        return t('referrals.detail.pending');
    }
  })();
  return (
    <Card padding={spacing.md} testID={`referral-${item.id}`}>
      <View style={styles.rowBetween}>
        <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted, borderRadius: radii.full }]}>
          <Icon name="user" size={18} color={colors.textSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" weight="semibold" numberOfLines={1}>
            {item.referee.displayName}
          </Text>
          <Text variant="caption" tone="muted">
            {t('referrals.joined', { date: formatDate(item.referee.joinedAt, language) })}
          </Text>
        </View>
        <Badge label={t(`referrals.status.${item.status}`)} tone={REFERRAL_STATUS_TONE[item.status]} />
      </View>
      <Text variant="bodySmall" tone={item.status === 'paid' ? 'success' : 'secondary'} style={{ marginTop: spacing.sm }}>
        {detail}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  code: { letterSpacing: 6, marginTop: 4, marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNumber: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  totals: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexGrow: 1, flexBasis: '45%', borderWidth: 1, gap: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
