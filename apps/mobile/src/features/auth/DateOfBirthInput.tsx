import type { Language } from '@rap/shared';
import { ETHIOPIAN_MONTHS, formatEthiopianDate } from '@rap/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { Chip } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate } from '@/utils/format';

import {
  convertParts,
  ethiopianDaysInTypedMonth,
  monthLabel,
  monthSecondaryLabel,
  type CalendarKind,
  type DobParts,
  type ResolvedDob,
} from './dob';

export type { CalendarKind, DobParts } from './dob';

export interface DateOfBirthInputProps {
  calendar: CalendarKind;
  onCalendarChange(kind: CalendarKind): void;
  value: DobParts;
  onChange(value: DobParts): void;
  /** Valid date (both calendars) for the live preview line; null while incomplete. */
  resolved?: ResolvedDob | null;
  errorText?: string | null;
  onComplete?(): void;
  testID?: string;
}

/** "5 ጳጉሜ 1985" in the UI script for the preview lines and profile. */
export function formatEthiopianForUi(date: { year: number; month: number; day: number }, language: Language): string {
  return formatEthiopianDate(date, language === 'am' || language === 'ti' ? 'am' : 'en');
}

/**
 * Date of birth entry in either calendar. Gregorian: three auto-advancing numeric fields (DD / MM / YYYY).
 * Ethiopian: year + a month picker (1–13 with Amharic and English names, Pagume has 5/6 days) + day.
 * Switching calendars converts a valid date instead of clearing it. Identical on web and native.
 */
