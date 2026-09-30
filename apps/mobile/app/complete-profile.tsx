import { PLATFORM_DEFAULTS } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { authApi } from '@/api/endpoints/auth';
import { isApiError } from '@/api/errors';
import { blockedReasonFromCode, useAuthStore } from '@/auth/authStore';
import { applyUserUpdate } from '@/auth/session';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME } from '@/config';
import { DateOfBirthInput } from '@/features/auth/DateOfBirthInput';
import { defaultCalendarFor, dobPayload, EMPTY_DOB, resolveDob, type CalendarKind, type DobParts } from '@/features/auth/dob';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

export default function CompleteProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { spacing } = useTheme();
  const language = usePrefsStore((s) => s.language);
  const setBlocked = useAuthStore((s) => s.setBlocked);
  const existingName = useAuthStore((s) => s.user?.fullName ?? '');

  const [fullName, setFullName] = useState(existingName);
  // Amharic speakers get the Ethiopian calendar first; everyone else Gregorian. Both stay one tap away.
  const [calendar, setCalendar] = useState<CalendarKind>(() => defaultCalendarFor(language));
  const [dob, setDob] = useState<DobParts>(EMPTY_DOB);
  const [nameError, setNameError] = useState<string | null>(null);
  const [dobError, setDobError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resolved = useMemo(() => resolveDob(calendar, dob), [calendar, dob]);
  const age = resolved?.age ?? null;
  const tooYoung = age !== null && age < PLATFORM_DEFAULTS.MIN_AGE;
  const nameValid = fullName.trim().length >= 2;

  const submit = async () => {
    let valid = true;
    if (!nameValid) {
      setNameError(t('onboarding.profile.fullNameInvalid'));
      valid = false;
    }
    if (!resolved) {
      setDobError(t('onboarding.profile.dobInvalid'));
      valid = false;
    }
    if (!valid || !resolved) return;
    setSubmitting(true);
    setFormError(null);
    try {
      // Exactly one DOB representation goes on the wire; the server converts / validates Ethiopian dates itself.
      const user = await authApi.completeProfile({
        fullName: fullName.trim(),
        ...dobPayload(calendar, resolved),
        languagePreference: language,
      });
      await applyUserUpdate(user);
      router.replace('/');
    } catch (err) {
      if (isApiError(err)) {
        const blocked = blockedReasonFromCode(err.code);
        if (blocked) {
          setBlocked(blocked);
          return;
        }
        const fieldName = err.fieldMessage('fullName');
        const fieldDob = err.fieldMessage('dateOfBirth') ?? err.fieldMessage('dateOfBirthEthiopian');
        if (fieldName) setNameError(t('onboarding.profile.fullNameInvalid'));
        if (fieldDob) setDobError(t('onboarding.profile.dobInvalid'));
        if (fieldName || fieldDob) return;
      }
      setFormError(errorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      keyboardAvoiding
      header={{
        title: t('onboarding.profile.title'),
        subtitle: t('onboarding.profile.subtitle'),
        large: true,
        hideBack: true,
      }}
      footer={
        <Button
          title={t('onboarding.profile.cta')}
          onPress={submit}
          loading={submitting}
          disabled={!nameValid || !resolved}
          size="lg"
          testID="profile-submit"
        />
      }
      testID="complete-profile-screen"
    >
      <View style={{ gap: spacing.xl }}>
        <Input
          label={t('onboarding.profile.fullName')}
          placeholder={t('onboarding.profile.fullNamePlaceholder')}
          value={fullName}
          onChangeText={(value) => {
            setFullName(value);
            if (nameError) setNameError(null);
          }}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
          errorText={nameError}
          testID="profile-name"
        />
        <DateOfBirthInput
          calendar={calendar}
          onCalendarChange={setCalendar}
          value={dob}
          onChange={(value) => {
            setDob(value);
            if (dobError) setDobError(null);
          }}
          resolved={resolved}
          errorText={dobError}
          onComplete={submit}
        />
        {age !== null ? (
          <View style={{ gap: spacing.sm }}>
            <Badge
              label={t('onboarding.profile.agePreview', { age })}
              tone={tooYoung ? 'danger' : 'success'}
              icon={tooYoung ? 'alert' : 'circleCheck'}
              size="md"
            />
            {tooYoung ? (
              <Text variant="bodySmall" tone="danger">
                {t('onboarding.profile.ageTooYoung', { brand: BRAND_NAME })}
              </Text>
            ) : null}
          </View>
        ) : null}
        {formError ? (
          <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite">
            {formError}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
