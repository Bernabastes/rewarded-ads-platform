import { ErrorCode } from '@rap/shared';

/**
 * Pure, server-side verification of a watch session at completion time.
 * Every input comes from server records (session started_at / heartbeats) or server config —
 * nothing here trusts the client.
 */
export interface VerificationConfig {
  minWatchRatio: number;
  maxWatchRatio: number;
  watchGraceSeconds: number;
  heartbeatIntervalSeconds: number;
  minHeartbeatRatio: number;
  dailyLimit: number;
}

export interface VerificationInput {
  now: Date;
  startedAt: Date;
  expiresAt: Date;
  adDurationSeconds: number;
  heartbeatCount: number;
  lastHeartbeatAt: Date | null;
  attentionQuestion: { correctIndex: number } | null;
  attentionAnswerIndex: number | undefined;
  /** Completions counted toward the daily cap before this one. */
  todayCompletions: number;
}

export interface VerificationResult {
  ok: boolean;
  code: ErrorCode | null;
  watchDurationSeconds: number;
  minWatchSeconds: number;
  expectedHeartbeats: number;
  attentionAnswerCorrect: boolean | null;
}

export function minWatchSeconds(adDurationSeconds: number, minWatchRatio: number): number {
  return Math.max(1, Math.ceil(adDurationSeconds * minWatchRatio));
}

export function expectedHeartbeats(minWatch: number, heartbeatIntervalSeconds: number): number {
  return Math.floor(minWatch / heartbeatIntervalSeconds);
}

export function verifyWatchSession(input: VerificationInput, cfg: VerificationConfig): VerificationResult {
  const watchDurationSeconds = Math.max(
    0,
    Math.floor((input.now.getTime() - input.startedAt.getTime()) / 1000),
  );
  const minWatch = minWatchSeconds(input.adDurationSeconds, cfg.minWatchRatio);
  const expected = expectedHeartbeats(minWatch, cfg.heartbeatIntervalSeconds);
  const base = {
    watchDurationSeconds,
    minWatchSeconds: minWatch,
    expectedHeartbeats: expected,
    attentionAnswerCorrect: null as boolean | null,
  };
  const fail = (code: ErrorCode, extra: Partial<VerificationResult> = {}): VerificationResult => ({
    ...base,
    ...extra,
    ok: false,
    code,
  });

  if (input.todayCompletions >= cfg.dailyLimit) return fail(ErrorCode.DAILY_LIMIT_REACHED);
  if (input.now > input.expiresAt) return fail(ErrorCode.WATCH_SESSION_EXPIRED);

  const maxWatch = input.adDurationSeconds * cfg.maxWatchRatio + cfg.watchGraceSeconds;
  if (watchDurationSeconds > maxWatch) return fail(ErrorCode.WATCH_DURATION_EXCESSIVE);
  if (watchDurationSeconds < minWatch) return fail(ErrorCode.WATCH_DURATION_INSUFFICIENT);

  if (expected > 0) {
    const required = Math.ceil(expected * cfg.minHeartbeatRatio);
    if (input.heartbeatCount < required) return fail(ErrorCode.HEARTBEAT_CONTINUITY_FAILED);
    const staleAfterMs = (cfg.heartbeatIntervalSeconds * 3 + 5) * 1000;
    if (!input.lastHeartbeatAt || input.now.getTime() - input.lastHeartbeatAt.getTime() > staleAfterMs) {
      return fail(ErrorCode.HEARTBEAT_CONTINUITY_FAILED);
    }
  }

  if (input.attentionQuestion) {
    if (input.attentionAnswerIndex === undefined || input.attentionAnswerIndex === null) {
      return fail(ErrorCode.ATTENTION_ANSWER_REQUIRED);
    }
    const correct = input.attentionAnswerIndex === input.attentionQuestion.correctIndex;
    if (!correct) return fail(ErrorCode.ATTENTION_CHECK_FAILED, { attentionAnswerCorrect: false });
    return { ...base, ok: true, code: null, attentionAnswerCorrect: true };
  }

  return { ...base, ok: true, code: null };
}
