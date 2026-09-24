import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { Input } from '@/components/ui/Input';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

export interface DobParts {
  day: string;
  month: string;
  year: string;
}

export interface DateOfBirthInputProps {
  value: DobParts;
  onChange(value: DobParts): void;
  errorText?: string | null;
  onComplete?(): void;
  testID?: string;
}

/** Builds "YYYY-MM-DD" when the parts form a real calendar date in the past, else null. */
export function partsToIsoDate(parts: DobParts, now: Date = new Date()): string | null {
  const day = Number(parts.day);
  const month = Number(parts.month);
  const year = Number(parts.year);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (parts.year.length !== 4 || year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (date.getTime() > now.getTime()) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Three auto-advancing numeric fields (DD / MM / YYYY). Works identically on web and native without
 * a native date-picker dependency; the value is sent to the API as `YYYY-MM-DD`.
 */
export function DateOfBirthInput({ value, onChange, errorText, onComplete, testID = 'dob' }: DateOfBirthInputProps) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  const digitsOnly = (raw: string, max: number) => raw.replace(/\D/g, '').slice(0, max);

  return (
    <View>
      <Text variant="label" weight="medium" tone="secondary" style={{ marginBottom: spacing.xs }}>
        {t('onboarding.profile.dob')}
      </Text>
      <View style={styles.row}>
        <Input
          containerStyle={styles.small}
          placeholder={t('onboarding.profile.day')}
          accessibilityLabel={t('onboarding.profile.day')}
          value={value.day}
          onChangeText={(raw) => {
            const day = digitsOnly(raw, 2);
            onChange({ ...value, day });
            if (day.length === 2) monthRef.current?.focus();
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={2}
          textAlign="center"
          testID={`${testID}-day`}
        />
        <Input
          ref={monthRef}
          containerStyle={styles.small}
          placeholder={t('onboarding.profile.month')}
          accessibilityLabel={t('onboarding.profile.month')}
          value={value.month}
          onChangeText={(raw) => {
            const month = digitsOnly(raw, 2);
            onChange({ ...value, month });
            if (month.length === 2) yearRef.current?.focus();
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={2}
          textAlign="center"
          testID={`${testID}-month`}
        />
        <Input
          ref={yearRef}
          containerStyle={styles.large}
          placeholder={t('onboarding.profile.year')}
          accessibilityLabel={t('onboarding.profile.year')}
          value={value.year}
          onChangeText={(raw) => onChange({ ...value, year: digitsOnly(raw, 4) })}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={4}
          textAlign="center"
          returnKeyType="done"
          onSubmitEditing={onComplete}
          testID={`${testID}-year`}
        />
      </View>
      <Text variant="caption" tone={errorText ? 'danger' : 'muted'} style={{ marginTop: spacing.xs }}>
        {errorText ?? t('onboarding.profile.dobHelper')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  small: { flex: 1 },
  large: { flex: 1.6 },
});
