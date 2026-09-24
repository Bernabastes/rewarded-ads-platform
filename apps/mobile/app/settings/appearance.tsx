import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeMode } from '@/theme/tokens';

const OPTIONS: { mode: ThemeMode; icon: IconName }[] = [
  { mode: 'system', icon: 'sliders' },
  { mode: 'light', icon: 'sun' },
  { mode: 'dark', icon: 'moon' },
];

export default function AppearanceScreen() {
  const { t } = useTranslation();
  const { colors, radii, spacing } = useTheme();
  const mode = usePrefsStore((s) => s.themeMode);
  const setMode = usePrefsStore((s) => s.setThemeMode);

  return (
    <Screen header={{ title: t('profile.theme') }} testID="settings-appearance">
      <View style={{ gap: spacing.sm }}>
        {OPTIONS.map((option) => {
          const selected = option.mode === mode;
          return (
            <Tappable
              key={option.mode}
              onPress={() => setMode(option.mode)}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              testID={`theme-${option.mode}`}
              style={[
                styles.option,
                { borderRadius: radii.lg, padding: spacing.lg, backgroundColor: selected ? colors.primarySoft : colors.surface, borderColor: selected ? colors.primary : colors.border },
              ]}
            >
              <Icon name={option.icon} color={selected ? colors.primary : colors.textSecondary} />
              <Text variant="body" weight="semibold" style={{ flex: 1 }}>
                {t(`profile.themeOptions.${option.mode}`)}
              </Text>
              {selected ? <Icon name="circleCheck" color={colors.primary} /> : null}
            </Tappable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, minHeight: 60 } });
