import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditService } from '../audit/audit.service';

export type LoginSubject = 'admin' | 'advertiser';

export const loginIpKey = (ip: string) => `login:ip:${ip}`;
export const loginAccountKey = (subject: LoginSubject, account: string) => `login:acct:${subject}:${account}`;
export const loginFailuresKey = (subject: LoginSubject, account: string) => `login:fail:${subject}:${account}`;
export const loginLockKey = (subject: LoginSubject, account: string) => `login:lock:${subject}:${account}`;

/**
 * Security audit #5: password logins (admin + advertiser) are throttled per IP and per account inside
 * LOGIN_WINDOW_SECONDS and an account is locked for LOGIN_LOCKOUT_SECONDS after LOGIN_LOCKOUT_THRESHOLD
 * consecutive failures. Counters live in Redis so they are shared by every API replica.
 *
 * Order per attempt: `assertAllowed` (locked? → 423, window exhausted? → 429) → credential check →
 * `recordFailure` (lockout + audit + security log) or `recordSuccess` (clears the failure streak).
 * The account key is the normalised e-mail, so an unknown e-mail is throttled exactly like a real one
 * (no account-existence oracle through different limits).
 */
@Injectable()
export class LoginThrottle {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly security: SecurityLogger,
    private readonly audit: AuditService,
  ) {}

  async assertAllowed(subject: LoginSubject, account: string, ip: string): Promise<void> {
    const e = this.config.env;
    const acct = normalizeAccount(account);
    let lockTtl = -2;
    let ipCount = 0;
    let acctCount = 0;
    try {
      lockTtl = await this.redis.client.ttl(loginLockKey(subject, acct));
      if (lockTtl > 0) {
        this.security.warn('auth.login_rate_limited', { subjectType: subject, account: acct, ip, reason: 'locked' });
        throw new AppException(
          ErrorCode.ACCOUNT_LOCKED,
          'Too many failed sign-in attempts; this account is temporarily locked',
          HttpStatus.LOCKED,
          { retryAfterSeconds: lockTtl },
        );
      }
      [ipCount, acctCount] = await Promise.all([
        this.redis.incrWithTtl(loginIpKey(ip), e.LOGIN_WINDOW_SECONDS),
        this.redis.incrWithTtl(loginAccountKey(subject, acct), e.LOGIN_WINDOW_SECONDS),
      ]);
    } catch (err) {
      if (err instanceof AppException) throw err;
      // Redis unavailable: fail open for availability (bcrypt cost + lockout audit still apply when it returns).
      this.security.error('auth.denylist_unavailable', { scope: 'login_throttle', error: (err as Error).message });
      return;
    }
    if (ipCount > e.LOGIN_RATE_LIMIT_PER_IP || acctCount > e.LOGIN_RATE_LIMIT_PER_ACCOUNT) {
      this.security.warn('auth.login_rate_limited', {
        subjectType: subject,
        account: acct,
        ip,
        ipCount,
        acctCount,
        reason: ipCount > e.LOGIN_RATE_LIMIT_PER_IP ? 'ip' : 'account',
      });
      throw AppException.rateLimited(
        ErrorCode.LOGIN_RATE_LIMITED,
        'Too many sign-in attempts; please wait before trying again',
        { retryAfterSeconds: e.LOGIN_WINDOW_SECONDS },
      );
    }
  }

  /** Returns true when this failure locked the account. */
  async recordFailure(subject: LoginSubject, account: string, ip: string, subjectId?: string): Promise<boolean> {
    const e = this.config.env;
    const acct = normalizeAccount(account);
    let failures = 0;
    try {
      failures = await this.redis.incrWithTtl(loginFailuresKey(subject, acct), e.LOGIN_LOCKOUT_SECONDS);
      if (failures < e.LOGIN_LOCKOUT_THRESHOLD) return false;
      await this.redis.client.set(loginLockKey(subject, acct), String(Date.now()), 'EX', e.LOGIN_LOCKOUT_SECONDS);
      await this.redis.client.del(loginFailuresKey(subject, acct));
    } catch (err) {
      this.security.error('auth.denylist_unavailable', { scope: 'login_lockout', error: (err as Error).message });
      return false;
    }
    this.security.warn('auth.account_locked', {
      subjectType: subject,
      account: acct,
      subjectId,
      ip,
      failures,
      lockedForSeconds: e.LOGIN_LOCKOUT_SECONDS,
    });
    await this.audit
      .record({
        actorType: 'system',
        action: `${subject}.login_locked`,
        targetType: subject,
        targetId: subjectId,
        metadata: { account: acct, failures, lockedForSeconds: e.LOGIN_LOCKOUT_SECONDS },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return true;
  }

  async recordSuccess(subject: LoginSubject, account: string): Promise<void> {
    await this.redis.client.del(loginFailuresKey(subject, normalizeAccount(account))).catch(() => undefined);
  }
}

export function normalizeAccount(account: string): string {
  return account.trim().toLowerCase();
}
