import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

export interface ProgressBarProps {
  /** 0..1 */
  progress: number;
  height?: number;
  color?: string;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function ProgressBar({ progress, height = 8, color, trackColor, style, accessibilityLabel }: ProgressBarProps) {
  const { colors, radii } = useTheme();
  const reduceMotion = useReducedMotion();
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const width = useSharedValue(clamped);

  useEffect(() => {
    width.value = reduceMotion ? clamped : withTiming(clamped, { duration: 350 });
  }, [clamped, reduceMotion, width]);

  const fill = useAnimatedStyle(() => ({ width: `${Math.round(width.value * 1000) / 10}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        styles.track,
        { height, borderRadius: radii.full, backgroundColor: trackColor ?? colors.surfaceMuted },
        style,
      ]}
    >
      <Animated.View style={[styles.fill, { borderRadius: radii.full, backgroundColor: color ?? colors.primary }, fill]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { height: '100%' },
});