export function DateOfBirthInput({
  calendar,
  onCalendarChange,
  value,
  onChange,
  resolved,
  errorText,
  onComplete,
  testID = 'dob',
}: DateOfBirthInputProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const dayRef = useRef<TextInput>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const digitsOnly = (raw: string, max: number) => raw.replace(/\D/g, '').slice(0, max);
  const switchCalendar = (next: CalendarKind) => {
    if (next === calendar) return;
    onChange(convertParts(calendar, next, value));
    onCalendarChange(next);
  };

  const monthIndex = Number(value.month);
  const monthChosen = Number.isInteger(monthIndex) && monthIndex >= 1 && monthIndex <= 13;
  const pagumeDays = ethiopianDaysInTypedMonth(value);

  const preview = resolved
    ? calendar === 'ethiopian'
      ? t('onboarding.profile.previewGregorian', { date: formatDate(`${resolved.iso}T00:00:00Z`, language) })
      : t('onboarding.profile.previewEthiopian', { date: formatEthiopianForUi(resolved.ethiopian, language) })
    : null;

  return (
    <View>
      <View style={[styles.labelRow, { marginBottom: spacing.sm }]}>
        <Text variant="label" weight="medium" tone="secondary">
          {t('onboarding.profile.dob')}
        </Text>
        <View style={styles.toggle} accessibilityRole="radiogroup">
          <Chip
            label={t('onboarding.profile.calendar.ethiopian')}
            selected={calendar === 'ethiopian'}
            onPress={() => switchCalendar('ethiopian')}
            icon="calendar"
            accessibilityLabel={t('onboarding.profile.calendar.switchTo', { calendar: t('onboarding.profile.calendar.ethiopian') })}
          />
          <Chip
            label={t('onboarding.profile.calendar.gregorian')}
            selected={calendar === 'gregorian'}
            onPress={() => switchCalendar('gregorian')}
            accessibilityLabel={t('onboarding.profile.calendar.switchTo', { calendar: t('onboarding.profile.calendar.gregorian') })}
          />
        </View>
      </View>

      {calendar === 'gregorian' ? (
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
      ) : (
        <Animated.View entering={FadeIn} style={{ gap: spacing.sm }}>
          <View style={styles.row}>
            <Input
              containerStyle={styles.small}
              placeholder={t('onboarding.profile.day')}
              accessibilityLabel={t('onboarding.profile.day')}
              value={value.day}
              onChangeText={(raw) => onChange({ ...value, day: digitsOnly(raw, 2) })}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={2}
              textAlign="center"
              ref={dayRef}
              testID={`${testID}-eth-day`}
            />
            <Tappable
              onPress={() => setMonthPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.profile.month')}
              accessibilityValue={{ text: monthChosen ? monthLabel(monthIndex, language) : undefined }}
              testID={`${testID}-eth-month`}
              style={[
                styles.monthField,
                styles.large,
                { borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text variant="body" tone={monthChosen ? 'default' : 'muted'} numberOfLines={1}>
                  {monthChosen ? monthLabel(monthIndex, language) : t('onboarding.profile.month')}
                </Text>
                {monthChosen ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {monthSecondaryLabel(monthIndex, language)}
                  </Text>
                ) : null}
              </View>
              <Icon name="chevronDown" size={18} color={colors.textMuted} />
            </Tappable>
            <Input
              ref={yearRef}
              containerStyle={styles.medium}
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
              testID={`${testID}-eth-year`}
            />
          </View>
          {monthIndex === 13 ? (
            <Text variant="caption" tone="secondary" testID={`${testID}-pagume-hint`}>
              {t('onboarding.profile.pagumeHint', { days: pagumeDays })}
            </Text>
          ) : null}
        </Animated.View>
      )}

      <Text variant="caption" tone={errorText ? 'danger' : 'muted'} style={{ marginTop: spacing.xs }} accessibilityLiveRegion="polite">
        {errorText ?? preview ?? t(`onboarding.profile.dobHelper.${calendar}`)}
      </Text>

      <Modal transparent visible={monthPickerOpen} animationType="none" onRequestClose={() => setMonthPickerOpen(false)} statusBarTranslucent>
        <Animated.View entering={FadeIn.duration(150)} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMonthPickerOpen(false)} accessibilityRole="button" accessibilityLabel={t('common.close')} />
          <Animated.View
            entering={FadeInUp.duration(220)}
            style={[styles.sheet, { backgroundColor: colors.surfaceElevated, borderRadius: radii.xl, padding: spacing.lg }]}
            accessibilityViewIsModal
            testID={`${testID}-month-picker`}
          >
            <Text variant="h3" weight="semibold" style={{ marginBottom: spacing.sm }} accessibilityRole="header">
              {t('onboarding.profile.pickMonth')}
            </Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {ETHIOPIAN_MONTHS.map((month) => {
                const selected = monthIndex === month.index;
                return (
                  <Tappable
                    key={month.index}
                    onPress={() => {
                      onChange({ ...value, month: String(month.index) });
                      setMonthPickerOpen(false);
                      if (!value.day) setTimeout(() => dayRef.current?.focus(), 50);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${month.am} ${month.en}`}
                    testID={`${testID}-month-${month.index}`}
                    style={[
                      styles.monthRow,
                      { borderRadius: radii.md, backgroundColor: selected ? colors.primarySoft : 'transparent', paddingHorizontal: spacing.md },
                    ]}
                  >
                    <Text variant="bodySmall" tone="muted" style={styles.monthIndex}>
                      {month.index}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text variant="body" weight={selected ? 'semibold' : 'regular'}>
                        {language === 'am' || language === 'ti' ? month.am : month.en}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {language === 'am' || language === 'ti' ? month.en : month.am}
                      </Text>
                    </View>
                    {month.index === 13 ? (
                      <Text variant="caption" tone="muted">
                        {t('onboarding.profile.pagumeShort')}
                      </Text>
                    ) : null}
                    {selected ? <Icon name="check" size={18} color={colors.primary} /> : null}
                  </Tappable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  toggle: { flexDirection: 'row', gap: 6 },
  row: { flexDirection: 'row', gap: 10 },
  small: { flex: 1 },
  medium: { flex: 1.3 },
  large: { flex: 1.6 },
  monthField: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, minHeight: 52 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 420 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  monthIndex: { width: 24, textAlign: 'right' },
});
