import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Icon, type IconName } from './Icon';
import { Tappable } from './Tappable';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md';
}

export function useBadgeColors(tone: BadgeTone) {
  const { colors } = useTheme();
  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceMuted, fg: colors.textSecondary },
    primary: { bg: colors.primarySoft, fg: colors.primarySoftText },
    accent: { bg: colors.accentSoft, fg: colors.accentSoftText },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    info: { bg: colors.infoSoft, fg: colors.info },
  };
  return map[tone];
}

export function Badge({ label, tone = 'neutral', icon, style, size = 'sm' }: BadgeProps) {
  const { radii } = useTheme();
  const { bg, fg } = useBadgeColors(tone);
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, borderRadius: radii.full, paddingVertical: size === 'sm' ? 3 : 6 },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 16} color={fg} strokeWidth={2.2} /> : null}
      <Text variant={size === 'sm' ? 'caption' : 'label'} weight="semibold" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  );
}

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** Selectable pill used for filters and quick amounts. */
export function Chip({ label, selected = false, onPress, icon, disabled, style, accessibilityLabel }: ChipProps) {
  const { colors, radii, minTouchTarget } = useTheme();
  const bg = selected ? colors.primary : colors.surface;
  const fg = selected ? colors.textOnPrimary : colors.text;
  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      style={[
        styles.chip,
        {
          backgroundColor: bg,
          borderColor: selected ? colors.primary : colors.border,
          borderRadius: radii.full,
          minHeight: minTouchTarget - 6,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={fg} /> : null}
      <Text variant="bodySmall" weight="medium" style={{ color: fg }}>
        {label}
      </Text>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, alignSelf: 'flex-start' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
  },
});
