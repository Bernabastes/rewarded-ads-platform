import type { AdCompletionResult, AdDetail, ErrorCode, WatchSessionResponse } from '@rap/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { adsApi } from '@/api/endpoints/ads';
import { ApiError, isApiError } from '@/api/errors';
import { getDeviceIdentity } from '@/device/fingerprint';

import {
  clearWatchSession,
  createPersistedSession,
  saveWatchSession,
  type PersistedWatchSession,
} from './watchSessionStorage';
import { completeWithRetry } from './watchResult';

export type WatchPhase = 'idle' | 'starting' | 'watching' | 'question' | 'completing' | 'done' | 'startError';

export interface WatchSessionState {
  phase: WatchPhase;
  session: PersistedWatchSession | null;
  /** Seconds elapsed on the server clock (from heartbeats), falling back to local time. */
  elapsedSeconds: number;
  /** Remaining seconds before the server will accept a completion. */
  unlockInSeconds: number;
  offline: boolean;
  startError: ApiError | null;
  completeError: ApiError | null;
  heartbeatCount: number;
}

export interface UseWatchSessionOptions {
  ad: AdDetail | undefined;
  /** Continue a session restored from disk instead of starting a new one. */
  resumeFrom?: PersistedWatchSession | null;
  onCompleted(result: AdCompletionResult, session: PersistedWatchSession): void;
  /** Called when the session was completed with an unrecoverable error (e.g. WATCH_SESSION_NOT_FOUND). */
  onCompleteFailed?(error: ApiError, session: PersistedWatchSession): void;
  /** Hooks into the media player so heartbeats can report position and network loss can pause playback. */
  getPositionSeconds?(): number;
  onNetworkLost?(): void;
  onNetworkRestored?(): void;
}

/**
 * Orchestrates one rewarded watch: start session -> heartbeat every `heartbeatIntervalSeconds`
 * -> (attention question) -> idempotent completion. The in-progress session is persisted after
 * every state change so an interrupted app can resume or safely discard it at relaunch.
 */
