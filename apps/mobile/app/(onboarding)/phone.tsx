import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { isApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useCountdown } from '@/components/ui/useCountdown';
import { BRAND_NAME } from '@/config';
import { toE164 } from '@/features/auth/phone';
import { normalizeReferralCode, referralCodeLooksValid } from '@/features/referrals/referrals';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const [local, setLocal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  // F6: a 429 OTP_RATE_LIMITED locks the button with a live countdown instead of a static message.
  const lock = useCountdown(0);

  const phone = toE164(local);
  const referralOk = referralCode.length === 0 || referralCodeLooksValid(referralCode);

  const submit = async () => {
    if (lock.active) return;
    if (!phone) {
      setError(t('onboarding.phone.invalid'));
      return;
    }
    if (!referralOk) {
      setError(t('onboarding.phone.referralInvalidFormat'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await authApi.requestOtp({ phoneNumber: phone });
      router.push({
        pathname: '/(onboarding)/otp',
        params: {
          phone: result.phoneNumber,
          resendAfter: String(result.resendAfterSeconds),
          expiresIn: String(result.expiresInSeconds),
          devCode: result.devCode ?? '',
          referralCode,
        },
      });
    } catch (err) {
      if (isApiError(err) && err.statusCode === 429) {
        lock.restart(err.retryAfterSeconds ?? 60);
        setError(null);
      } else {
        setError(errorMessage(err, t));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      keyboardAvoiding
      header={{ title: t('onboarding.phone.title'), subtitle: t('onboarding.phone.subtitle'), large: true }}
      footer={
        <View style={{ gap: spacing.md }}>
          <Text variant="caption" tone="muted" align="center">
            {t('onboarding.phone.terms', { brand: BRAND_NAME })}
          </Text>
          <Button
            title={lock.active ? t('onboarding.phone.rateLimitedCta', { seconds: lock.seconds }) : t('onboarding.phone.cta')}
            onPress={submit}
            loading={submitting}
            disabled={!phone || lock.active || !referralOk}
            size="lg"
            testID="phone-submit"
          />
        </View>
      }
      testID="phone-screen"
    >
      <View style={{ gap: spacing.lg }}>
        <Input
          label={t('onboarding.phone.label')}
          placeholder={t('onboarding.phone.placeholder')}
          value={local}
          onChangeText={(value) => {
            setLocal(value);
            if (error) setError(null);
          }}
          keyboardType="phone-pad"
          inputMode="tel"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
          helperText={t('onboarding.phone.helper')}
          errorText={error}
          testID="phone-input"
          prefix={
            <View style={[styles.prefix, { borderRightColor: colors.border }]}>
              <Text variant="body" weight="semibold" tone="secondary">
                +251
              </Text>
            </View>
          }
        />

        {lock.active ? (
          <Animated.View entering={FadeIn} accessibilityLiveRegion="polite" testID="phone-rate-limited">
            <Text variant="bodySmall" tone="warning">
              {t('onboarding.phone.rateLimited', { seconds: lock.seconds })}
            </Text>
          </Animated.View>
        ) : null}

        {showReferral ? (
          <Animated.View entering={FadeIn}>
            <Input
              label={t('onboarding.phone.referralLabel')}
              placeholder={t('onboarding.phone.referralPlaceholder')}
              helperText={t('onboarding.phone.referralHelper')}
              value={referralCode}
              onChangeText={(value) => setReferralCode(normalizeReferralCode(value))}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              errorText={referralCode.length > 0 && !referralOk ? t('onboarding.phone.referralInvalidFormat') : null}
              testID="phone-referral-input"
            />
          </Animated.View>
        ) : (
          <Button
            title={t('onboarding.phone.haveReferral')}
            onPress={() => setShowReferral(true)}
            variant="ghost"
            size="sm"
            fullWidth={false}
            icon="gift"
            testID="phone-referral-toggle"
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  prefix: { paddingRight: 10, borderRightWidth: 1, marginRight: 2 },
});
