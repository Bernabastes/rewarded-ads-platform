import type { AdDetail, AttentionQuestionPublic } from '@rap/shared';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { CoinMark } from '@/components/ui/CoinMark';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tappable } from '@/components/ui/Tappable';
import { Text } from '@/components/ui/Text';
import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';
import { errorMessage } from '@/utils/errorMessage';
import { formatClock, formatEtb } from '@/utils/format';

import type { WatchSessionState } from './useWatchSession';

export interface AdPlayerProps {
  ad: AdDetail;
  state: WatchSessionState;
  onStart(): void;
  onPlaybackEnded(): void;
  onAnswer(index: number): void;
  onRetryComplete(): void;
  onClose(): void;
  onRefreshFeed(): void;
  /** Player position reporter used for heartbeats. */
  positionRef: React.MutableRefObject<number>;
  /** Imperative pause/resume from the session hook when the network drops / returns. */
  networkPausedRef: React.MutableRefObject<boolean>;
  resumeAtSeconds?: number;
}

const VIDEO_BG = palette.stone[950];

export function AdPlayer({
  ad,
  state,
  onStart,
  onPlaybackEnded,
  onAnswer,
  onRetryComplete,
  onClose,
  onRefreshFeed,
  positionRef,
  networkPausedRef,
  resumeAtSeconds,
}: AdPlayerProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const isImage = ad.mediaType === 'image';

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(ad.durationSeconds);
  const [needsTap, setNeedsTap] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const endedRef = useRef(false);
  const imageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // The player is created with the source (paused) so the <video> element's src is stable from the
  // first render. Swapping the source later via replace() on web re-renders the src attribute, which
  // interrupts play() ("play() request was interrupted by a new load request").
  const player = useVideoPlayer(isImage ? null : { uri: ad.mediaUrl }, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.loop = false;
    p.staysActiveInBackground = false;
    p.pause();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    setPosition(currentTime);
    positionRef.current = currentTime;
    // The rewarded portion is the declared ad length. Media longer than that (e.g. a long sample clip)
    // is cut at the declared duration - the server also rejects sessions kept open for too long.
    const declared = state.session?.expectedDurationSeconds ?? ad.durationSeconds;
    const media = player.duration && Number.isFinite(player.duration) && player.duration > 0 ? player.duration : declared;
    setDuration(declared > 0 ? Math.min(media, declared) : media);
    if (declared > 0 && currentTime >= declared && !endedRef.current) {
      endedRef.current = true;
      player.pause();
      onPlaybackEnded();
    }
  });
  useEventListener(player, 'playToEnd', () => {
    if (endedRef.current) return;
    endedRef.current = true;
    onPlaybackEnded();
  });
  useEffect(() => {
    if (status === 'error') setPlaybackError(true);
  }, [status]);

  // Load and start the media once the server session exists.
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase !== 'watching' || !state.session || startedFor.current === state.session.sessionId) return;
    startedFor.current = state.session.sessionId;
    endedRef.current = false;
    if (isImage) {
      const startAt = Date.now() - (resumeAtSeconds ?? 0) * 1000;
      imageTimer.current = setInterval(() => {
        const elapsed = (Date.now() - startAt) / 1000;
        setPosition(Math.min(elapsed, ad.durationSeconds));
        positionRef.current = elapsed;
        if (elapsed >= ad.durationSeconds && !endedRef.current) {
          endedRef.current = true;
          if (imageTimer.current) clearInterval(imageTimer.current);
          onPlaybackEnded();
        }
      }, 250);
      return;
    }
    try {
      if (resumeAtSeconds && resumeAtSeconds > 0) player.currentTime = resumeAtSeconds;
      player.play();
      // Browsers may refuse autoplay with sound: offer an explicit tap after a short grace period.
      if (Platform.OS === 'web') {
        setTimeout(() => {
          if (!player.playing && !endedRef.current) setNeedsTap(true);
        }, 1500);
      }
    } catch {
      setPlaybackError(true);
    }
  }, [ad.durationSeconds, isImage, onPlaybackEnded, player, positionRef, resumeAtSeconds, state.phase, state.session]);

  useEffect(() => () => {
    if (imageTimer.current) clearInterval(imageTimer.current);
  }, []);

  // Pause while offline, resume when the connection comes back (the server clock keeps running).
  useEffect(() => {
    if (isImage || state.phase !== 'watching') return;
    if (state.offline) {
      networkPausedRef.current = true;
      player.pause();
    } else if (networkPausedRef.current) {
      networkPausedRef.current = false;
      player.play();
    }
  }, [isImage, networkPausedRef, player, state.offline, state.phase]);

  // Stop playback when the session leaves the watching phase.
  useEffect(() => {
    if (state.phase === 'question' || state.phase === 'completing' || state.phase === 'done') {
      if (!isImage) player.pause();
    }
  }, [isImage, player, state.phase]);

  const tapToPlay = useCallback(() => {
    setNeedsTap(false);
    player.play();
  }, [player]);

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const rewardEtb = formatEtb(ad.rewardEtb, t, language);
  const showStage = state.phase === 'watching' || state.phase === 'question' || state.phase === 'completing';

  const stageHeight = isLandscape ? height : Math.min(width * (9 / 16), height * 0.45);

  return (
    <View style={[styles.root, { backgroundColor: showStage ? VIDEO_BG : colors.background }]} testID="ad-player">
      {/* Top bar */}
      <View
        style={[
          styles.topBar,
          { paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg, position: showStage && isLandscape ? 'absolute' : 'relative' },
        ]}
      >
        <Tappable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
          hitSlop={8}
          testID="ad-close"
          style={[styles.closeButton, { backgroundColor: showStage ? 'rgba(255,255,255,0.14)' : colors.surface, borderColor: showStage ? 'transparent' : colors.border }]}
        >
          <Icon name="x" color={showStage ? '#FFFFFF' : colors.text} />
        </Tappable>
        <View style={{ flex: 1 }}>
          <Text variant="bodySmall" weight="semibold" numberOfLines={1} style={{ color: showStage ? '#FFFFFF' : colors.text }}>
            {ad.title}
          </Text>
          <Text variant="caption" numberOfLines={1} style={{ color: showStage ? 'rgba(255,255,255,0.7)' : colors.textMuted }}>
            {t('ad.by', { brand: ad.advertiserName })}
          </Text>
        </View>
        {showStage ? (
          <Badge label={t('money.plusCoins', { count: ad.rewardCoins })} tone="accent" />
        ) : null}
      </View>

      {/* Pre-roll */}
      {state.phase === 'idle' || state.phase === 'starting' ? (
        <Animated.ScrollView entering={FadeIn} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}>
          <View style={[styles.poster, { borderRadius: radii.lg, backgroundColor: colors.surfaceMuted }]}>
            {ad.thumbnailUrl ? (
              <Image source={{ uri: ad.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
            ) : (
              <Icon name="video" size={48} color={colors.textMuted} strokeWidth={1.4} />
            )}
            <View style={[styles.posterPlay, { backgroundColor: 'rgba(29,26,23,0.72)' }]}>
              <Icon name="play" size={28} color="#FFFFFF" filled accessibilityLabel={t('a11y.playVideo')} />
            </View>
          </View>

          <View style={styles.statsRow}>
            <Card style={{ flex: 1 }} padding={spacing.md}>
              <Text variant="caption" tone="muted">
                {t('ad.rewardTitle')}
              </Text>
              <View style={styles.inlineRow}>
                <CoinMark size={20} />
                <Text variant="h3" weight="bold" tone="primary">
                  {t('money.coins', { count: ad.rewardCoins })}
                </Text>
              </View>
              <Text variant="caption" tone="secondary">
                {rewardEtb}
              </Text>
            </Card>
            <Card style={{ flex: 1 }} padding={spacing.md}>
              <Text variant="caption" tone="muted">
                {t('ad.durationTitle')}
              </Text>
              <View style={styles.inlineRow}>
                <Icon name="clock" size={20} color={colors.text} />
                <Text variant="h3" weight="bold">
                  {formatClock(ad.durationSeconds)}
                </Text>
              </View>
              {ad.hasAttentionCheck ? <Badge label={t('home.attentionBadge')} tone="accent" icon="helpCircle" /> : null}
            </Card>
          </View>

          {ad.description ? (
            <View>
              <Text variant="label" weight="semibold" tone="secondary">
                {t('ad.aboutTitle')}
              </Text>
              <Text variant="body" style={{ marginTop: 4 }}>
                {ad.description}
              </Text>
            </View>
          ) : null}

          {ad.hasAttentionCheck ? (
            <Card tone="accent" padding={spacing.md}>
              <View style={styles.inlineRow}>
                <Icon name="helpCircle" size={20} color={colors.accentSoftText} />
                <Text variant="bodySmall" weight="medium" style={{ flex: 1, color: colors.accentSoftText }}>
                  {t('ad.attentionNotice')}
                </Text>
              </View>
            </Card>
          ) : null}

          <Text variant="caption" tone="muted">
            {t('ad.rules')}
          </Text>

          <Button
            title={state.phase === 'starting' ? t('ad.starting') : t('ad.start')}
            onPress={onStart}
            loading={state.phase === 'starting'}
            size="lg"
            icon="play"
            testID="ad-start"
          />
        </Animated.ScrollView>
      ) : null}

      {/* Start error */}
      {state.phase === 'startError' ? (
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
          <EmptyState
            illustration="error"
            title={t('ad.startErrors.title')}
            body={state.startError ? errorMessage(state.startError, t) : t('errors.generic')}
            action={{ title: t('ad.startErrors.refreshFeed'), onPress: onRefreshFeed, icon: 'refresh' }}
            secondaryAction={{ title: t('common.back'), onPress: onClose }}
            testID="ad-start-error"
          />
        </View>
      ) : null}

      {/* Stage */}
      {showStage ? (
        <View style={[styles.stageWrap, isLandscape ? styles.absoluteFill : null]}>
          <View style={[styles.stage, { height: stageHeight, width: '100%' }]}>
            {isImage ? (
              <Image source={{ uri: ad.mediaUrl }} style={StyleSheet.absoluteFill} contentFit="contain" />
            ) : (
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                nativeControls={false}
                contentFit="contain"
                allowsPictureInPicture={false}
                testID="ad-video"
              />
            )}
            {playbackError ? (
              <View style={[styles.overlay, { gap: spacing.md }]} testID="ad-playback-error">
                <Icon name="alert" size={32} color="#FFFFFF" />
                <Text variant="body" weight="medium" align="center" style={{ color: '#FFFFFF' }}>
                  {t('ad.playbackError')}
                </Text>
                <Button title={t('common.back')} onPress={onClose} variant="accent" fullWidth={false} size="sm" />
              </View>
            ) : null}
            {needsTap && !isPlaying && state.phase === 'watching' ? (
              <Tappable onPress={tapToPlay} style={styles.overlay} accessibilityRole="button" accessibilityLabel={t('a11y.playVideo')} testID="ad-tap-to-play">
                <View style={[styles.posterPlay, { backgroundColor: colors.accent }]}>
                  <Icon name="play" size={30} color="#FFFFFF" filled />
                </View>
              </Tappable>
            ) : null}
            {state.offline && state.phase === 'watching' ? (
              <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.overlay, { gap: spacing.sm }]} testID="ad-offline">
                <Icon name="wifiOff" size={36} color="#FFFFFF" />
                <Text variant="h3" weight="semibold" style={{ color: '#FFFFFF' }}>
                  {t('ad.connectionLost')}
                </Text>
                <Text variant="bodySmall" align="center" style={{ color: 'rgba(255,255,255,0.8)', maxWidth: 280 }}>
                  {t('ad.connectionLostBody')}
                </Text>
              </Animated.View>
            ) : null}
          </View>

          {/* Controls / info below or over the video */}
          <View
            style={[
              styles.infoPanel,
              isLandscape ? styles.infoPanelOverlay : null,
              { padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg },
            ]}
          >
            {state.phase === 'watching' ? (
              <>
                <ProgressBar progress={progress} color={colors.accent} trackColor="rgba(255,255,255,0.18)" height={6} />
                <View style={[styles.rowBetween, { marginTop: spacing.sm }]}>
                  <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
                    {formatClock(position)} / {formatClock(duration)}
                  </Text>
                  <View style={styles.inlineRow}>
                    <View style={[styles.liveDot, { backgroundColor: state.offline ? colors.warning : colors.success }]} />
                    <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }} testID="ad-unlock">
                      {state.unlockInSeconds > 0 ? t('ad.unlockIn', { seconds: state.unlockInSeconds }) : t('ad.unlocked')}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}

            {state.phase === 'question' && state.session?.attentionQuestion ? (
              <AttentionQuestion question={state.session.attentionQuestion} onAnswer={onAnswer} />
            ) : null}

            {state.phase === 'completing' ? (
              <Animated.View entering={FadeInDown} style={{ gap: spacing.md }} testID="ad-completing">
                {state.completeError ? (
                  <>
                    <Text variant="body" weight="medium" style={{ color: '#FFFFFF' }}>
                      {errorMessage(state.completeError, t)}
                    </Text>
                    <Button title={t('common.retry')} onPress={onRetryComplete} icon="refresh" variant="accent" testID="ad-retry-complete" />
                  </>
                ) : (
                  <>
                    <Skeleton height={18} width="60%" style={{ backgroundColor: 'rgba(255,255,255,0.18)' }} />
                    <Text variant="body" weight="medium" style={{ color: '#FFFFFF' }}>
                      {t('ad.completing')}
                    </Text>
                  </>
                )}
              </Animated.View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function AttentionQuestion({ question, onAnswer }: { question: AttentionQuestionPublic; onAnswer(index: number): void }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { colors, radii, spacing } = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const prompt = language === 'am' && question.promptAm ? question.promptAm : question.prompt;

  return (
    <Animated.View entering={FadeInDown.duration(350)} style={{ gap: spacing.md }} testID="attention-question">
      <View>
        <Text variant="label" weight="semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {t('ad.question.title')}
        </Text>
        <Text variant="h3" weight="semibold" style={{ color: '#FFFFFF', marginTop: 4 }} accessibilityRole="header">
          {prompt}
        </Text>
        <Text variant="caption" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {t('ad.question.subtitle')}
        </Text>
      </View>
      <View style={{ gap: spacing.sm }}>
        {question.options.map((option, index) => {
          const isSelected = selected === index;
          return (
            <Tappable
              key={`${index}-${option}`}
              onPress={() => setSelected(index)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, checked: isSelected }}
              testID={`attention-option-${index}`}
              style={[
                styles.option,
                {
                  borderRadius: radii.md,
                  backgroundColor: isSelected ? colors.accent : 'rgba(255,255,255,0.08)',
                  borderColor: isSelected ? colors.accent : 'rgba(255,255,255,0.2)',
                },
              ]}
            >
              <Text variant="body" weight={isSelected ? 'semibold' : 'regular'} style={{ color: '#FFFFFF', flex: 1 }}>
                {option}
              </Text>
              {isSelected ? <Icon name="check" color="#FFFFFF" /> : null}
            </Tappable>
          );
        })}
      </View>
      <Button
        title={t('ad.question.submit')}
        onPress={() => selected !== null && onAnswer(selected)}
        disabled={selected === null}
        variant="accent"
        testID="attention-submit"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 8, zIndex: 2, left: 0, right: 0, pointerEvents: 'box-none' },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  poster: { width: '100%', aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  posterPlay: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', gap: 12 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stageWrap: { flex: 1, justifyContent: 'center' },
  stage: { backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', padding: 24 },
  infoPanel: { width: '100%', pointerEvents: 'box-none' },
  infoPanelOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1.5, minHeight: 52 },
});
