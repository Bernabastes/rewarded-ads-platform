import type { OfferCompletionResult } from '@rap/shared';
import { OfferCompletionStatus } from '@rap/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { offersApi } from '@/api/endpoints/offers';
import { useAppInstallOffer } from '@/api/queries/ads';
import { invalidateMoney, queryKeys } from '@/api/queryClient';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CoinMark } from '@/components/ui/CoinMark';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { getDeviceIdentity } from '@/device/fingerprint';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';
import { formatEtb } from '@/utils/format';

export default function AppInstallScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const { colors, spacing, radii } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const offer = useAppInstallOffer(id);

  const [opened, setOpened] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OfferCompletionResult | null>(null);

  const openStore = async () => {
    if (!offer.data) return;
    setOpened(true);
    try {
      await Linking.openURL(offer.data.storeUrl);
    } catch {
      setError(t('errors.generic'));
    }
  };

  const confirmInstalled = async () => {
    if (!offer.data) return;
    setSubmitting(true);
    setError(null);
    try {
      const identity = await getDeviceIdentity();
      const res = await offersApi.completeAppInstall(offer.data.id, { deviceFingerprint: identity.deviceFingerprint });
      setResult(res);
      void invalidateMoney(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['offers'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.offerCompletions });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (offer.isPending) {
    return (
      <Screen header={{ title: t('offers.types.app_install') }}>
        <SkeletonGroup>
          <Skeleton height={28} width="70%" />
          <Skeleton height={80} radius={16} />
          <Skeleton height={160} radius={16} />
        </SkeletonGroup>
      </Screen>
    );
  }
  if (offer.isError || !offer.data) {
    return (
      <Screen header={{ title: t('offers.types.app_install') }}>
        <EmptyState illustration="error" title={t('common.somethingWrong')} body={errorMessage(offer.error, t)} action={{ title: t('common.retry'), onPress: () => void offer.refetch(), icon: 'refresh' }} />
      </Screen>
    );
  }
  const data = offer.data;
  const pending = result?.status === OfferCompletionStatus.pending_verification || data.completionStatus === OfferCompletionStatus.pending_verification;
  const done = data.completionStatus !== null && data.completionStatus !== OfferCompletionStatus.pending_verification;

  if (result || pending) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']} header={{ hideBack: true }} testID="app-install-pending" footer={<Button title={t('common.done')} onPress={() => router.replace('/(tabs)/offers')} size="lg" />}>
        <EmptyState
          illustration="review"
          title={t('offers.appInstall.pendingTitle')}
          body={result?.message && result.status !== OfferCompletionStatus.pending_verification ? result.message : t('offers.appInstall.pendingBody')}
        />
        <Badge label={t(`offers.status.${result?.status ?? 'pending_verification'}`)} tone="info" size="md" style={{ alignSelf: 'center' }} />
      </Screen>
    );
  }

  const steps = [
    { icon: 'external' as const, text: t('offers.appInstall.step1', { app: data.appName }) },
    { icon: 'play' as const, text: t('offers.appInstall.step2') },
    { icon: 'circleCheck' as const, text: t('offers.appInstall.step3') },
  ];

  return (
    <Screen
      header={{ title: t('offers.types.app_install') }}
      testID="app-install-screen"
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button title={t('offers.appInstall.openStore')} onPress={() => void openStore()} icon="external" variant={opened ? 'secondary' : 'primary'} size="lg" disabled={done} accessibilityHint={t('a11y.openLink')} testID="app-install-open" />
          <Button
            title={submitting ? t('offers.appInstall.submitting') : t('offers.appInstall.installed')}
            onPress={() => void confirmInstalled()}
            loading={submitting}
            variant={opened ? 'primary' : 'outline'}
            disabled={done}
            testID="app-install-confirm"
          />
        </View>
      }
    >
      <View style={{ gap: spacing.lg }}>
        <View style={styles.titleRow}>
          <View style={[styles.appIcon, { borderRadius: radii.lg, backgroundColor: colors.accentSoft }]}>
            <Icon name="download" size={28} color={colors.accentSoftText} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="muted" weight="medium">
              {data.advertiserName}
            </Text>
            <Text variant="h1" weight="bold" accessibilityRole="header">
              {data.title}
            </Text>
          </View>
        </View>
        {data.description ? (
          <Text variant="body" tone="secondary">
            {data.description}
          </Text>
        ) : null}
        <Card tone="primary" style={{ backgroundColor: colors.primarySoft }}>
          <View style={styles.inline}>
            <CoinMark size={24} />
            <Text variant="h2" weight="bold" tone="primary">
              {t('money.coins', { count: data.rewardCoins })}
            </Text>
            <Text variant="body" tone="secondary">
              {formatEtb(data.rewardEtb, t, language)}
            </Text>
          </View>
          <Text variant="caption" tone="secondary" style={{ marginTop: 4 }}>
            {t('offers.estimated', { minutes: data.estimatedMinutes })}
          </Text>
        </Card>
        <Card>
          <Text variant="h3" weight="semibold" style={{ marginBottom: spacing.md }}>
            {t('offers.appInstall.howItWorks')}
          </Text>
          <View style={{ gap: spacing.md }}>
            {steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={[styles.stepNum, { backgroundColor: colors.primary, borderRadius: radii.full }]}>
                  <Text variant="caption" weight="bold" tone="onPrimary">
                    {String(i + 1)}
                  </Text>
                </View>
                <Text variant="body" style={{ flex: 1 }}>
                  {step.text}
                </Text>
                <Icon name={step.icon} size={18} color={colors.textMuted} />
              </View>
            ))}
          </View>
        </Card>
        {data.instructions ? (
          <Card tone="muted">
            <Text variant="label" weight="semibold" tone="secondary">
              {t('offers.appInstall.instructions')}
            </Text>
            <Text variant="bodySmall" style={{ marginTop: 4 }}>
              {data.instructions}
            </Text>
          </Card>
        ) : null}
        {done && data.completionStatus ? <Badge label={t(`offers.status.${data.completionStatus}`)} tone="neutral" size="md" /> : null}
        {error ? (
          <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  appIcon: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNum: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
});
