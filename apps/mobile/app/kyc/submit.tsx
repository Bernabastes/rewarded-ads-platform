import type { KycIdType, KycUploadKind } from '@rap/shared';
import { ErrorCode } from '@rap/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { usersApi } from '@/api/endpoints/users';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryClient';
import { useKyc, useRefreshMe } from '@/api/queries/users';
import { useAuthStore } from '@/auth/authStore';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { DateOfBirthInput } from '@/features/auth/DateOfBirthInput';
import { defaultCalendarFor, dobPayload, EMPTY_DOB, isoToEthiopian, resolveDob, type CalendarKind, type DobParts } from '@/features/auth/dob';
import { pickKycImage, uploadKycFile, type PickSource } from '@/features/kyc/upload';
import { UploadTile } from '@/features/kyc/UploadTile';
import {
  checkFile,
  DEFAULT_UPLOAD_LIMITS,
  EMPTY_UPLOADS,
  KYC_ID_TYPES,
  requiredUploads,
  uploadKeys,
  uploadsInFlight,
  validateKycForm,
  type KycFieldError,
  type PickedFile,
  type UploadMap,
} from '@/features/kyc/validation';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

const ID_ICONS: Record<KycIdType, IconName> = { fayda: 'shield', national_id: 'clipboard', passport: 'globe' };

function prefillDob(calendar: CalendarKind, iso: string | null | undefined): DobParts {
  if (!iso) return EMPTY_DOB;
  if (calendar === 'ethiopian') {
    const eth = isoToEthiopian(iso);
    return eth ? { day: String(eth.day), month: String(eth.month), year: String(eth.year) } : EMPTY_DOB;
  }
  const [year, month, day] = iso.split('-');
  return { day: String(Number(day)), month: String(Number(month)), year };
}

