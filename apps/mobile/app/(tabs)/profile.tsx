import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { useMe } from '@/api/queries/users';
import { selectNeedsConsent, useAuthStore } from '@/auth/authStore';
import { signOutEverywhere } from '@/auth/session';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { BRAND_NAME, SUPPORT } from '@/config';
import { formatEthiopianForUi } from '@/features/auth/DateOfBirthInput';
import { formatPhoneForDisplay } from '@/features/auth/phone';
import { SettingsGroup, SettingsRow } from '@/features/profile/SettingsRow';
import { LANGUAGE_NAMES } from '@/i18n';
import { useLanguage } from '@/i18n/useLanguage';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { formatDate } from '@/utils/format';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const user = useAuthStore((s) => s.user);
  const needsConsent = useAuthStore(selectNeedsConsent);
  const themeMode = usePrefsStore((s) => s.themeMode);
  const [confirmLogout, setConfirmLogout] = useState(false);
  useMe();

  const initials = (user?.fullName ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  const goodStanding = (user?.trustScore ?? 100) >= 50;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen testID="profile-screen" header={null} edges={['top', 'left', 'right']}>
      <View style={{ gap: spacing.xl }}>
        <Text variant="h1" weight="bold" accessibilityRole="header">
          {t('profile.title')}
        </Text>

        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft, borderRadius: radii.full }]} accessibilityElementsHidden>
            <Text variant="h2" weight="bold" tone="primary">
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="h2" weight="bold" numberOfLines={1} testID="profile-name">
              {user?.fullName ?? ''}
            </Text>
            <Text variant="bodySmall" tone="secondary">
              {user ? formatPhoneForDisplay(user.phoneNumber) : ''}
            </Text>
            {user ? (
              <Text variant="caption" tone="muted">
                {t('profile.memberSince', { date: formatDate(user.createdAt, language) })}
              </Text>
            ) : null}
            <Badge label={goodStanding ? t('profile.standing.good') : t('profile.standing.review')} tone={goodStanding ? 'success' : 'warning'} icon={goodStanding ? 'shield' : 'eye'} />
          </View>
        </View>

        <SettingsGroup title={t('profile.sections.preferences')}>
          <SettingsRow icon="edit" label={t('profile.editName')} value={user?.fullName ?? undefined} onPress={() => router.push('/settings/edit-name')} testID="profile-edit-name" />
          {user?.dateOfBirth ? (
            <SettingsRow
              icon="calendar"
              label={t('profile.dob')}
              value={
                user.dateOfBirthEthiopian
                  ? `${formatEthiopianForUi(user.dateOfBirthEthiopian, language)} · ${formatDate(`${user.dateOfBirth}T00:00:00Z`, language)}`
                  : formatDate(`${user.dateOfBirth}T00:00:00Z`, language)
              }
              testID="profile-dob"
            />
          ) : null}
          <SettingsRow icon="globe" label={t('profile.language')} value={LANGUAGE_NAMES[language]} onPress={() => router.push('/settings/language')} testID="profile-language" />
          <SettingsRow icon={themeMode === 'dark' ? 'moon' : 'sun'} label={t('profile.theme')} value={t(`profile.themeOptions.${themeMode}`)} onPress={() => router.push('/settings/appearance')} testID="profile-theme" />
          <SettingsRow icon="bell" label={t('profile.notifications')} onPress={() => router.push('/settings/notifications')} testID="profile-notifications" />
        </SettingsGroup>

        <SettingsGroup title={t('profile.sections.account')}>
          <SettingsRow
            icon="shield"
            label={t('profile.verifyIdentity')}
            value={user ? t(`kyc.tier.${user.kycTier}`) : undefined}
            onPress={() => router.push('/kyc')}
            right={user?.kycTier === 'id_verified' ? <Badge label={t('kyc.tier.id_verified')} tone="success" icon="circleCheck" /> : undefined}
            testID="profile-kyc"
          />
          <SettingsRow icon="gift" label={t('profile.inviteFriends')} value={user?.referralCode ?? undefined} onPress={() => router.push('/referrals')} testID="profile-referrals" />
          <SettingsRow
            icon="clipboard"
            label={t('profile.legal')}
            onPress={() => router.push('/legal')}
            right={needsConsent ? <Badge label={t('legal.updateBadge')} tone="warning" icon="alert" /> : undefined}
            testID="profile-legal"
          />
          <SettingsRow icon="lock" label={t('profile.privacy')} onPress={() => router.push('/privacy')} testID="profile-privacy" />
        </SettingsGroup>

        <SettingsGroup title={t('profile.sections.support')}>
          <SettingsRow icon="send" label={t('profile.supportTelegram')} value={SUPPORT.telegram.replace(/^https?:\/\//, '')} onPress={() => void Linking.openURL(SUPPORT.telegram)} accessibilityHint={t('a11y.openLink')} right={<Icon name="external" size={18} color={colors.textMuted} />} />
          <SettingsRow icon="phone" label={t('profile.supportPhone')} value={SUPPORT.phone} onPress={() => void Linking.openURL(`tel:${SUPPORT.phone}`)} accessibilityHint={t('a11y.openLink')} right={<Icon name="external" size={18} color={colors.textMuted} />} />
          <SettingsRow icon="flag" label={t('profile.reportAd')} onPress={() => router.push('/report-ad')} testID="profile-report-ad" />
        </SettingsGroup>

        <SettingsGroup title={t('profile.sections.about')}>
          <SettingsRow icon="info" label={t('profile.about', { brand: BRAND_NAME })} onPress={() => router.push('/settings/about')} testID="profile-about" />
          <SettingsRow icon="logout" label={t('profile.logout')} onPress={() => setConfirmLogout(true)} destructive testID="profile-logout" />
        </SettingsGroup>

        <Text variant="caption" tone="muted" align="center">
          {t('profile.version', { version })}
        </Text>
      </View>

      <ConfirmDialog
        visible={confirmLogout}
        title={t('profile.logoutConfirmTitle')}
        body={t('profile.logoutConfirmBody')}
        confirmLabel={t('profile.logout')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setConfirmLogout(false);
          void signOutEverywhere();
        }}
        onCancel={() => setConfirmLogout(false)}
        destructive
        testID="logout-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
});
