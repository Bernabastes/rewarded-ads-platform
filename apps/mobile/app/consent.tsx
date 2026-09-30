import type { LegalDocumentKind } from '@rap/shared';
import { ErrorCode } from '@rap/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { usersApi } from '@/api/endpoints/users';
import { isApiError } from '@/api/errors';
import { useLegalDocuments } from '@/api/queries/legal';
import { useRefreshMe } from '@/api/queries/users';
import { useAuthStore } from '@/auth/authStore';
import { cacheUser, signOutEverywhere } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/Toast';
import { BRAND_NAME } from '@/config';
import { documentsToAccept } from '@/features/legal/consent';
import { LegalDocumentCard } from '@/features/legal/LegalDocumentCard';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

/**
 * Consent gate. Shown after otp/verify + complete-profile when `user.requiresConsent` is non-empty, and
 * pushed on top of the app whenever a money endpoint answers 403 CONSENT_REQUIRED. Accepting posts one
 * `POST /users/me/consents { kind, version }` per document, refreshes the profile and returns.
 */
export default function ConsentScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const language = useLanguage();
  const { spacing } = useTheme();
  const user = useAuthStore((s) => s.user);
  const refreshMe = useRefreshMe();
  const legal = useLegalDocuments(language);

  const [checked, setChecked] = useState<Set<LegalDocumentKind>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const required = useMemo(() => user?.requiresConsent ?? [], [user?.requiresConsent]);
  const documents = useMemo(
    () => documentsToAccept(legal.data?.documents ?? [], required),
    [legal.data?.documents, required],
  );
  const allChecked = documents.length > 0 && documents.every((doc) => checked.has(doc.kind));

  const finish = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const accept = async () => {
    if (!allChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    const acceptedNow = new Set<LegalDocumentKind>();
    try {
      for (const doc of documents) {
        await usersApi.acceptConsent({ kind: doc.kind, version: doc.version });
        acceptedNow.add(doc.kind);
      }
      const fresh = await refreshMe();
      await cacheUser(fresh);
      toast.success(t('consent.accepted'));
      finish();
    } catch (err) {
      if (isApiError(err) && err.code === ErrorCode.CONSENT_VERSION_OUTDATED) {
        // A newer version was published while the user was reading: reload and ask again.
        setChecked(new Set());
        await legal.refetch();
        setError(t('consent.versionOutdated'));
      } else {
        setError(errorMessage(err, t));
      }
      if (acceptedNow.size) {
        // Partial success: the profile now lists only the kinds still missing, so the cards shrink accordingly.
        try {
          const fresh = await refreshMe();
          await cacheUser(fresh);
        } catch {
          /* the next launch re-reads /users/me anyway */
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const mandatory = required.length > 0;

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      header={{
        title: t('consent.title'),
        subtitle: t('consent.subtitle', { brand: BRAND_NAME }),
        large: true,
        hideBack: mandatory,
      }}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            title={t('consent.cta')}
            onPress={() => void accept()}
            disabled={!allChecked || legal.isPending || legal.isError}
            loading={submitting}
            size="lg"
            icon="circleCheck"
            testID="consent-submit"
          />
          {mandatory ? (
            <Button title={t('consent.declineSignOut')} onPress={() => void signOutEverywhere()} variant="ghost" size="sm" testID="consent-signout" />
          ) : null}
        </View>
      }
      testID="consent-screen"
    >
      {legal.isPending ? (
        <SkeletonGroup>
          <Skeleton height={180} radius={16} />
          <Skeleton height={180} radius={16} />
        </SkeletonGroup>
      ) : legal.isError ? (
        <EmptyState
          illustration="error"
          title={t('common.somethingWrong')}
          body={errorMessage(legal.error, t)}
          action={{ title: t('common.retry'), onPress: () => void legal.refetch(), icon: 'refresh' }}
          compact
        />
      ) : documents.length === 0 ? (
        <EmptyState
          illustration="success"
          title={t('consent.nothingToAccept')}
          body={t('consent.nothingToAcceptBody')}
          action={{ title: t('common.continue'), onPress: finish }}
          compact
          testID="consent-nothing"
        />
      ) : (
        <Animated.View entering={FadeInDown.duration(300)} style={{ gap: spacing.lg }}>
          {documents.map((doc) => (
            <LegalDocumentCard
              key={doc.kind}
              document={doc}
              accepted={checked.has(doc.kind)}
              onToggleAccepted={(next) =>
                setChecked((prev) => {
                  const copy = new Set(prev);
                  if (next) copy.add(doc.kind);
                  else copy.delete(doc.kind);
                  return copy;
                })
              }
              disabled={submitting}
            />
          ))}
          <Text variant="caption" tone="muted">
            {t('consent.footnote')}
          </Text>
          {error ? (
            <Text variant="bodySmall" tone="danger" accessibilityLiveRegion="polite" testID="consent-error">
              {error}
            </Text>
          ) : null}
        </Animated.View>
      )}
    </Screen>
  );
}
