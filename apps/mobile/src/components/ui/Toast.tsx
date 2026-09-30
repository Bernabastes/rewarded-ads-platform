import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { useTheme } from '@/theme/ThemeProvider';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

interface ToastState {
  current: ToastMessage | null;
  show(message: string, tone?: ToastTone, durationMs?: number): void;
  dismiss(id?: number): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
  current: null,
  show: (message, tone = 'info', durationMs = 3200) => set({ current: { id: nextId++, message, tone, durationMs } }),
  dismiss: (id) => set((s) => (id === undefined || s.current?.id === id ? { current: null } : s)),
}));

export const toast = {
  info: (message: string) => useToastStore.getState().show(message, 'info'),
  success: (message: string) => useToastStore.getState().show(message, 'success'),
  warning: (message: string) => useToastStore.getState().show(message, 'warning'),
  danger: (message: string) => useToastStore.getState().show(message, 'danger', 4500),
};

const ICONS: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'circleCheck',
  warning: 'alert',
  danger: 'circleX',
};

/** Single non-blocking toast anchored above the bottom safe area. Mount once in the root layout. */
export function ToastHost() {
  const current = useToastStore((s) => s.current);
  const dismiss = useToastStore((s) => s.dismiss);
  const { colors, radii, spacing, shadows } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => dismiss(current.id), current.durationMs);
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  if (!current) return null;
  const toneColor: Record<ToastTone, string> = {
    info: colors.info,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  };

  return (
    <View style={[styles.host, { bottom: insets.bottom + 84 }]}>
      <Animated.View
        entering={FadeInUp.duration(220)}
        exiting={FadeOutDown.duration(180)}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[
          styles.toast,
          shadows.md,
          {
            backgroundColor: colors.surfaceElevated,
            borderRadius: radii.md,
            borderLeftColor: toneColor[current.tone],
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          },
        ]}
      >
        <Icon name={ICONS[current.tone]} size={20} color={toneColor[current.tone]} />
        <Text variant="bodySmall" weight="medium" style={styles.message}>
          {current.message}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center', pointerEvents: 'box-none' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderLeftWidth: 4,
    maxWidth: 480,
    width: '100%',
  },
  message: { flex: 1 },
});
