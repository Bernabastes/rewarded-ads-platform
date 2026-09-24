import type { WatchSessionResponse } from '@rap/shared';
import { ErrorCode } from '@rap/shared';

import { ApiError } from '@/api/errors';
import { createMemoryStorage } from '@/utils/storage';

import { completeWithRetry } from '../watchResult';
import {
  clearWatchSession,
  createPersistedSession,
  decideResume,
  loadWatchSession,
  saveWatchSession,
  type PersistedWatchSession,
} from '../watchSessionStorage';

const NOW = Date.parse('2026-09-24T10:00:00Z');
const iso = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1000).toISOString();

const response: WatchSessionResponse = {
  sessionId: 'sess-1',
  adId: 'ad-1',
  startedAt: iso(-20),
  serverTime: iso(-20),
  expectedDurationSeconds: 30,
  minWatchSeconds: 27,
  heartbeatIntervalSeconds: 10,
  expiresAt: iso(600),
  rewardCoins: 50,
  attentionQuestion: { id: 'q1', prompt: 'Which product?', promptAm: 'የትኛው ምርት?', options: ['A', 'B', 'C'] },
};
const ad = { id: 'ad-1', title: 'Buna Time', advertiserName: 'Buna Time Roasters', mediaUrl: 'https://cdn/x.mp4' };

function session(overrides: Partial<PersistedWatchSession> = {}): PersistedWatchSession {
  return { ...createPersistedSession(response, ad), ...overrides };
}

describe('watch session persistence', () => {
  it('creates the persisted shape from the server response', () => {
    const persisted = createPersistedSession(response, ad);
    expect(persisted).toMatchObject({
      sessionId: 'sess-1',
      adId: 'ad-1',
      adTitle: 'Buna Time',
      phase: 'watching',
      lastHeartbeatAt: null,
      positionSeconds: 0,
      heartbeatIntervalSeconds: 10,
      minWatchSeconds: 27,
      rewardCoins: 50,
    });
    expect(persisted.attentionQuestion?.options).toHaveLength(3);
  });

  it('round-trips through storage and clears', async () => {
    const storage = createMemoryStorage();
    await saveWatchSession(session(), storage);
    expect(await loadWatchSession(storage)).toMatchObject({ sessionId: 'sess-1' });
    await clearWatchSession(storage);
    expect(await loadWatchSession(storage)).toBeNull();
  });

  it('ignores corrupt storage', async () => {
    const storage = createMemoryStorage({ 'gize.watch.session.v1': '{not json' });
    expect(await loadWatchSession(storage)).toBeNull();
  });
});

describe('decideResume', () => {
  it('discards sessions the server has already expired', () => {
    expect(decideResume(session({ expiresAt: iso(-1) }), NOW)).toBe('discard');
  });

  it('retries completion when the app died after asking the server to complete', () => {
    expect(decideResume(session({ phase: 'completing', attentionAnswerIndex: 1 }), NOW)).toBe('retry_complete');
  });

  it('resumes when the last heartbeat is still inside the grace window', () => {
    expect(decideResume(session({ lastHeartbeatAt: iso(-12) }), NOW)).toBe('resume');
    expect(decideResume(session({ lastHeartbeatAt: iso(-15) }), NOW)).toBe('resume');
  });

  it('discards when heartbeat continuity is already broken', () => {
    expect(decideResume(session({ lastHeartbeatAt: iso(-16) }), NOW)).toBe('discard');
    expect(decideResume(session({ lastHeartbeatAt: iso(-120) }), NOW)).toBe('discard');
  });

  it('uses the start time when no heartbeat was sent yet', () => {
    expect(decideResume(session({ startedAt: iso(-5), lastHeartbeatAt: null }), NOW)).toBe('resume');
    expect(decideResume(session({ startedAt: iso(-60), lastHeartbeatAt: null }), NOW)).toBe('discard');
  });

  it('discards unparsable timestamps', () => {
    expect(decideResume(session({ expiresAt: 'nope' }), NOW)).toBe('discard');
  });
});

describe('completeWithRetry', () => {
  const noSleep = async () => undefined;

  it('retries network failures and returns the (possibly replayed) result', async () => {
    const attempt = jest
      .fn()
      .mockRejectedValueOnce(ApiError.network())
      .mockRejectedValueOnce(new ApiError(503, ErrorCode.SERVICE_UNAVAILABLE, 'down'))
      .mockResolvedValueOnce({ status: 'valid', replayed: true });
    await expect(completeWithRetry(attempt, { sleep: noSleep })).resolves.toEqual({ status: 'valid', replayed: true });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('does not retry business rejections', async () => {
    const attempt = jest.fn().mockRejectedValue(new ApiError(404, ErrorCode.WATCH_SESSION_NOT_FOUND, 'gone'));
    await expect(completeWithRetry(attempt, { sleep: noSleep })).rejects.toMatchObject({ code: ErrorCode.WATCH_SESSION_NOT_FOUND });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of attempts', async () => {
    const attempt = jest.fn().mockRejectedValue(ApiError.network());
    await expect(completeWithRetry(attempt, { attempts: 3, sleep: noSleep })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
