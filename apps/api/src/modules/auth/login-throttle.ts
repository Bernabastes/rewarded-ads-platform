import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { RedisService } from '../../infra/redis/redis.service';
import { ALERT_TYPES } from '../alerts/alert.rules';
import { AlertService } from '../alerts/alerts.service';
import { AuditService } from '../audit/audit.service';

export type LoginSubject = 'admin' | 'advertiser';

export const loginIpKey = (ip: string) => `login:ip:${ip}`;
export const loginAccountKey = (subject: LoginSubject, account: string) => `login:acct:${subject}:${account}`;
/** Phase 5b (#5 note): failure streak + hard lock are keyed per account AND source IP. */
export const loginFailuresKey = (subject: LoginSubject, account: string, ip: string) => `login:fail:${subject}:${account}:${ip}`;
export const loginLockKey = (subject: LoginSubject, account: string, ip: string) => `login:lock:${subject}:${account}:${ip}`;
/** An IP that completed a login for this account recently; exempt from the per-account (soft) throttle. */
export const loginTrustedIpKey = (subject: LoginSubject, account: string, ip: string) => `login:trusted:${subject}:${account}:${ip}`;
/** Phase 5c New-10: account-wide TOTP failure counter / lock (no IP in the key on purpose). */
export const mfaFailuresKey = (account: string) => `login:mfa_fail:admin:${account}`;
export const mfaAccountLockKey = (account: string) => `login:mfa_lock:admin:${account}`;

