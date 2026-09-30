import { ErrorCode } from '@rap/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
import { useCountdown } from '@/components/ui/useCountdown';
import { IS_DEV } from '@/config';
import { getDeviceIdentity } from '@/device/fingerprint';
import { formatPhoneForDisplay } from '@/features/auth/phone';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

const OTP_LENGTH = 6;
const REFERRAL_ERROR_CODES = new Set<string>([
  ErrorCode.REFERRAL_CODE_INVALID,
  ErrorCode.REFERRAL_SELF_NOT_ALLOWED,
  ErrorCode.REFERRAL_ALREADY_APPLIED,
]);

export default function OtpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const params = useLocalSearchParams<{
    phone: string;
    resendAfter?: string;
    expiresIn?: string;
    devCode?: string;
    referralCode?: string;
  }>();
  const phone = params.phone ?? '';
  const language = usePrefsStore((s) => s.language);
  const setBlocked = useAuthStore((s) => s.setBlocked);

  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(params.devCode || '');
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  // The referral code is honoured on the FIRST login only; after a referral error we retry without it.
  const [referralCode, setReferralCode] = useState(params.referralCode || '');
  const [referralError, setReferralError] = useState<string | null>(null);
  const cooldown = useCountdown(Number(params.resendAfter) || 60);
  const submittedCode = useRef<string | null>(null);

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
          referralCode: referralCode || undefined,
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
          if (REFERRAL_ERROR_CODES.has(err.code)) {
            // The login itself did not happen: drop the code and let the user verify again without it.
            setReferralError(t(`onboarding.otp.referralErrors.${err.code}`, { defaultValue: errorMessage(err, t) }));
            setReferralCode('');
            setCode('');
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
    [language, phone, referralCode, router, setBlocked, t, verifying],
  );

  const resend = async () => {
    setResending(true);
    setError(null);
    try {
      const result = await authApi.requestOtp({ phoneNumber: phone });
      cooldown.restart(result.resendAfterSeconds);
      setDevCode(result.devCode ?? '');
      setCode('');
      submittedCode.current = null;
      setAttemptsLeft(null);
    } catch (err) {
      if (isApiError(err) && err.statusCode === 429 && err.retryAfterSeconds) cooldown.restart(err.retryAfterSeconds);
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
            title={cooldown.active ? t('onboarding.otp.resendIn', { seconds: cooldown.seconds }) : t('onboarding.otp.resend')}
            onPress={resend}
            variant="ghost"
            disabled={cooldown.active}
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
        {referralCode ? (
          <Badge label={t('onboarding.otp.referralApplied', { code: referralCode })} tone="primary" icon="gift" size="md" />
        ) : null}
        {referralError ? (
          <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite" testID="otp-referral-error">
            {referralError} {t('onboarding.otp.referralRetryHint')}
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
