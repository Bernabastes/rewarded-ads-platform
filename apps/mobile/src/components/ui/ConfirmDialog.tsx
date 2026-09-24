import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

import { Button } from './Button';
import { Text } from './Text';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm(): void;
  onCancel(): void;
  destructive?: boolean;
  testID?: string;
}

/** Small centred confirmation sheet (used for "leave this ad?" and "sign out?"). */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
  testID = 'confirm-dialog',
}: ConfirmDialogProps) {
  const { colors, radii, spacing, shadows } = useTheme();
  if (!visible) return null;
  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(150)} style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityRole="button" accessibilityLabel={cancelLabel} />
        <Animated.View
          entering={FadeInUp.duration(220)}
          style={[styles.sheet, shadows.lg, { backgroundColor: colors.surfaceElevated, borderRadius: radii.xl, padding: spacing.xxl }]}
          accessibilityViewIsModal
          testID={testID}
        >
          <Text variant="h2" weight="bold" accessibilityRole="header">
            {title}
          </Text>
          {body ? (
            <Text variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
              {body}
            </Text>
          ) : null}
          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            <Button title={confirmLabel} onPress={onConfirm} variant={destructive ? 'danger' : 'primary'} testID={`${testID}-confirm`} />
            <Button title={cancelLabel} onPress={onCancel} variant="ghost" testID={`${testID}-cancel`} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 420 },
});
