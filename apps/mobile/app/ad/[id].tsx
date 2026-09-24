import type { AdCompletionResult } from '@rap/shared';
import { CompletionStatus } from '@rap/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ApiError } from '@/api/errors';
import { useAd } from '@/api/queries/ads';
import { queryKeys } from '@/api/queryClient';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useWatchSession } from '@/features/watch/useWatchSession';
import { useWatchResultStore } from '@/features/watch/watchResult';
import { decideResume, loadWatchSession, type PersistedWatchSession } from '@/features/watch/watchSessionStorage';
import { usePrefsStore } from '@/stores/prefsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { errorMessage } from '@/utils/errorMessage';

// The player (expo-video + controls) is loaded lazily so the feed stays light on low-end devices.
const AdPlayer = lazy(() => import('@/features/watch/AdPlayer').then((m) => ({ default: m.AdPlayer })));

export default function AdScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; resume?: string }>();
  const adId = params.id;
  const wantsResume = params.resume === '1';

  const ad = useAd(adId);
  const rememberAd = usePrefsStore((s) => s.rememberAd);
  const setResult = useWatchResultStore((s) => s.setResult);

  const [resumeFrom, setResumeFrom] = useState<PersistedWatchSession | null | undefined>(wantsResume ? undefined : null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const positionRef = useRef(0);
  const networkPausedRef = useRef(false);
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!wantsResume) return;
    void loadWatchSession().then((session) => {
      if (session && session.adId === adId && decideResume(session) !== 'discard') setResumeFrom(session);
      else setResumeFrom(null);
    });
  }, [adId, wantsResume]);

  useEffect(() => {
    if (ad.data) rememberAd({ id: ad.data.id, title: ad.data.title, advertiserName: ad.data.advertiserName });
  }, [ad.data, rememberAd]);

  const finish = useCallback(
    (result: AdCompletionResult, session: PersistedWatchSession) => {
      leavingRef.current = true;
      setResult(result, {
        adId: session.adId,
        adTitle: session.adTitle,
        advertiserName: session.advertiserName,
        rewardCoins: session.rewardCoins,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.feed });
      router.replace('/ad/result');
    },
    [queryClient, router, setResult],
  );

  const failed = useCallback(
    (error: ApiError, session: PersistedWatchSession) => {
      finish(
        {
          completionId: null,
          sessionId: session.sessionId,
          status: CompletionStatus.rejected,
          coinReward: 0,
          watchDurationSeconds: 0,
          newBalance: null,
          reasonCode: error.code as AdCompletionResult['reasonCode'],
          fraudFlags: [],
          replayed: false,
        },
        session,
      );
    },
    [finish],
  );

  const watch = useWatchSession({
    ad: ad.data,
    resumeFrom: resumeFrom ?? null,
    onCompleted: finish,
    onCompleteFailed: failed,
    getPositionSeconds: () => positionRef.current,
  });

  // Continue a session restored from disk once the ad detail is available.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumeFrom && ad.data && !resumedRef.current && resumeFrom.phase !== 'completing') {
      resumedRef.current = true;
      watch.resume();
    }
  }, [ad.data, resumeFrom, watch]);

  const isBusy = watch.state.phase === 'watching' || watch.state.phase === 'question' || watch.state.phase === 'completing';

  // Intercept back navigation (hardware back, gestures) while a session is active.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!isBusy || leavingRef.current) return;
      event.preventDefault();
      setConfirmLeave(true);
    });
    return unsubscribe;
  }, [isBusy, navigation]);

  const close = useCallback(() => {
    if (isBusy && !leavingRef.current) {
      setConfirmLeave(true);
      return;
    }
    leavingRef.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [isBusy, router]);

  const confirmLeaveNow = useCallback(async () => {
    setConfirmLeave(false);
    leavingRef.current = true;
    await watch.abandon();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [router, watch]);

  const refreshFeed = useCallback(() => {
    leavingRef.current = true;
    void queryClient.invalidateQueries({ queryKey: queryKeys.feed });
    router.replace('/(tabs)');
  }, [queryClient, router]);

  if (ad.isPending || resumeFrom === undefined) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top + spacing.lg, padding: spacing.lg }]}>
        <SkeletonGroup>
          <Skeleton height={200} radius={16} />
          <Skeleton height={28} width="70%" />
          <Skeleton height={18} width="40%" />
          <Skeleton height={56} />
        </SkeletonGroup>
      </View>
    );
  }

  if (ad.isError || !ad.data) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top, justifyContent: 'center' }]}>
        <EmptyState
          illustration="error"
          title={t('ad.startErrors.title')}
          body={ad.error ? errorMessage(ad.error, t) : t('errors.generic')}
          action={{ title: t('ad.startErrors.refreshFeed'), onPress: refreshFeed, icon: 'refresh' }}
          secondaryAction={{ title: t('common.back'), onPress: close }}
        />
      </View>
    );
  }

  return (
    <>
      <Suspense
        fallback={
          <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top + spacing.lg, padding: spacing.lg }]}>
            <SkeletonGroup>
              <Skeleton height={200} radius={16} />
              <Skeleton height={56} />
            </SkeletonGroup>
          </View>
        }
      >
        <AdPlayer
          ad={ad.data}
          state={watch.state}
          onStart={() => void watch.start()}
          onPlaybackEnded={watch.onPlaybackEnded}
          onAnswer={watch.answerQuestion}
          onRetryComplete={watch.retryComplete}
          onClose={close}
          onRefreshFeed={refreshFeed}
          positionRef={positionRef}
          networkPausedRef={networkPausedRef}
          resumeAtSeconds={resumeFrom?.positionSeconds}
        />
      </Suspense>
      <ConfirmDialog
        visible={confirmLeave}
        title={t('ad.leaveTitle')}
        body={t('ad.leaveBody')}
        confirmLabel={t('ad.leaveConfirm')}
        cancelLabel={t('ad.stay')}
        onConfirm={() => void confirmLeaveNow()}
        onCancel={() => setConfirmLeave(false)}
        destructive
        testID="leave-dialog"
      />
    </>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
