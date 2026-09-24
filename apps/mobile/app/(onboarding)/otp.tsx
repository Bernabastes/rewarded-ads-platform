import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { authApi } from '@/api/endpoints/auth';
import { usersApi } from '@/api/endpoints/users';
import { isApiError } from '@/api/errors';
import { blockedReasonFromCode, useAuthStore } from '@/auth/authStore';
import { cacheUser, completeSignIn } from '@/auth/session';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { OtpInput } from '@/components/ui/OtpInput';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { IS_DEV } from '@/config';
import { getDeviceIdentity } from '@/device/fingerprint';
import { formatPhoneForDisplay } from '@/features/auth/phone';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

const OTP_LENGTH = 6;

export default function OtpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const params = useLocalSearchParams<{ phone: string; resendAfter?: string; expiresIn?: string; devCode?: string }>();
  const phone = params.phone ?? '';
  const language = usePrefsStore((s) => s.language);
  const setBlocked = useAuthStore((s) => s.setBlocked);

  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(params.devCode || '');
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(Number(params.resendAfter) || 60);
  const submittedCode = useRef<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const verify = useCallback(
    async (value: string) => {
      if (value.length !== OTP_LENGTH || verifying || submittedCode.current === value) return;
      submittedCode.current = value;
      setVerifying(true);
      setError(null);
      try {
        const identity = await getDeviceIdentity().catch(() => null);
        const result = await authApi.verifyOtp({
          phoneNumber: phone,
          code: value,
          deviceId: identity?.deviceId,
          deviceFingerprint: identity?.deviceFingerprint,
        });
        // Returning users: the language chosen locally during onboarding wins and is synced to the server.
        if (!result.isNewUser && result.user.languagePreference !== language) {
          try {
            result.user = await usersApi.update({ languagePreference: language });
            await cacheUser(result.user);
          } catch {
            /* non-blocking */
          }
        }
        await completeSignIn(result, identity?.deviceId);
        router.replace('/');
      } catch (err) {
        submittedCode.current = null;
        if (isApiError(err)) {
          const blocked = blockedReasonFromCode(err.code);
          if (blocked) {
            setBlocked(blocked);
            return;
          }
          setAttemptsLeft(err.attemptsRemaining);
        }
        setError(errorMessage(err, t));
        setCode('');
      } finally {
        setVerifying(false);
      }
    },
    [language, phone, router, setBlocked, t, verifying],
  );

  const resend = async () => {
    setResending(true);
    setError(null);
    try {
      const result = await authApi.requestOtp({ phoneNumber: phone });
      setCooldown(result.resendAfterSeconds);
      setDevCode(result.devCode ?? '');
      setCode('');
      submittedCode.current = null;
      setAttemptsLeft(null);
    } catch (err) {
      if (isApiError(err) && err.statusCode === 429 && err.retryAfterSeconds) setCooldown(err.retryAfterSeconds);
      setError(errorMessage(err, t));
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      keyboardAvoiding
      header={{
        title: t('onboarding.otp.title'),
        subtitle: t('onboarding.otp.subtitle', { phone: formatPhoneForDisplay(phone) }),
        large: true,
      }}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            title={t('onboarding.otp.verify')}
            onPress={() => verify(code)}
            loading={verifying}
            disabled={code.length !== OTP_LENGTH}
            size="lg"
            testID="otp-verify"
          />
          <Button
            title={cooldown > 0 ? t('onboarding.otp.resendIn', { seconds: cooldown }) : t('onboarding.otp.resend')}
            onPress={resend}
            variant="ghost"
            disabled={cooldown > 0}
            loading={resending}
            testID="otp-resend"
          />
        </View>
      }
      testID="otp-screen"
    >
      <View style={{ gap: spacing.lg }}>
        <OtpInput value={code} onChange={setCode} onComplete={verify} error={Boolean(error)} disabled={verifying} />
        {error ? (
          <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite" testID="otp-error">
            {error}
            {attemptsLeft !== null ? ` ${t('onboarding.otp.attemptsRemaining', { count: attemptsLeft })}` : ''}
          </Text>
        ) : null}
        {IS_DEV && devCode ? (
          <View style={styles.devRow}>
            <Badge label={t('common.developmentOnly')} tone="warning" icon="alert" />
            <Text variant="bodySmall" tone="secondary" testID="otp-dev-hint">
              {t('onboarding.otp.devHint', { code: devCode })}
            </Text>
          </View>
        ) : null}
        <Button
          title={t('onboarding.otp.wrongNumber')}
          onPress={() => router.back()}
          variant="ghost"
          fullWidth={false}
          size="sm"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ devRow: { gap: 8 } });
