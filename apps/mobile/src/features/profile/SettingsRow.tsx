import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/theme/ThemeProvider';

export interface SettingsRowProps {
  icon: IconName;
  label: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  accessibilityHint?: string;
  testID?: string;
  switchValue?: boolean;
  onSwitch?: (value: boolean) => void;
  disabled?: boolean;
}

export function SettingsRow({
  icon,
  label,
  value,
  onPress,
  right,
  destructive,
  accessibilityHint,
  testID,
  switchValue,
  onSwitch,
  disabled,
}: SettingsRowProps) {
  const { colors, spacing, radii, minTouchTarget } = useTheme();
  const isSwitch = onSwitch !== undefined;
  const content = (
    <>
      <View style={[styles.icon, { backgroundColor: destructive ? colors.dangerSoft : colors.surfaceMuted, borderRadius: radii.md }]}>
        <Icon name={icon} size={18} color={destructive ? colors.danger : colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body" weight="medium" style={destructive ? { color: colors.danger } : undefined}>
          {label}
        </Text>
        {value ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      {isSwitch ? (
        <Switch
          value={Boolean(switchValue)}
          onValueChange={onSwitch}
          disabled={disabled}
          trackColor={{ true: colors.primary, false: colors.borderStrong }}
          thumbColor="#FFFFFF"
          accessibilityLabel={label}
          testID={testID ? `${testID}-switch` : undefined}
        />
      ) : (
        right ?? (onPress ? <Icon name="chevronRight" size={18} color={colors.textMuted} /> : null)
      )}
    </>
  );
  const style = [styles.row, { minHeight: minTouchTarget + 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }];
  if (onPress && !isSwitch) {
    return (
      <Tappable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} style={style} testID={testID} disabled={disabled} pressScale={0.99}>
        {content}
      </Tappable>
    );
  }
  return (
    <View style={style} testID={testID}>
      {content}
    </View>
  );
}

export function SettingsGroup({ title, children }: PropsWithChildren<{ title?: string }>) {
  const { colors, radii, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      {title ? (
        <Text variant="label" weight="semibold" tone="muted" style={{ paddingHorizontal: 4 }} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  group: { borderWidth: 1, overflow: 'hidden', paddingVertical: 4 },
});
