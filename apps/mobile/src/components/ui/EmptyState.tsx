import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Illustration, type IllustrationName } from '@/components/illustrations/Illustration';
import { useTheme } from '@/theme/ThemeProvider';

import { Button, type ButtonProps } from './Button';
import { Text } from './Text';

export interface EmptyStateProps {
  illustration: IllustrationName;
  title: string;
  body?: string;
  action?: Pick<ButtonProps, 'title' | 'onPress' | 'variant' | 'icon' | 'loading'>;
  secondaryAction?: Pick<ButtonProps, 'title' | 'onPress' | 'variant' | 'icon'>;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  testID?: string;
}

/** Deliberately designed empty / error state: illustration, friendly copy and a clear next action. */
export function EmptyState({
  illustration,
  title,
  body,
  action,
  secondaryAction,
  style,
  compact = false,
  testID,
}: EmptyStateProps) {
  const { spacing } = useTheme();
  return (
    <View style={[styles.container, { paddingVertical: compact ? spacing.lg : spacing.huge }, style]} testID={testID}>
      <Illustration name={illustration} size={compact ? 120 : 170} />
      <Text variant="h2" weight="bold" align="center" style={{ marginTop: spacing.xl }} accessibilityRole="header">
        {title}
      </Text>
      {body ? (
        <Text variant="body" tone="secondary" align="center" style={{ marginTop: spacing.sm, maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <View style={{ marginTop: spacing.xxl, alignSelf: 'stretch', gap: spacing.sm }}>
          <Button {...action} />
          {secondaryAction ? <Button variant="ghost" {...secondaryAction} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
});
