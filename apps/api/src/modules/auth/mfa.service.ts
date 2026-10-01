import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@rap/shared';
import bcrypt from 'bcryptjs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { authenticator } from 'otplib';
import { AppException } from '../../common/errors/app.exception';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditService } from '../audit/audit.service';

export const MFA_ISSUER = 'Gize Admin';
/** Roles that must have TOTP enabled when ADMIN_MFA_REQUIRED=true. */
export const MFA_REQUIRED_ROLES: ReadonlyArray<string> = ['finance', 'super_admin'];
const TOTP_STEP_SECONDS = 30;
/** otplib window: accept the previous / next 30 s step (clock skew) - replay inside that window is blocked separately. */
const TOTP_WINDOW = 1;

export const mfaUsedCodeKey = (adminId: string, code: string) => `mfa:used:${adminId}:${code}`;

/**
 * Security audit #5: admin TOTP (RFC 6238) second factor.
 *
 * - Secrets are AES-256-GCM encrypted at rest with a key derived (SHA-256) from MFA_ENCRYPTION_KEY. Outside
 *   production it falls back to JWT_ACCESS_SECRET for convenience; the env schema REQUIRES a dedicated
 *   >= 32-character key that differs from the JWT / KYC keys in production (Phase 5b New-4).
 * - `setup` stores a PENDING secret (`mfaEnabledAt` null); only `enable` with a valid code activates it,
 *   so a half-finished setup never locks an admin out.
 * - Each accepted code is remembered in Redis for 2 steps so it cannot be replayed inside the skew window.
 * - `verifyForAdmin` is the single verification path used by login step 2, enable and disable.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly security: SecurityLogger,
    private readonly audit: AuditService,
  ) {
    authenticator.options = { step: TOTP_STEP_SECONDS, window: TOTP_WINDOW };
  }

  /** Whether this admin is blocked from non-MFA routes (ADMIN_MFA_REQUIRED + required role + not enabled). */
  setupRequiredFor(admin: { role: string; mfaEnabledAt: Date | null }): boolean {
    return this.config.env.ADMIN_MFA_REQUIRED && MFA_REQUIRED_ROLES.includes(admin.role) && !admin.mfaEnabledAt;
  }

  async setup(adminId: string, ip: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.mfaEnabledAt) {
      throw AppException.conflict(ErrorCode.MFA_ALREADY_ENABLED, 'MFA is already enabled; disable it first to rotate the secret');
    }
    const secret = authenticator.generateSecret(20);
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { mfaSecret: this.encrypt(secret), mfaEnabledAt: null },
    });
    this.security.info('auth.mfa_setup_started', { adminId, ip });
    return {
      secret,
      otpauthUri: authenticator.keyuri(admin.email, MFA_ISSUER, secret),
      issuer: MFA_ISSUER,
      account: admin.email,
    };
  }

  async enable(adminId: string, code: string, ip: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.mfaEnabledAt) throw AppException.conflict(ErrorCode.MFA_ALREADY_ENABLED, 'MFA is already enabled');
    if (!admin.mfaSecret) {
      throw AppException.badRequest(ErrorCode.MFA_NOT_ENABLED, 'Call POST /admin/me/mfa/setup first');
    }
    await this.verifyForAdmin(admin, code, ip, 'enable');
    const updated = await this.prisma.adminUser.update({ where: { id: adminId }, data: { mfaEnabledAt: new Date() } });
    this.security.info('auth.mfa_enabled', { adminId, ip });
    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      action: 'admin.mfa_enabled',
      targetType: 'admin',
      targetId: adminId,
      ipAddress: ip,
    });
    return { mfaEnabled: true, mfaEnabledAt: updated.mfaEnabledAt };
  }

  async disable(adminId: string, code: string, password: string, ip: string) {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!admin.mfaEnabledAt || !admin.mfaSecret) {
      throw AppException.badRequest(ErrorCode.MFA_NOT_ENABLED, 'MFA is not enabled');
    }
    if (!(await bcrypt.compare(password, admin.passwordHash))) {
      this.security.warn('auth.invalid_credentials', { subjectType: 'admin', adminId, ip, action: 'mfa_disable' });
      throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Password is incorrect');
    }
    await this.verifyForAdmin(admin, code, ip, 'disable');
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { mfaSecret: null, mfaEnabledAt: null } });
    this.security.warn('auth.mfa_disabled', { adminId, ip });
    await this.audit.record({
      actorType: 'admin',
      actorId: adminId,
      action: 'admin.mfa_disabled',
      targetType: 'admin',
      targetId: adminId,
      ipAddress: ip,
    });
    return { mfaEnabled: false, mfaEnabledAt: null };
  }

  /**
   * Verifies a TOTP code against the admin's stored secret (pending or active). Throws 400 MFA_CODE_INVALID on a
   * wrong or replayed code. Callers are responsible for attempt throttling (LoginThrottle per account).
   */
  async verifyForAdmin(
    admin: { id: string; mfaSecret: string | null },
    code: string,
    ip: string,
    context: 'login' | 'enable' | 'disable',
  ): Promise<void> {
    const normalized = (code ?? '').replace(/\s+/g, '');
    const ok =
      Boolean(admin.mfaSecret) && /^\d{6}$/.test(normalized) && this.checkCode(this.decrypt(admin.mfaSecret as string), normalized);
    if (!ok) {
      this.security.warn('auth.mfa_failed', { adminId: admin.id, ip, context });
      throw AppException.badRequest(ErrorCode.MFA_CODE_INVALID, 'The verification code is invalid');
    }
    // Replay guard: a code accepted once is dead for the rest of its skew window. Phase 5b New-5: when Redis is
    // unreachable the guard fails closed in production (503) instead of silently accepting a possible replay.
    let claimed: string | null;
    try {
      claimed = await this.redis.client.set(mfaUsedCodeKey(admin.id, normalized), '1', 'EX', TOTP_STEP_SECONDS * (TOTP_WINDOW * 2 + 1), 'NX');
    } catch (err) {
      this.security.error('auth.denylist_unavailable', {
        scope: 'mfa_replay_guard',
        failMode: this.config.redisFailClosed ? 'closed' : 'open',
        error: (err as Error).message,
      });
      if (this.config.redisFailClosed) throw AppException.securityUnavailable();
      claimed = 'OK';
    }
    if (claimed !== 'OK') {
      this.security.warn('auth.mfa_failed', { adminId: admin.id, ip, context, reason: 'replay' });
      throw AppException.badRequest(ErrorCode.MFA_CODE_INVALID, 'The verification code was already used');
    }
  }

  /** Constant-time check across the accepted window (otplib's check is not constant-time by contract). */
  private checkCode(secret: string, code: string): boolean {
    const now = Date.now();
    let matched = false;
    for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
      const expected = authenticator.clone({ epoch: now + offset * TOTP_STEP_SECONDS * 1000 }).generate(secret);
      if (expected.length === code.length && timingSafeEqual(Buffer.from(expected), Buffer.from(code))) matched = true;
    }
    return matched;
  }

  /* ------------------------------- secret at rest ------------------------------- */

  private key(): Buffer {
    const raw = this.config.env.MFA_ENCRYPTION_KEY ?? this.config.env.JWT_ACCESS_SECRET;
    return createHash('sha256').update(raw).digest();
  }

  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported MFA secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
