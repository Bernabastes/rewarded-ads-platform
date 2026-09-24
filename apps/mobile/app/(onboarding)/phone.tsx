import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { authApi } from '@/api/endpoints/auth';
import { isApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME } from '@/config';
import { toE164 } from '@/features/auth/phone';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const [local, setLocal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const phone = toE164(local);

  const submit = async () => {
    if (!phone) {
      setError(t('onboarding.phone.invalid'));
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
        },
      });
    } catch (err) {
      if (isApiError(err) && err.statusCode === 429 && err.retryAfterSeconds) {
        setError(t('errors.rateLimited', { seconds: err.retryAfterSeconds }));
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
            title={t('onboarding.phone.cta')}
            onPress={submit}
            loading={submitting}
            disabled={!phone}
            size="lg"
            testID="phone-submit"
          />
        </View>
      }
      testID="phone-screen"
    >
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  prefix: { paddingRight: 10, borderRightWidth: 1, marginRight: 2 },
});
