import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Tappable } from './Tappable';

export interface CardProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  /** Visual weight: flat surface with border, or soft-shadow elevated. */
  elevation?: 'flat' | 'raised';
  padding?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  tone?: 'surface' | 'primary' | 'accent' | 'muted';
}

export function Card({
  children,
  style,
  elevation = 'flat',
  padding,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  tone = 'surface',
}: CardProps) {
  const { colors, radii, spacing, shadows, isDark } = useTheme();
  const background: Record<NonNullable<CardProps['tone']>, string> = {
    surface: colors.surface,
    primary: colors.primary,
    accent: colors.accentSoft,
    muted: colors.surfaceMuted,
  };
  const base: ViewStyle = {
    backgroundColor: background[tone],
    borderRadius: radii.lg,
    padding: padding ?? spacing.lg,
    borderWidth: elevation === 'flat' && tone === 'surface' ? 1 : 0,
    borderColor: colors.border,
    ...(elevation === 'raised' && !isDark ? shadows.md : {}),
  };
  if (onPress) {
    return (
      <Tappable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={[base, style]}
      >
        {children}
      </Tappable>
    );
  }
  return (
    <View style={[base, style]} testID={testID} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

export const cardStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
