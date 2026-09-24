import type { Language } from '@rap/shared';
import { SUPPORTED_LANGUAGES } from '@rap/shared';
import { getLocales } from 'expo-localization';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { isSupportedLanguage, LANGUAGE_NAMES } from '@/i18n';
import { useLanguage } from '@/i18n/useLanguage';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';

export interface LanguagePickerProps {
  /** Called after the local language has been switched (e.g. to sync with the API). */
  onChange?(language: Language): void;
  testID?: string;
}

export function useDeviceLanguage(): Language | null {
  return useMemo(() => {
    try {
      const code = getLocales()[0]?.languageCode;
      return isSupportedLanguage(code) ? code : null;
    } catch {
      return null;
    }
  }, []);
}

/** List of the supported languages; switching applies instantly to the whole UI. */
export function LanguagePicker({ onChange, testID = 'language-picker' }: LanguagePickerProps) {
  const { t, i18n } = useTranslation();
  const current = useLanguage();
  const setLanguage = usePrefsStore((s) => s.setLanguage);
  const { colors, radii, spacing } = useTheme();
  const deviceLanguage = useDeviceLanguage();

  const select = (language: Language) => {
    setLanguage(language);
    void i18n.changeLanguage(language);
    onChange?.(language);
  };

  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      {SUPPORTED_LANGUAGES.map((language) => {
        const selected = language === current;
        return (
          <Tappable
            key={language}
            onPress={() => select(language)}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={`${LANGUAGE_NAMES[language]} (${t(`languages.${language}`)})`}
            testID={`${testID}-${language}`}
            style={[
              styles.option,
              {
                backgroundColor: selected ? colors.primarySoft : colors.surface,
                borderColor: selected ? colors.primary : colors.border,
                borderRadius: radii.lg,
                padding: spacing.lg,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="h3" weight="semibold">
                {LANGUAGE_NAMES[language]}
              </Text>
              <Text variant="bodySmall" tone="secondary">
                {t(`languages.${language}`)}
              </Text>
            </View>
            {selected ? <Icon name="circleCheck" color={colors.primary} /> : null}
          </Tappable>
        );
      })}
      {deviceLanguage && deviceLanguage !== current ? (
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
          {t('onboarding.language.deviceHint', { language: LANGUAGE_NAMES[deviceLanguage] })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, minHeight: 64 },
});
