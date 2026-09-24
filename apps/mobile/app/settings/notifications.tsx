import type { NotificationPrefs } from '@rap/shared';
import * as Device from 'expo-device';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { useUpdateProfile } from '@/api/queries/users';
import { useAuthStore } from '@/auth/authStore';
import { applyUserUpdate } from '@/auth/session';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { SettingsGroup, SettingsRow } from '@/features/profile/SettingsRow';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

const PREFS: (keyof NotificationPrefs)[] = ['rewards', 'withdrawals', 'offers'];

export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const prefs = useAuthStore((s) => s.user?.notificationPrefs);
  const update = useUpdateProfile();
  const pushSupported = Platform.OS !== 'web' && Device.isDevice;

  const toggle = (key: keyof NotificationPrefs, value: boolean) => {
    update.mutate(
      { notificationPrefs: { [key]: value } },
      {
        onSuccess: async (user) => {
          await applyUserUpdate(user);
          toast.success(t('profile.prefsUpdated'));
        },
        onError: (error) => toast.danger(errorMessage(error, t)),
      },
    );
  };

  return (
    <Screen header={{ title: t('profile.notifications') }} testID="settings-notifications">
      <View style={{ gap: spacing.lg }}>
        <SettingsGroup>
          {PREFS.map((key) => (
            <SettingsRow
              key={key}
              icon={key === 'rewards' ? 'star' : key === 'withdrawals' ? 'wallet' : 'gift'}
              label={t(`profile.notificationPrefs.${key}`)}
              switchValue={prefs?.[key] ?? true}
              onSwitch={(value) => toggle(key, value)}
              disabled={update.isPending}
              testID={`notif-${key}`}
            />
          ))}
        </SettingsGroup>
        {!pushSupported ? (
          <Card tone="muted">
            <Text variant="bodySmall" tone="secondary">
              {t('profile.notificationPrefs.pushHint')}
            </Text>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
