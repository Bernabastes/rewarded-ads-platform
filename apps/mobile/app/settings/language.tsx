import type { Language } from '@rap/shared';
import { useTranslation } from 'react-i18next';

import { useUpdateProfile } from '@/api/queries/users';
import { applyUserUpdate } from '@/auth/session';
import { Screen } from '@/components/ui/Screen';
import { toast } from '@/components/ui/Toast';
import { LanguagePicker } from '@/features/profile/LanguagePicker';

/** Switching updates i18n instantly and persists `languagePreference` on the server. */
export default function LanguageSettingsScreen() {
  const { t } = useTranslation();
  const update = useUpdateProfile();

  const onChange = (language: Language) => {
    update.mutate(
      { languagePreference: language },
      {
        onSuccess: async (user) => {
          await applyUserUpdate(user);
          toast.success(t('profile.languageUpdated'));
        },
      },
    );
  };

  return (
    <Screen header={{ title: t('profile.language') }} testID="settings-language">
      <LanguagePicker onChange={onChange} />
    </Screen>
  );
}
