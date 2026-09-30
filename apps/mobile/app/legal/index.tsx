import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useLegalDocuments } from '@/api/queries/legal';
import { useMe } from '@/api/queries/users';
import { selectNeedsConsent, useAuthStore } from '@/auth/authStore';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { consentFor } from '@/features/legal/consent';
import { LegalDocumentCard } from '@/features/legal/LegalDocumentCard';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

/** Profile → Legal: re-read the current terms / privacy notice and see which version you accepted. */
export default function LegalScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { spacing } = useTheme();
  const user = useAuthStore((s) => s.user);
  const needsConsent = useAuthStore(selectNeedsConsent);
  const legal = useLegalDocuments(language);
  useMe();

  return (
    <Screen header={{ title: t('legal.title') }} testID="legal-screen">
      <View style={{ gap: spacing.lg }}>
        {needsConsent ? (
          <Card tone="accent" testID="legal-needs-consent">
            <Text variant="body" weight="semibold">
              {t('legal.updateAvailable')}
            </Text>
            <Text variant="bodySmall" tone="secondary" style={{ marginTop: 4 }}>
              {t('legal.updateAvailableBody')}
            </Text>
            <Button title={t('legal.reviewAndAccept')} onPress={() => router.push('/consent')} size="sm" style={{ marginTop: spacing.md }} />
          </Card>
        ) : null}

        {legal.isPending ? (
          <SkeletonGroup>
            <Skeleton height={160} radius={16} />
            <Skeleton height={160} radius={16} />
          </SkeletonGroup>
        ) : legal.isError ? (
          <EmptyState
            illustration="error"
            title={t('common.somethingWrong')}
            body={errorMessage(legal.error, t)}
            action={{ title: t('common.retry'), onPress: () => void legal.refetch(), icon: 'refresh' }}
            compact
          />
        ) : (
          legal.data?.documents.map((doc) => (
            <LegalDocumentCard key={doc.kind} document={doc} consent={consentFor(user?.consents, doc.kind)} />
          ))
        )}
        <Text variant="caption" tone="muted">
          {t('legal.footnote')}
        </Text>
      </View>
    </Screen>
  );
}
