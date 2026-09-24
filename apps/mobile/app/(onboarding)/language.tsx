import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { LanguagePicker } from '@/features/profile/LanguagePicker';

export default function LanguageScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      header={{ title: t('onboarding.language.title'), subtitle: t('onboarding.language.subtitle'), large: true }}
      footer={
        <Button
          title={t('common.continue')}
          onPress={() => router.push('/(onboarding)/phone')}
          size="lg"
          testID="language-continue"
        />
      }
      testID="language-screen"
    >
      <LanguagePicker />
    </Screen>
  );
}
