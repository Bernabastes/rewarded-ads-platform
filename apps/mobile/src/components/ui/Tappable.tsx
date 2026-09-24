import { useCallback } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface TappableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Scale on press (default 0.97). */
  pressScale?: number;
}

/** Pressable with a subtle spring scale feedback. Respects the system reduce-motion setting. */
export function Tappable({ style, pressScale = 0.97, onPressIn, onPressOut, disabled, ...rest }: TappableProps) {
  const scale = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = useCallback<NonNullable<PressableProps['onPressIn']>>(
    (event) => {
      if (!reduceMotion) scale.value = withSpring(pressScale, { damping: 18, stiffness: 300 });
      onPressIn?.(event);
    },
    [onPressIn, pressScale, reduceMotion, scale],
  );
  const handlePressOut = useCallback<NonNullable<PressableProps['onPressOut']>>(
    (event) => {
      if (!reduceMotion) scale.value = withSpring(1, { damping: 18, stiffness: 300 });
      onPressOut?.(event);
    },
    [onPressOut, reduceMotion, scale],
  );

  return (
    <AnimatedPressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[animatedStyle, style]}
      {...rest}
    />
  );
}
