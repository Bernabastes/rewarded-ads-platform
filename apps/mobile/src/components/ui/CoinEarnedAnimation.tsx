import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme/ThemeProvider';

import { CoinMark } from './CoinMark';
import { Text } from './Text';
import { useCountUp } from './useCountUp';

export interface CoinEarnedAnimationProps {
  coins: number;
  etbLabel: string;
  testID?: string;
}

/**
 * The "coin earned" moment: the flat coin mark scales in with a soft spring and settles while the
 * amount counts up. Subtle and single-shot - no confetti, no spinning, no slot-machine cues.
 */
export function CoinEarnedAnimation({ coins, etbLabel, testID = 'coin-earned' }: CoinEarnedAnimationProps) {
  const { colors, spacing } = useTheme();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(reduceMotion ? 1 : 0.4);
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const halo = useSharedValue(reduceMotion ? 1 : 0.6);
  const haloOpacity = useSharedValue(reduceMotion ? 0.25 : 0);
  const shown = useCountUp(coins, 1100);

  useEffect(() => {
    if (reduceMotion) return;
    opacity.value = withTiming(1, { duration: 220 });
    scale.value = withSequence(
      withSpring(1.12, { damping: 9, stiffness: 160 }),
      withSpring(1, { damping: 14, stiffness: 180 }),
    );
    haloOpacity.value = withDelay(150, withTiming(0.28, { duration: 500, easing: Easing.out(Easing.quad) }));
    halo.value = withDelay(150, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [halo, haloOpacity, opacity, reduceMotion, scale]);

  const coinStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: opacity.value }));
  const haloStyle = useAnimatedStyle(() => ({ transform: [{ scale: halo.value }], opacity: haloOpacity.value }));

  return (
    <View style={styles.container} testID={testID} accessible accessibilityLabel={t('money.coins', { count: coins })}>
      <View style={styles.stage}>
        <Animated.View style={[styles.halo, { backgroundColor: colors.primarySoft }, haloStyle]} />
        <Animated.View style={coinStyle}>
          <CoinMark size={112} />
        </Animated.View>
      </View>
      <Text variant="display" weight="bold" style={{ marginTop: spacing.xl }} testID={`${testID}-amount`}>
        {t('money.plusCoins', { count: shown })}
      </Text>
      <Text variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>
        {etbLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  stage: { width: 180, height: 180, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 180, height: 180, borderRadius: 90 },
});
