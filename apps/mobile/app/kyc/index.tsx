import { KycStatus } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useKyc } from '@/api/queries/users';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME } from '@/config';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatDateTime, formatEtb } from '@/utils/format';

const STATUS_TONE: Record<KycStatus, BadgeTone> = { pending: 'info', approved: 'success', rejected: 'danger' };
const STATUS_ICON: Record<KycStatus, IconName> = { pending: 'hourglass', approved: 'circleCheck', rejected: 'circleX' };

/** Profile → Verify identity: tier, monthly allowance and the latest submission's status. */
export default function KycStatusScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const query = useKyc();
  const data = query.data;

  if (query.isPending) {
    return (
      <Screen header={{ title: t('kyc.title') }} testID="kyc-loading">
        <SkeletonGroup>
          <Skeleton height={120} radius={16} />
          <Skeleton height={160} radius={16} />
        </SkeletonGroup>
      </Screen>
    );
  }
  if (query.isError || !data) {
    return (
      <Screen header={{ title: t('kyc.title') }}>
        <EmptyState illustration="error" title={t('common.somethingWrong')} body={errorMessage(query.error, t)} action={{ title: t('common.retry'), onPress: () => void query.refetch(), icon: 'refresh' }} />
      </Screen>
    );
  }

  const verified = data.kycTier === 'id_verified';
  const submission = data.submission;
  const progress = data.requiredAboveMonthlyEtb > 0 ? Math.min(1, data.monthlyPayoutTotalEtb / data.requiredAboveMonthlyEtb) : 0;

  return (
    <Screen
      header={{ title: t('kyc.title') }}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID={`kyc-status-${submission?.status ?? 'none'}`}
      footer={
        data.canSubmit ? (
          <Button
            title={submission?.status === KycStatus.rejected ? t('kyc.resubmit') : t('kyc.start')}
            onPress={() => router.push('/kyc/submit')}
            size="lg"
            icon="shield"
            testID="kyc-start"
          />
        ) : undefined
      }
    >
      <Animated.View entering={FadeInDown.duration(300)} style={{ gap: spacing.lg }}>
        <Card tone={verified ? 'primary' : 'surface'} elevation="raised">
          <View style={styles.rowBetween}>
            <View style={[styles.iconWrap, { backgroundColor: verified ? 'rgba(255,255,255,0.18)' : colors.primarySoft, borderRadius: radii.full }]}>
              <Icon name="shield" size={24} color={verified ? colors.textOnPrimary : colors.primary} />
            </View>
            <Badge label={t(`kyc.tier.${data.kycTier}`)} tone={verified ? 'success' : 'neutral'} icon={verified ? 'circleCheck' : 'phone'} size="md" />
          </View>
          <Text variant="h2" weight="bold" style={{ marginTop: spacing.md }} tone={verified ? 'onPrimary' : 'default'}>
            {verified ? t('kyc.verifiedTitle') : t('kyc.phoneOnlyTitle')}
          </Text>
          <Text variant="bodySmall" style={{ marginTop: 4, color: verified ? 'rgba(255,255,255,0.85)' : colors.textSecondary }}>
            {verified
              ? t('kyc.verifiedBody')
              : t('kyc.phoneOnlyBody', { limit: formatEtb(data.requiredAboveMonthlyEtb, t, language) })}
          </Text>
          {!verified ? (
            <View style={{ marginTop: spacing.md, gap: 6 }} testID="kyc-monthly">
              <Text variant="caption" tone="secondary">
                {t('wallet.kyc.monthlyProgress', {
                  used: formatEtb(data.monthlyPayoutTotalEtb, t, language),
                  limit: formatEtb(data.requiredAboveMonthlyEtb, t, language),
                })}
              </Text>
              <ProgressBar progress={progress} />
            </View>
          ) : null}
        </Card>

        {submission ? (
          <Card testID="kyc-submission">
            <View style={styles.rowBetween}>
              <Text variant="h3" weight="semibold" accessibilityRole="header">
                {t('kyc.submissionTitle')}
              </Text>
              <Badge label={t(`kyc.status.${submission.status}`)} tone={STATUS_TONE[submission.status]} icon={STATUS_ICON[submission.status]} />
            </View>
            <Text variant="bodySmall" tone="secondary" style={{ marginTop: spacing.sm }}>
              {t(`kyc.statusBody.${submission.status}`, { brand: BRAND_NAME })}
            </Text>
            {submission.status === KycStatus.rejected && submission.reason ? (
              <Card tone="muted" padding={spacing.md} style={{ marginTop: spacing.md }} testID="kyc-rejection-reason">
                <Text variant="label" weight="semibold" tone="secondary">
                  {t('kyc.rejectionReason')}
                </Text>
                <Text variant="bodySmall" style={{ marginTop: 2 }}>
                  {submission.reason}
                </Text>
              </Card>
            ) : null}
            <View style={{ marginTop: spacing.md, gap: 4 }}>
              <Text variant="caption" tone="muted">
                {t(`kyc.idTypes.${submission.idType}`)}
                {' · '}
                {t('kyc.idEndingIn', { last4: submission.idNumberLast4 })}
              </Text>
              <Text variant="caption" tone="muted">
                {t('kyc.submittedOn', { date: formatDateTime(submission.createdAt, language) })}
                {submission.reviewedAt ? ` · ${t('kyc.reviewedOn', { date: formatDateTime(submission.reviewedAt, language) })}` : ''}
              </Text>
            </View>
          </Card>
        ) : null}

        {!verified && (!submission || submission.status === KycStatus.rejected) ? (
          <Card>
            <Text variant="h3" weight="semibold" accessibilityRole="header">
              {t('kyc.needTitle')}
            </Text>
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {(['idDoc', 'selfie', 'time'] as const).map((key) => (
                <View key={key} style={styles.bullet}>
                  <Icon name={key === 'idDoc' ? 'clipboard' : key === 'selfie' ? 'user' : 'clock'} size={18} color={colors.primary} />
                  <Text variant="bodySmall" tone="secondary" style={{ flex: 1 }}>
                    {t(`kyc.need.${key}`)}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <Text variant="caption" tone="muted">
          {t('kyc.privacyNote')}
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  iconWrap: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
});
