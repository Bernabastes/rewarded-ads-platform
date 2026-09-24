import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { useUpdateProfile } from '@/api/queries/users';
import { useAuthStore } from '@/auth/authStore';
import { applyUserUpdate } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { toast } from '@/components/ui/Toast';
import { errorMessage } from '@/utils/errorMessage';

export default function EditNameScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const current = useAuthStore((s) => s.user?.fullName ?? '');
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateProfile();
  const valid = name.trim().length >= 2;

  const save = () => {
    if (!valid) {
      setError(t('onboarding.profile.fullNameInvalid'));
      return;
    }
    update.mutate(
      { fullName: name.trim() },
      {
        onSuccess: async (user) => {
          await applyUserUpdate(user);
          toast.success(t('profile.prefsUpdated'));
          router.back();
        },
        onError: (err) => setError(isApiError(err) && err.fieldMessage('fullName') ? t('onboarding.profile.fullNameInvalid') : errorMessage(err, t)),
      },
    );
  };

  return (
    <Screen header={{ title: t('profile.editName') }} keyboardAvoiding testID="settings-edit-name" footer={<Button title={t('common.save')} onPress={save} loading={update.isPending} disabled={!valid || name.trim() === current} size="lg" testID="edit-name-save" />}>
      <Input label={t('profile.nameLabel')} value={name} onChangeText={(v) => { setName(v); setError(null); }} autoFocus autoCapitalize="words" errorText={error} returnKeyType="done" onSubmitEditing={save} testID="edit-name-input" />
    </Screen>
  );
}
