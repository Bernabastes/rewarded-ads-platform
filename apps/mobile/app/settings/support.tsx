import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { Illustration } from '@/components/illustrations/Illustration';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { SUPPORT } from '@/config';
import { useTheme } from '@/theme/ThemeProvider';

export default function SupportScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  return (
    <Screen header={{ title: t('profile.support') }} testID="settings-support">
      <View style={{ alignItems: 'center', gap: spacing.lg, paddingTop: spacing.lg }}>
        <Illustration name="notifications" size={140} />
        <Text variant="body" tone="secondary" align="center">
          {t('blocked.ageRestricted.support')}
        </Text>
        <Button title={t('profile.supportTelegram')} icon="send" onPress={() => void Linking.openURL(SUPPORT.telegram)} accessibilityHint={t('a11y.openLink')} />
        <Button title={t('profile.supportPhone')} icon="phone" variant="secondary" onPress={() => void Linking.openURL(`tel:${SUPPORT.phone}`)} accessibilityHint={t('a11y.openLink')} />
        <Text variant="caption" tone="muted">
          {SUPPORT.phone}
        </Text>
      </View>
    </Screen>
  );
}
