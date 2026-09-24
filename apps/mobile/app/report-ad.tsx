import type { AdReportReason } from '@rap/shared';
import { AdReportReason as Reasons, ErrorCode } from '@rap/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { isApiError } from '@/api/errors';
import { useReportAd } from '@/api/queries/users';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME } from '@/config';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

const REASONS = Object.values(Reasons) as AdReportReason[];

/** Report a bad ad. Opened from the player/result (with `adId`) or from Profile (pick a recently watched ad). */
export default function ReportAdScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radii, spacing } = useTheme();
  const params = useLocalSearchParams<{ adId?: string }>();
  const recentAds = usePrefsStore((s) => s.recentAds);
  const report = useReportAd();

  const [adId, setAdId] = useState<string | null>(params.adId ?? null);
  const [reason, setReason] = useState<AdReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = () => {
    if (!adId || !reason) return;
    setError(null);
    report.mutate(
      { adId, reason, details: details.trim() || undefined },
      {
        onSuccess: () => setDone(true),
        onError: (err) => {
          if (isApiError(err) && err.code === ErrorCode.CONFLICT) setError(t('report.alreadyReported'));
          else setError(errorMessage(err, t));
        },
      },
    );
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (done) {
    return (
      <Screen header={{ hideBack: true }} edges={['top', 'left', 'right', 'bottom']} testID="report-done" footer={<Button title={t('common.done')} onPress={close} size="lg" />}>
        <EmptyState illustration="success" title={t('report.submittedTitle')} body={t('report.submittedBody', { brand: BRAND_NAME })} />
      </Screen>
    );
  }

  return (
    <Screen
      header={{ title: t('report.title'), onBack: close }}
      keyboardAvoiding
      testID="report-screen"
      footer={<Button title={t('report.submit')} onPress={submit} disabled={!adId || !reason} loading={report.isPending} size="lg" icon="flag" testID="report-submit" />}
    >
      <View style={{ gap: spacing.xl }}>
        <Text variant="body" tone="secondary">
          {t('report.subtitle')}
        </Text>

        {!params.adId ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="label" weight="semibold" tone="secondary">
              {t('report.pickAd')}
            </Text>
            {recentAds.length === 0 ? (
              <Text variant="bodySmall" tone="muted">
                {t('report.noRecentAds')}
              </Text>
            ) : (
              recentAds.map((ad) => {
                const selected = ad.id === adId;
                return (
                  <Tappable
                    key={ad.id}
                    onPress={() => setAdId(ad.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    style={[styles.option, { borderRadius: radii.md, backgroundColor: selected ? colors.primarySoft : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="body" weight="medium" numberOfLines={1}>
                        {ad.title}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {ad.advertiserName}
                      </Text>
                    </View>
                    {selected ? <Icon name="check" color={colors.primary} /> : null}
                  </Tappable>
                );
              })
            )}
          </View>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Text variant="label" weight="semibold" tone="secondary">
            {t('report.reason')}
          </Text>
          {REASONS.map((value) => {
            const selected = value === reason;
            return (
              <Tappable
                key={value}
                onPress={() => setReason(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected, checked: selected }}
                testID={`report-reason-${value}`}
                style={[styles.option, { borderRadius: radii.md, backgroundColor: selected ? colors.primarySoft : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
              >
                <Text variant="body" weight={selected ? 'semibold' : 'regular'} style={{ flex: 1 }}>
                  {t(`report.reasons.${value}`)}
                </Text>
                {selected ? <Icon name="check" color={colors.primary} /> : null}
              </Tappable>
            );
          })}
        </View>

        <Input label={`${t('report.details')} (${t('common.optional')})`} placeholder={t('report.detailsPlaceholder')} value={details} onChangeText={setDetails} multiline numberOfLines={4} maxLength={1000} style={{ minHeight: 100, textAlignVertical: 'top' }} testID="report-details" />

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
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1.5, minHeight: 52 },
});
