import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthSubjectType } from '@prisma/client';
import type { AdminRole } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception';
import { addDays, randomToken, sha256 } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/** Redis keys of the access-token denylist (F2). TTL = access token lifetime, after which tokens expire anyway. */
export const tokensInvalidBeforeKey = (type: string, id: string) => `tokens_invalid_before:${type}:${id}`;
export const deniedJtiKey = (jti: string) => `denied_jti:${jti}`;

/**
 * Access tokens: short-lived HS256 JWTs { sub, typ, role? }.
 * Refresh tokens: opaque random strings stored hashed, single-use (rotation) and grouped in families —
 * presenting an already-rotated token revokes the whole family (stolen-token detection).
 * Denylist: suspension / ban / age rejection / refresh reuse stamp `tokens_invalid_before` for the subject and
 * logout denylists the presented `jti`, so access tokens die immediately instead of at expiry.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly security: SecurityLogger,
    private readonly redis: RedisService,
  ) {}

  async issue(
    subject: { type: AuthSubjectType; id: string; role?: AdminRole },
    meta: { ip?: string; userAgent?: string; familyId?: string } = {},
  ): Promise<IssuedTokens> {
    const expiresIn = this.config.env.JWT_ACCESS_TTL_SECONDS;
    const accessToken = await this.jwt.signAsync(
      { typ: subject.type, ...(subject.role ? { role: subject.role } : {}) },
      { subject: subject.id, expiresIn, secret: this.config.env.JWT_ACCESS_SECRET, jwtid: randomUUID() },
    );
    const refreshToken = randomToken(48);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: sha256(refreshToken),
        subjectType: subject.type,
        subjectId: subject.id,
        familyId: meta.familyId ?? randomUUID(),
        expiresAt: addDays(new Date(), this.config.env.JWT_REFRESH_TTL_DAYS),
        ipAddress: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    return { accessToken, refreshToken, expiresIn, tokenType: 'Bearer' };
  }

  async rotate(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
    const hash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored) throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Invalid refresh token');

    if (stored.revokedAt) {
      // Reuse of a rotated/revoked token => the family is compromised.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.invalidateAccessTokens(stored.subjectType, stored.subjectId, 'refresh_reuse');
      this.security.warn('auth.refresh_reuse_detected', {
        subjectType: stored.subjectType,
        subjectId: stored.subjectId,
        familyId: stored.familyId,
        ip: meta.ip,
      });
      throw AppException.unauthorized(
        ErrorCode.REFRESH_TOKEN_REUSED,
        'Refresh token reuse detected; please log in again',
      );
    }
    if (stored.expiresAt < new Date()) {
      throw AppException.unauthorized(ErrorCode.TOKEN_EXPIRED, 'Refresh token expired');
    }

    const role = stored.subjectType === 'admin' ? await this.adminRole(stored.subjectId) : undefined;
    const tokens = await this.issue(
      { type: stored.subjectType, id: stored.subjectId, role },
      { ...meta, familyId: stored.familyId },
    );
    const replacement = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(tokens.refreshToken) },
    });
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: replacement?.id },
    });
    return { tokens, subject: { type: stored.subjectType, id: stored.subjectId } };
  }

  async revoke(refreshToken: string, accessToken?: string) {
    if (accessToken) await this.denyAccessToken(accessToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForSubject(type: AuthSubjectType, id: string, reason = 'revoke_all') {
    await this.prisma.refreshToken.updateMany({
      where: { subjectType: type, subjectId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.invalidateAccessTokens(type, id, reason);
  }

  /* ---------------------------- access-token denylist (F2) ---------------------------- */

  /** Every access token of the subject issued before now stops working immediately. */
  async invalidateAccessTokens(type: AuthSubjectType, id: string, reason: string, now = Date.now()) {
    try {
      await this.redis.client.set(
        tokensInvalidBeforeKey(type, id),
        String(now),
        'EX',
        this.config.env.JWT_ACCESS_TTL_SECONDS + 5,
      );
      this.security.info('auth.access_tokens_invalidated', { subjectType: type, subjectId: id, reason });
    } catch (err) {
      this.security.error('auth.denylist_unavailable', {
        subjectType: type,
        subjectId: id,
        reason,
        error: (err as Error).message,
      });
    }
  }

  /** Denylist one specific access token (logout on this device only) for its remaining lifetime. */
  async denyAccessToken(accessToken: string) {
    const claims = this.jwt.decode<{ jti?: string; exp?: number } | null>(accessToken);
    if (!claims?.jti) return;
    const ttl = Math.max(1, (claims.exp ?? 0) - Math.floor(Date.now() / 1000));
    await this.redis.client.set(deniedJtiKey(claims.jti), '1', 'EX', ttl).catch(() => undefined);
  }

  /** Guard check: is this token (jti, iat) still acceptable for the subject? */
  async isAccessTokenDenied(
    type: AuthSubjectType,
    id: string,
    claims: { jti?: string; iat?: number },
  ): Promise<boolean> {
    try {
      const [invalidBefore, denied] = await this.redis.client.mget(
        tokensInvalidBeforeKey(type, id),
        claims.jti ? deniedJtiKey(claims.jti) : deniedJtiKey('none'),
      );
      if (denied) return true;
      if (invalidBefore && claims.iat !== undefined && claims.iat * 1000 < Number(invalidBefore)) return true;
      return false;
    } catch {
      // Redis down: fail open (tokens are short-lived and account status is re-read from the DB anyway).
      return false;
    }
  }

  /* ---------------------------- impersonation (support) ---------------------------- */

  /** Short-lived READ-ONLY user token for support staff; carries the acting admin id. No refresh token. */
  async issueImpersonation(userId: string, adminId: string) {
    const expiresIn = this.config.platform.impersonationTtlSeconds;
    const accessToken = await this.jwt.signAsync(
      { typ: 'impersonation', actorAdminId: adminId },
      { subject: userId, expiresIn, secret: this.config.env.JWT_ACCESS_SECRET, jwtid: randomUUID() },
    );
    return {
      accessToken,
      tokenType: 'Bearer' as const,
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  private async adminRole(adminId: string): Promise<AdminRole | undefined> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId }, select: { role: true } });
    return admin?.role;
  }
}
