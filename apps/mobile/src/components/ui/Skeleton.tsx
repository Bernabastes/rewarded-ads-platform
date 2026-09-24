import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  circle?: boolean;
}

/** Soft pulsing placeholder block. Used instead of bare spinners everywhere content is loading. */
export function Skeleton({ width = '100%', height = 16, radius, style, circle = false }: SkeletonProps) {
  const { colors, radii } = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 0.7;
      return;
    }
    opacity.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const size = circle ? height : undefined;

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: circle ? size : width,
          height,
          borderRadius: circle ? height / 2 : (radius ?? radii.sm),
          backgroundColor: colors.skeleton,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Convenience wrapper announcing the loading state to screen readers once. */
export function SkeletonGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t('a11y.loading')} accessibilityRole="progressbar" style={[styles.group, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ group: { gap: 12 } });