/** KYC submission: id type + number, name, DOB (either calendar), presigned document uploads. */
export default function KycSubmitScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const client = useQueryClient();
  const { colors, spacing, radii } = useTheme();
  const user = useAuthStore((s) => s.user);
  const kyc = useKyc();
  const refreshMe = useRefreshMe();
  const limits = kyc.data?.uploadLimits ?? DEFAULT_UPLOAD_LIMITS;

  const [idType, setIdType] = useState<KycIdType>('fayda');
  const [idNumber, setIdNumber] = useState('');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [calendar, setCalendar] = useState<CalendarKind>(() => defaultCalendarFor(language));
  const [dob, setDob] = useState<DobParts>(() => prefillDob(defaultCalendarFor(language), user?.dateOfBirth));
  const [uploads, setUploads] = useState<UploadMap>(EMPTY_UPLOADS);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const resolved = useMemo(() => resolveDob(calendar, dob), [calendar, dob]);
  const errors = useMemo(
    () => validateKycForm({ idType, idNumber, fullName, calendar, dob, uploads }),
    [calendar, dob, fullName, idNumber, idType, uploads],
  );
  const has = (field: KycFieldError) => touched && errors.includes(field);
  const busy = submitting || uploadsInFlight(uploads);

  const setUpload = (kind: KycUploadKind, state: UploadMap[KycUploadKind]) =>
    setUploads((prev) => ({ ...prev, [kind]: state }));

  const upload = async (kind: KycUploadKind, file: PickedFile) => {
    const problem = checkFile(file, limits);
    if (problem) {
      setUpload(kind, {
        status: 'error',
        file: null,
        message: t(`kyc.uploads.problems.${problem}`, { maxMb: Math.round(limits.maxBytes / (1024 * 1024)) }),
      });
      return;
    }
    setUpload(kind, { status: 'uploading', file });
    try {
      const storageKey = await uploadKycFile(kind, file);
      setUpload(kind, { status: 'uploaded', file, storageKey });
    } catch (error) {
      setUpload(kind, { status: 'error', file, message: errorMessage(error, t) });
    }
  };

  const pick = async (kind: KycUploadKind, source: PickSource) => {
    try {
      const file = await pickKycImage(source);
      if (file) await upload(kind, file);
    } catch (error) {
      const permission = isApiError(error) && (error.details as { permission?: string } | undefined)?.permission;
      setUpload(kind, { status: 'error', file: null, message: permission ? t(`kyc.uploads.problems.${permission}_permission`) : errorMessage(error, t) });
    }
  };

  const submit = async () => {
    setTouched(true);
    setFormError(null);
    if (errors.length || !resolved) return;
    const keys = uploadKeys(idType, uploads);
    if (!keys) return;
    setSubmitting(true);
    try {
      await usersApi.submitKyc({
        idType,
        idNumber: idNumber.trim(),
        fullName: fullName.trim(),
        ...dobPayload(calendar, resolved),
        ...keys,
      });
      await client.invalidateQueries({ queryKey: queryKeys.kyc });
      void refreshMe().catch(() => undefined);
      toast.success(t('kyc.submittedToast'));
      router.replace('/kyc');
    } catch (error) {
      if (isApiError(error) && (error.code === ErrorCode.KYC_SUBMISSION_PENDING || error.code === ErrorCode.KYC_ALREADY_VERIFIED)) {
        toast.info(t(`errors.codes.${error.code}`));
        await client.invalidateQueries({ queryKey: queryKeys.kyc });
        router.replace('/kyc');
        return;
      }
      setFormError(errorMessage(error, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      header={{ title: t('kyc.submitTitle') }}
      keyboardAvoiding
      footer={
        <Button
          title={t('kyc.submit')}
          onPress={() => void submit()}
          loading={submitting}
          disabled={busy || (touched && errors.length > 0)}
          size="lg"
          icon="shield"
          testID="kyc-submit"
        />
      }
      testID="kyc-submit-screen"
    >
      <View style={{ gap: spacing.xl }}>
        <Text variant="body" tone="secondary">
          {t('kyc.submitIntro')}
        </Text>

        <View style={{ gap: spacing.sm }}>
          <Text variant="label" weight="medium" tone="secondary">
            {t('kyc.idType')}
          </Text>
          {KYC_ID_TYPES.map((type) => {
            const selected = idType === type;
            return (
              <Tappable
                key={type}
                onPress={() => setIdType(type)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(`kyc.idTypes.${type}`)}
                testID={`kyc-idtype-${type}`}
                style={[
                  styles.idRow,
                  {
                    borderRadius: radii.lg,
                    padding: spacing.md,
                    backgroundColor: selected ? colors.primarySoft : colors.surface,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Icon name={ID_ICONS[type]} size={20} color={selected ? colors.primary : colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text variant="body" weight="semibold">
                    {t(`kyc.idTypes.${type}`)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t(`kyc.idTypeHints.${type}`)}
                  </Text>
                </View>
                {selected ? <Icon name="circleCheck" color={colors.primary} /> : null}
              </Tappable>
            );
          })}
        </View>

        <Input
          label={t('kyc.idNumber')}
          placeholder={t(`kyc.idNumberPlaceholder.${idType}`)}
          value={idNumber}
          onChangeText={setIdNumber}
          autoCapitalize="characters"
          autoCorrect={false}
          helperText={t('kyc.idNumberHelper')}
          errorText={has('idNumber') ? t('kyc.errors.idNumber') : null}
          testID="kyc-idnumber"
        />
        <Input
          label={t('kyc.fullName')}
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          helperText={t('kyc.fullNameHelper')}
          errorText={has('fullName') ? t('onboarding.profile.fullNameInvalid') : null}
          testID="kyc-fullname"
        />
        <DateOfBirthInput
          calendar={calendar}
          onCalendarChange={setCalendar}
          value={dob}
          onChange={setDob}
          resolved={resolved}
          errorText={has('dob') ? t('onboarding.profile.dobInvalid') : has('dobAge') ? t('kyc.errors.dobAge') : null}
          testID="kyc-dob"
        />

        <View style={{ gap: spacing.md }}>
          <Text variant="label" weight="medium" tone="secondary">
            {t('kyc.documentsTitle')}
          </Text>
          {requiredUploads(idType).map((kind) => (
            <UploadTile
              key={kind}
              kind={kind}
              state={uploads[kind]}
              onPick={(source) => void pick(kind, source)}
              onRetry={() => {
                const state = uploads[kind];
                if (state.status === 'error' && state.file) void upload(kind, state.file);
              }}
              disabled={submitting}
            />
          ))}
          {has('documents') ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" testID="kyc-documents-error">
              {t('kyc.errors.documents')}
            </Text>
          ) : null}
          <Card tone="muted" padding={spacing.md}>
            <Text variant="caption" tone="secondary">
              {t('kyc.uploads.limits', { maxMb: Math.round(limits.maxBytes / (1024 * 1024)) })}
            </Text>
          </Card>
        </View>

        {formError ? (
          <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite" testID="kyc-error">
            {formError}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted">
          {t('kyc.privacyNote')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 },
});
