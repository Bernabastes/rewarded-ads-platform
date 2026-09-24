import type { AttentionQuestionPublic, WatchSessionResponse } from '@rap/shared';

import { kvStorage, type KeyValueStorage } from '@/utils/storage';

export type WatchPhase = 'watching' | 'question' | 'completing';

export interface PersistedWatchSession {
  sessionId: string;
  adId: string;
  adTitle: string;
  advertiserName: string;
  mediaUrl: string;
  startedAt: string;
  expiresAt: string;
  heartbeatIntervalSeconds: number;
  minWatchSeconds: number;
  expectedDurationSeconds: number;
  rewardCoins: number;
  attentionQuestion: AttentionQuestionPublic | null;
  phase: WatchPhase;
  lastHeartbeatAt: string | null;
  positionSeconds: number;
  attentionAnswerIndex?: number;
}

export type ResumeDecision = 'resume' | 'retry_complete' | 'discard';

const KEY = 'gize.watch.session.v1';

/** Grace window (in heartbeat intervals) within which a relaunch can safely continue the same session. */
export const RESUME_GRACE_INTERVALS = 1.5;

export function createPersistedSession(
  session: WatchSessionResponse,
  ad: { id: string; title: string; advertiserName: string; mediaUrl: string },
): PersistedWatchSession {
  return {
    sessionId: session.sessionId,
    adId: ad.id,
    adTitle: ad.title,
    advertiserName: ad.advertiserName,
    mediaUrl: ad.mediaUrl,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    heartbeatIntervalSeconds: session.heartbeatIntervalSeconds,
    minWatchSeconds: session.minWatchSeconds,
    expectedDurationSeconds: session.expectedDurationSeconds,
    rewardCoins: session.rewardCoins,
    attentionQuestion: session.attentionQuestion,
    phase: 'watching',
    lastHeartbeatAt: null,
    positionSeconds: 0,
  };
}

/**
 * What to do with a session found on disk at launch:
 *  - expired on the server clock -> discard (the server has already expired it);
 *  - we had already asked the server to complete it -> retry the (idempotent) completion so the
 *    user sees the real result and is never credited twice;
 *  - heartbeat gap still inside the grace window -> resume playback;
 *  - otherwise -> discard: heartbeat continuity is already broken, resuming would only be rejected.
 */
export function decideResume(session: PersistedWatchSession, nowMs: number = Date.now()): ResumeDecision {
  const expiresAt = Date.parse(session.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt <= nowMs) return 'discard';
  if (session.phase === 'completing') return 'retry_complete';
  const anchor = Date.parse(session.lastHeartbeatAt ?? session.startedAt);
  if (Number.isNaN(anchor)) return 'discard';
  const gapMs = nowMs - anchor;
  if (gapMs <= session.heartbeatIntervalSeconds * 1000 * RESUME_GRACE_INTERVALS) return 'resume';
  return 'discard';
}

export async function saveWatchSession(session: PersistedWatchSession, storage: KeyValueStorage = kvStorage) {
  await storage.setItem(KEY, JSON.stringify(session));
}

export async function loadWatchSession(storage: KeyValueStorage = kvStorage): Promise<PersistedWatchSession | null> {
  const raw = await storage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedWatchSession;
    return parsed && typeof parsed.sessionId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearWatchSession(storage: KeyValueStorage = kvStorage) {
  await storage.removeItem(KEY);
}