/**
 * Security audit #5: password logins (admin + advertiser) are throttled per IP and per account inside
 * LOGIN_WINDOW_SECONDS and locked for LOGIN_LOCKOUT_SECONDS after LOGIN_LOCKOUT_THRESHOLD consecutive failures.
 * Counters live in Redis so they are shared by every API replica.
 *
 * Phase 5b (#5 note - lockout as a DoS vector): the HARD lock and the failure streak are keyed on account + IP, so
 * an attacker hammering finance@... only locks their own IP out of that account while the real admin keeps
 * signing in from theirs. The per-account limit stays as the SOFT throttle against distributed guessing, and an IP
 * that completed a login for the account within LOGIN_TRUSTED_IP_HOURS is exempt from that soft limit (never from
 * the per-IP limit or from its own lock).
 *
 * Order per attempt: `assertAllowed` (locked? → 423, window exhausted? → 429) → credential check →
 * `recordFailure` (lockout + audit + security log) or `recordSuccess` (clears the streak, trusts the IP).
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
    @Optional() private readonly alerts?: AlertService,
  ) {}

  async assertAllowed(subject: LoginSubject, account: string, ip: string): Promise<void> {
    const e = this.config.env;
    const acct = normalizeAccount(account);
    let lockTtl = -2;
    let ipCount = 0;
    let acctCount = 0;
    let trusted = false;
    try {
      lockTtl = await this.redis.client.ttl(loginLockKey(subject, acct, ip));
      if (lockTtl > 0) {
        this.security.warn('auth.login_rate_limited', { subjectType: subject, account: acct, ip, reason: 'locked' });
        throw new AppException(
          ErrorCode.ACCOUNT_LOCKED,
          'Too many failed sign-in attempts; this account is temporarily locked',
          HttpStatus.LOCKED,
          { retryAfterSeconds: lockTtl },
        );
      }
      const [ipHits, acctHits, trustedFlag] = await Promise.all([
        this.redis.incrWithTtl(loginIpKey(ip), e.LOGIN_WINDOW_SECONDS),
        this.redis.incrWithTtl(loginAccountKey(subject, acct), e.LOGIN_WINDOW_SECONDS),
        this.redis.client.get(loginTrustedIpKey(subject, acct, ip)),
      ]);
      ipCount = ipHits;
      acctCount = acctHits;
      trusted = Boolean(trustedFlag);
    } catch (err) {
      if (err instanceof AppException) throw err;
      // Redis unavailable (Phase 5b New-5): closed => refuse the login (503); open => let it through (bcrypt cost +
      // lockout audit still apply when Redis returns). Default closed in production.
      this.security.error('auth.denylist_unavailable', {
        scope: 'login_throttle',
        failMode: this.config.redisFailClosed ? 'closed' : 'open',
        error: (err as Error).message,
      });
      if (this.config.redisFailClosed) throw AppException.securityUnavailable('Sign-in is temporarily unavailable; please retry shortly');
      return;
    }
    const ipExceeded = ipCount > e.LOGIN_RATE_LIMIT_PER_IP;
    const acctExceeded = acctCount > e.LOGIN_RATE_LIMIT_PER_ACCOUNT && !trusted;
    if (acctCount > e.LOGIN_RATE_LIMIT_PER_ACCOUNT && trusted) {
      this.security.warn('auth.login_rate_limited', { subjectType: subject, account: acct, ip, acctCount, reason: 'account_exempt_trusted_ip' });
    }
    if (ipExceeded || acctExceeded) {
      this.security.warn('auth.login_rate_limited', {
        subjectType: subject,
        account: acct,
        ip,
        ipCount,
        acctCount,
        reason: ipExceeded ? 'ip' : 'account',
      });
      throw AppException.rateLimited(
        ErrorCode.LOGIN_RATE_LIMITED,
        'Too many sign-in attempts; please wait before trying again',
        { retryAfterSeconds: e.LOGIN_WINDOW_SECONDS },
      );
    }
  }

  /** Returns true when this failure locked the account for this IP. */
  async recordFailure(subject: LoginSubject, account: string, ip: string, subjectId?: string): Promise<boolean> {
    const e = this.config.env;
    const acct = normalizeAccount(account);
    let failures = 0;
    try {
      failures = await this.redis.incrWithTtl(loginFailuresKey(subject, acct, ip), e.LOGIN_LOCKOUT_SECONDS);
      if (failures < e.LOGIN_LOCKOUT_THRESHOLD) return false;
      await this.redis.client.set(loginLockKey(subject, acct, ip), String(Date.now()), 'EX', e.LOGIN_LOCKOUT_SECONDS);
      await this.redis.client.del(loginFailuresKey(subject, acct, ip));
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
        metadata: { account: acct, ip, failures, lockedForSeconds: e.LOGIN_LOCKOUT_SECONDS },
        ipAddress: ip,
      })
      .catch(() => undefined);
    return true;
  }

  /**
   * Clears the streak for this account + IP and (for a FULLY completed login - Phase 5c New-10) marks the IP as
   * trusted for the account, i.e. exempt from the soft per-account throttle. Pass `trustIp: false` after a password
   * step that still has to pass TOTP.
   */
  async recordSuccess(subject: LoginSubject, account: string, ip?: string, opts: { trustIp?: boolean } = {}): Promise<void> {
    const acct = normalizeAccount(account);
    if (!ip) return;
    const e = this.config.env;
    await this.redis.client.del(loginFailuresKey(subject, acct, ip)).catch(() => undefined);
    if (opts.trustIp === false) return;
    await this.redis.client
      .set(loginTrustedIpKey(subject, acct, ip), String(Date.now()), 'EX', e.LOGIN_TRUSTED_IP_HOURS * 3600)
      .catch(() => undefined);
  }

  /**
   * Phase 5c New-10: account-wide TOTP failure cap, independent of the source IP. With a stolen password the
   * per-IP lock would otherwise allow LOGIN_LOCKOUT_THRESHOLD guesses per IP; rotating IPs must not multiply that.
   * MFA_MAX_FAILURES_PER_ACCOUNT_PER_HOUR wrong codes within an hour lock the ACCOUNT for every IP
   * (423 ACCOUNT_LOCKED, security log + critical alert). Returns true when this failure locked the account.
   */
  async recordMfaFailure(account: string, ip: string, subjectId?: string): Promise<boolean> {
    const e = this.config.env;
    const acct = normalizeAccount(account);
    let failures = 0;
    try {
      failures = await this.redis.incrWithTtl(mfaFailuresKey(acct), 3600);
      if (failures < e.MFA_MAX_FAILURES_PER_ACCOUNT_PER_HOUR) return false;
      await this.redis.client.set(mfaAccountLockKey(acct), String(Date.now()), 'EX', e.LOGIN_LOCKOUT_SECONDS);
    } catch (err) {
      this.security.error('auth.denylist_unavailable', { scope: 'mfa_account_cap', error: (err as Error).message });
      return false;
    }
    this.security.warn('auth.account_locked', {
      subjectType: 'admin',
      account: acct,
      subjectId,
      ip,
      failures,
      lockedForSeconds: e.LOGIN_LOCKOUT_SECONDS,
      reason: 'mfa_account_cap',
    });
    await this.audit
      .record({
        actorType: 'system',
        action: 'admin.login_locked',
        targetType: 'admin',
        targetId: subjectId,
        metadata: { account: acct, ip, failures, lockedForSeconds: e.LOGIN_LOCKOUT_SECONDS, reason: 'mfa_account_cap' },
        ipAddress: ip,
      })
      .catch(() => undefined);
    await this.alerts
      ?.raise({
        type: ALERT_TYPES.adminMfaBruteForce,
        severity: 'critical',
        title: `${failures} wrong TOTP codes for ${acct} within an hour - account locked for every IP`,
        payload: { account: acct, adminId: subjectId, failures, lastIp: ip, lockedForSeconds: e.LOGIN_LOCKOUT_SECONDS },
        dedupeKey: `admin_mfa_brute_force:${acct}`,
      })
      .catch((err: Error) => this.security.error('auth.denylist_unavailable', { scope: 'mfa_account_cap_alert', error: err.message }));
    return true;
  }

  /** 423 when the account-wide TOTP cap locked this account (any IP). */
  async assertMfaAccountNotLocked(account: string, ip: string): Promise<void> {
    const acct = normalizeAccount(account);
    let ttl = -2;
    try {
      ttl = await this.redis.client.ttl(mfaAccountLockKey(acct));
    } catch (err) {
      this.security.error('auth.denylist_unavailable', {
        scope: 'mfa_account_cap',
        failMode: this.config.redisFailClosed ? 'closed' : 'open',
        error: (err as Error).message,
      });
      if (this.config.redisFailClosed) throw AppException.securityUnavailable('Sign-in is temporarily unavailable; please retry shortly');
      return;
    }
    if (ttl > 0) {
      this.security.warn('auth.login_rate_limited', { subjectType: 'admin', account: acct, ip, reason: 'mfa_account_locked' });
      throw new AppException(
        ErrorCode.ACCOUNT_LOCKED,
        'Too many failed verification codes; this account is temporarily locked',
        HttpStatus.LOCKED,
        { retryAfterSeconds: ttl },
      );
    }
  }
}

export function normalizeAccount(account: string): string {
  return account.trim().toLowerCase();
}
