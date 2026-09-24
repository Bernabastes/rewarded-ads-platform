import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { Illustration } from '@/components/illustrations/Illustration';
import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';

const POINTS: { icon: IconName; key: string }[] = [
  { icon: 'play', key: 'onboarding.welcome.point1' },
  { icon: 'wallet', key: 'onboarding.welcome.point2' },
  { icon: 'shield', key: 'onboarding.welcome.point3' },
];

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const setHasSeenWelcome = usePrefsStore((s) => s.setHasSeenWelcome);

  const start = () => {
    setHasSeenWelcome(true);
    router.push('/(onboarding)/language');
  };

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      testID="welcome-screen"
      footer={<Button title={t('onboarding.welcome.cta')} onPress={start} size="lg" icon="chevronRight" iconPosition="right" testID="welcome-cta" />}
    >
      <View style={{ paddingTop: spacing.lg }}>
        <BrandMark size="md" />
      </View>
      <Animated.View entering={FadeInUp.duration(500)} style={styles.hero}>
        <Illustration name="welcome" size={220} />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(150).duration(500)} style={{ gap: spacing.md }}>
        <Text variant="display" weight="bold" accessibilityRole="header">
          {t('onboarding.welcome.title')}
        </Text>
        <Text variant="body" tone="secondary">
          {t('onboarding.welcome.subtitle')}
        </Text>
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(300).duration(500)} style={{ marginTop: spacing.xxl, gap: spacing.md }}>
        {POINTS.map((point) => (
          <View key={point.key} style={styles.pointRow}>
            <View style={[styles.pointIcon, { backgroundColor: colors.primarySoft, borderRadius: radii.md }]}>
              <Icon name={point.icon} size={18} color={colors.primarySoftText} filled={point.icon === 'play'} />
            </View>
            <Text variant="body" weight="medium" style={{ flex: 1 }}>
              {t(point.key)}
            </Text>
          </View>
        ))}
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
          {t('onboarding.welcome.honest')}
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginVertical: 8 },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
