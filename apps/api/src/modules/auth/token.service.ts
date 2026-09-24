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

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/**
 * Access tokens: short-lived HS256 JWTs { sub, typ, role? }.
 * Refresh tokens: opaque random strings stored hashed, single-use (rotation) and grouped in families —
 * presenting an already-rotated token revokes the whole family (stolen-token detection).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly security: SecurityLogger,
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

  async revoke(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForSubject(type: AuthSubjectType, id: string) {
    await this.prisma.refreshToken.updateMany({
      where: { subjectType: type, subjectId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async adminRole(adminId: string): Promise<AdminRole | undefined> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId }, select: { role: true } });
    return admin?.role;
  }
}
