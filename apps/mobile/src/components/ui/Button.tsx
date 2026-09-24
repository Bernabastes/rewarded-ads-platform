import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Icon, type IconName } from './Icon';
import { Tappable } from './Tappable';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = true,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { colors, radii, spacing, minTouchTarget } = useTheme();
  const isDisabled = disabled || loading;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.primary, fg: colors.textOnPrimary },
    secondary: { bg: colors.primarySoft, fg: colors.primarySoftText },
    accent: { bg: colors.accent, fg: colors.textOnAccent },
    ghost: { bg: 'transparent', fg: colors.primary },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    outline: { bg: 'transparent', fg: colors.text, border: colors.borderStrong },
  };
  const { bg, fg, border } = palette[variant];
  const heights: Record<ButtonSize, number> = { sm: minTouchTarget, md: 52, lg: 58 };
  const fontVariant = size === 'sm' ? 'bodySmall' : 'body';

  return (
    <Tappable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={[
        styles.base,
        {
          backgroundColor: bg,
          minHeight: heights[size],
          borderRadius: radii.md,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.xl,
          opacity: isDisabled ? 0.55 : 1,
          borderWidth: border ? 1.5 : 0,
          borderColor: border,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={fg} size="small" />
        ) : (
          <>
            {icon && iconPosition === 'left' ? <Icon name={icon} size={20} color={fg} /> : null}
            <Text variant={fontVariant} weight="semibold" style={{ color: fg }} numberOfLines={1}>
              {title}
            </Text>
            {icon && iconPosition === 'right' ? <Icon name={icon} size={20} color={fg} /> : null}
          </>
        )}
      </View>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  base: { justifyContent: 'center', alignItems: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
