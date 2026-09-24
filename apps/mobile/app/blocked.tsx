import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { useAuthStore } from '@/auth/authStore';
import { signOutEverywhere } from '@/auth/session';
import { Illustration } from '@/components/illustrations/Illustration';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME, SUPPORT } from '@/config';
import { useTheme } from '@/theme/ThemeProvider';

/** Respectful, calm blocking screen for age-restricted, suspended and banned accounts. */
export default function BlockedScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const blocked = useAuthStore((s) => s.blocked) ?? 'suspended';

  const copy = {
    age_restricted: {
      title: t('blocked.ageRestricted.title', { brand: BRAND_NAME }),
      body: t('blocked.ageRestricted.body'),
      extra: t('blocked.ageRestricted.support'),
    },
    suspended: { title: t('blocked.suspended.title'), body: t('blocked.suspended.body'), extra: null },
    banned: { title: t('blocked.banned.title'), body: t('blocked.banned.body'), extra: null },
  }[blocked];

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      testID={`blocked-${blocked}`}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            title={t('blocked.contactSupport')}
            icon="send"
            onPress={() => Linking.openURL(SUPPORT.telegram)}
            accessibilityHint={t('a11y.openLink')}
          />
          <Button title={t('blocked.signOut')} variant="ghost" onPress={() => void signOutEverywhere()} />
        </View>
      }
    >
      <View style={{ alignItems: 'center', paddingTop: spacing.huge, gap: spacing.lg }}>
        <Illustration name="blocked" size={180} />
        <Text variant="h1" weight="bold" align="center" accessibilityRole="header">
          {copy.title}
        </Text>
        <Text variant="body" tone="secondary" align="center">
          {copy.body}
        </Text>
        {copy.extra ? (
          <Text variant="bodySmall" tone="muted" align="center">
            {copy.extra}
          </Text>
        ) : null}
        <Text variant="bodySmall" tone="muted" align="center">
          {SUPPORT.phone}
        </Text>
      </View>
    </Screen>
  );
}