export function useWatchSession(options: UseWatchSessionOptions) {
  const { ad, resumeFrom, onCompleted, onCompleteFailed, getPositionSeconds, onNetworkLost, onNetworkRestored } =
    options;
  const [phase, setPhase] = useState<WatchPhase>(resumeFrom?.phase === 'completing' ? 'completing' : 'idle');
  const [session, setSession] = useState<PersistedWatchSession | null>(resumeFrom ?? null);
  const [elapsedSeconds, setElapsed] = useState(0);
  const [offline, setOffline] = useState(false);
  const [startError, setStartError] = useState<ApiError | null>(null);
  const [completeError, setCompleteError] = useState<ApiError | null>(null);
  const [heartbeatCount, setHeartbeatCount] = useState(0);

  const sessionRef = useRef<PersistedWatchSession | null>(resumeFrom ?? null);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const localStart = useRef<number | null>(null);
  const serverElapsedAtHeartbeat = useRef<{ elapsed: number; at: number } | null>(null);
  const completing = useRef(false);
  const offlineRef = useRef(false);
  const mounted = useRef(true);

  const persist = useCallback(async (next: PersistedWatchSession) => {
    sessionRef.current = next;
    setSession(next);
    await saveWatchSession(next).catch(() => undefined);
  }, []);

  const stopTimers = useCallback(() => {
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    if (clockTimer.current) clearInterval(clockTimer.current);
    heartbeatTimer.current = null;
    clockTimer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopTimers();
    };
  }, [stopTimers]);

  /** Estimate of elapsed server time, anchored on the last heartbeat response. */
  const computeElapsed = useCallback(() => {
    const anchor = serverElapsedAtHeartbeat.current;
    if (anchor) return anchor.elapsed + (Date.now() - anchor.at) / 1000;
    if (localStart.current !== null) return (Date.now() - localStart.current) / 1000;
    return 0;
  }, []);

  const sendHeartbeat = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || completing.current) return;
    try {
      const response = await adsApi.heartbeat(current.sessionId, {
        positionSeconds: Math.round(getPositionSeconds?.() ?? 0),
      });
      if (!mounted.current) return;
      serverElapsedAtHeartbeat.current = { elapsed: response.elapsedSeconds, at: Date.now() };
      setHeartbeatCount(response.heartbeatCount);
      if (offlineRef.current) {
        offlineRef.current = false;
        setOffline(false);
        onNetworkRestored?.();
      }
      void persist({
        ...current,
        lastHeartbeatAt: response.serverTime,
        positionSeconds: Math.round(getPositionSeconds?.() ?? current.positionSeconds),
      });
    } catch (error) {
      if (!mounted.current) return;
      if (isApiError(error) && error.isNetworkError) {
        if (!offlineRef.current) {
          offlineRef.current = true;
          setOffline(true);
          onNetworkLost?.();
        }
        return;
      }
      // Business errors (session expired / not active) are surfaced at completion time.
    }
  }, [getPositionSeconds, onNetworkLost, onNetworkRestored, persist]);

  const startTimers = useCallback(
    (intervalSeconds: number) => {
      stopTimers();
      heartbeatTimer.current = setInterval(() => void sendHeartbeat(), Math.max(2, intervalSeconds) * 1000);
      clockTimer.current = setInterval(() => {
        if (mounted.current) setElapsed(computeElapsed());
      }, 500);
    },
    [computeElapsed, sendHeartbeat, stopTimers],
  );

  const complete = useCallback(
    async (attentionAnswerIndex?: number) => {
      const current = sessionRef.current;
      if (!current || completing.current) return;
      completing.current = true;
      stopTimers();
      setPhase('completing');
      setCompleteError(null);
      const persisted: PersistedWatchSession = { ...current, phase: 'completing', attentionAnswerIndex };
      await persist(persisted);
      try {
        const result = await completeWithRetry(() =>
          adsApi.complete(current.sessionId, attentionAnswerIndex === undefined ? {} : { attentionAnswerIndex }),
        );
        await clearWatchSession();
        if (!mounted.current) return;
        setPhase('done');
        onCompleted(result, persisted);
      } catch (error) {
        completing.current = false;
        if (!mounted.current) return;
        const apiError = isApiError(error) ? error : ApiError.network();
        if (apiError.isNetworkError) {
          // Keep the session on disk: the completion can be retried (idempotently) later.
          setCompleteError(apiError);
          return;
        }
        await clearWatchSession();
        setCompleteError(apiError);
        onCompleteFailed?.(apiError, persisted);
      }
    },
    [onCompleteFailed, onCompleted, persist, stopTimers],
  );

  const start = useCallback(async () => {
    if (!ad || phase !== 'idle') return;
    setPhase('starting');
    setStartError(null);
    try {
      const identity = await getDeviceIdentity();
      const response: WatchSessionResponse = await adsApi.startWatchSession(ad.id, {
        deviceFingerprint: identity.deviceFingerprint,
        deviceId: identity.deviceId,
      });
      const persisted = createPersistedSession(response, ad);
      localStart.current = Date.now();
      serverElapsedAtHeartbeat.current = null;
      completing.current = false;
      await persist(persisted);
      setElapsed(0);
      setPhase('watching');
      startTimers(response.heartbeatIntervalSeconds);
    } catch (error) {
      setStartError(isApiError(error) ? error : ApiError.network());
      setPhase('startError');
    }
  }, [ad, persist, phase, startTimers]);

  /** Resume a session restored from disk (decision === 'resume'). */
  const resume = useCallback(() => {
    const current = sessionRef.current;
    if (!current || phase !== 'idle') return;
    localStart.current = Date.parse(current.startedAt) || Date.now();
    serverElapsedAtHeartbeat.current = null;
    completing.current = false;
    setPhase('watching');
    startTimers(current.heartbeatIntervalSeconds);
    void sendHeartbeat();
  }, [phase, sendHeartbeat, startTimers]);

  /** Video finished: ask the attention question or complete straight away. */
  const onPlaybackEnded = useCallback(() => {
    const current = sessionRef.current;
    if (!current || phase !== 'watching') return;
    if (current.attentionQuestion) {
      setPhase('question');
      void persist({ ...current, phase: 'question' });
    } else {
      void complete();
    }
  }, [complete, persist, phase]);

  const answerQuestion = useCallback((index: number) => void complete(index), [complete]);

  /** Retry a completion that failed for network reasons. */
  const retryComplete = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    void complete(current.attentionAnswerIndex);
  }, [complete]);

  const abandon = useCallback(async () => {
    stopTimers();
    completing.current = true;
    await clearWatchSession();
    sessionRef.current = null;
    setSession(null);
    setPhase('idle');
  }, [stopTimers]);

  // Auto-resume a "completing" session restored from disk.
  useEffect(() => {
    if (resumeFrom?.phase === 'completing' && sessionRef.current && !completing.current) {
      void complete(resumeFrom.attentionAnswerIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minWatch = session?.minWatchSeconds ?? ad?.minWatchSeconds ?? 0;
  const unlockInSeconds = Math.max(0, Math.ceil(minWatch - elapsedSeconds));

  const state: WatchSessionState = useMemo(
    () => ({ phase, session, elapsedSeconds, unlockInSeconds, offline, startError, completeError, heartbeatCount }),
    [phase, session, elapsedSeconds, unlockInSeconds, offline, startError, completeError, heartbeatCount],
  );

  return { state, start, resume, onPlaybackEnded, answerQuestion, retryComplete, abandon };
}

export function startErrorCode(error: ApiError | null): ErrorCode | null {
  if (!error) return null;
  return error.code as ErrorCode;
}
