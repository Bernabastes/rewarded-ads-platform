import { ErrorCode } from '@rap/shared';
import {
  expectedHeartbeats,
  minWatchSeconds,
  verifyWatchSession,
  type VerificationConfig,
  type VerificationInput,
} from './completion.verifier';

const cfg: VerificationConfig = {
  minWatchRatio: 0.9,
  maxWatchRatio: 3,
  watchGraceSeconds: 60,
  heartbeatIntervalSeconds: 10,
  minHeartbeatRatio: 0.6,
  dailyLimit: 15,
};
const T0 = new Date('2026-09-24T10:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function input(over: Partial<VerificationInput> = {}): VerificationInput {
  return {
    now: at(31),
    startedAt: T0,
    expiresAt: at(1800),
    adDurationSeconds: 30,
    heartbeatCount: 2,
    lastHeartbeatAt: at(30),
    attentionQuestion: null,
    attentionAnswerIndex: undefined,
    todayCompletions: 0,
    ...over,
  };
}

describe('watch session verification (server-side only)', () => {
  it('derives min watch seconds and expected heartbeats from server config', () => {
    expect(minWatchSeconds(30, 0.9)).toBe(27);
    expect(minWatchSeconds(15, 0.9)).toBe(14);
    expect(expectedHeartbeats(27, 10)).toBe(2);
    expect(expectedHeartbeats(14, 10)).toBe(1);
    expect(expectedHeartbeats(5, 10)).toBe(0);
  });

  it('accepts a properly watched ad', () => {
    const r = verifyWatchSession(input(), cfg);
    expect(r.ok).toBe(true);
    expect(r.code).toBeNull();
    expect(r.watchDurationSeconds).toBe(31);
  });

  it('rejects when the server-side duration is too short (client "finished" events are irrelevant)', () => {
    const r = verifyWatchSession(input({ now: at(20) }), cfg);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(ErrorCode.WATCH_DURATION_INSUFFICIENT);
  });

  it('rejects absurdly long sessions', () => {
    const r = verifyWatchSession(input({ now: at(30 * 3 + 61), lastHeartbeatAt: at(30 * 3 + 60) }), cfg);
    expect(r.code).toBe(ErrorCode.WATCH_DURATION_EXCESSIVE);
  });

  it('rejects expired sessions', () => {
    const r = verifyWatchSession(
      input({ now: at(1801), expiresAt: at(1800), lastHeartbeatAt: at(1800) }),
      cfg,
    );
    expect(r.code).toBe(ErrorCode.WATCH_SESSION_EXPIRED);
  });

  it('rejects missing heartbeats', () => {
    expect(verifyWatchSession(input({ heartbeatCount: 0 }), cfg).code).toBe(
      ErrorCode.HEARTBEAT_CONTINUITY_FAILED,
    );
    // 60% of 2 expected = 2 required (ceil 1.2)
    expect(verifyWatchSession(input({ heartbeatCount: 1 }), cfg).code).toBe(
      ErrorCode.HEARTBEAT_CONTINUITY_FAILED,
    );
  });

  it('rejects when the last heartbeat is stale relative to completion time', () => {
    const r = verifyWatchSession(input({ now: at(80), lastHeartbeatAt: at(20), heartbeatCount: 2 }), cfg);
    expect(r.code).toBe(ErrorCode.HEARTBEAT_CONTINUITY_FAILED);
  });

  it('does not require heartbeats for very short ads', () => {
    const r = verifyWatchSession(
      input({ adDurationSeconds: 8, now: at(9), heartbeatCount: 0, lastHeartbeatAt: null }),
      cfg,
    );
    expect(r.ok).toBe(true);
  });

  it('requires and checks the attention answer when a question was asked', () => {
    const q = { correctIndex: 1 };
    expect(verifyWatchSession(input({ attentionQuestion: q }), cfg).code).toBe(
      ErrorCode.ATTENTION_ANSWER_REQUIRED,
    );
    const wrong = verifyWatchSession(input({ attentionQuestion: q, attentionAnswerIndex: 0 }), cfg);
    expect(wrong.code).toBe(ErrorCode.ATTENTION_CHECK_FAILED);
    expect(wrong.attentionAnswerCorrect).toBe(false);
    const right = verifyWatchSession(input({ attentionQuestion: q, attentionAnswerIndex: 1 }), cfg);
    expect(right.ok).toBe(true);
    expect(right.attentionAnswerCorrect).toBe(true);
  });

  it('enforces the configurable daily cap before anything else', () => {
    expect(verifyWatchSession(input({ todayCompletions: 15 }), cfg).code).toBe(ErrorCode.DAILY_LIMIT_REACHED);
    expect(verifyWatchSession(input({ todayCompletions: 14 }), cfg).ok).toBe(true);
    expect(verifyWatchSession(input({ todayCompletions: 5 }), { ...cfg, dailyLimit: 5 }).code).toBe(
      ErrorCode.DAILY_LIMIT_REACHED,
    );
  });
});
