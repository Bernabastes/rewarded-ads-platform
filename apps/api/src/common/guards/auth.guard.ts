import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type AdminRole, type AuthSubjectType, ErrorCode } from '@rap/shared';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  type AuthContext,
  IS_PUBLIC_KEY,
  REQUIRE_VERIFIED_ADULT_KEY,
  type RequestWithAuth,
  ROLES_KEY,
  SUBJECTS_KEY,
} from '../decorators/auth.decorators';
import { AppException } from '../errors/app.exception';

interface AccessClaims {
  sub: string;
  typ: AuthSubjectType;
  role?: AdminRole;
  jti?: string;
}

/**
 * Global guard: verifies the Bearer access token, enforces subject type (@Subjects) and admin role (@Roles),
 * and re-checks account status on every request so suspensions/bans take effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AppException.unauthorized(ErrorCode.UNAUTHORIZED, 'Missing bearer token');
    }

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(header.slice(7), {
        secret: this.config.env.JWT_ACCESS_SECRET,
      });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === 'TokenExpiredError') {
        throw AppException.unauthorized(ErrorCode.TOKEN_EXPIRED, 'Access token expired');
      }
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Invalid access token');
    }

    const auth: AuthContext = {
      subjectType: claims.typ,
      subjectId: claims.sub,
      role: claims.role,
      tokenId: claims.jti,
    };
    req.auth = auth;

    const subjects = this.reflector.getAllAndOverride<AuthSubjectType[] | undefined>(SUBJECTS_KEY, targets);
    if (subjects?.length && !subjects.includes(auth.subjectType)) {
      throw AppException.forbidden(
        ErrorCode.FORBIDDEN,
        'This endpoint is not available for your account type',
      );
    }

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, targets);
    if (roles?.length) {
      if (auth.subjectType !== 'admin' || !auth.role || !roles.includes(auth.role)) {
        throw AppException.forbidden(
          ErrorCode.ROLE_NOT_ALLOWED,
          'Your admin role cannot perform this action',
          {
            requiredRoles: roles,
          },
        );
      }
    }

    await this.assertAccountUsable(
      auth,
      this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_ADULT_KEY, targets),
    );
    return true;
  }

  private async assertAccountUsable(auth: AuthContext, requireVerifiedAdult?: boolean) {
    if (auth.subjectType === 'user') {
      const user = await this.prisma.user.findUnique({
        where: { id: auth.subjectId },
        select: { status: true, ageVerificationStatus: true },
      });
      if (!user) throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Account no longer exists');
      if (user.status === 'banned') throw AppException.forbidden(ErrorCode.ACCOUNT_BANNED, 'Account banned');
      if (user.status === 'suspended')
        throw AppException.forbidden(ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended');
      if (user.ageVerificationStatus === 'rejected') {
        throw AppException.forbidden(ErrorCode.AGE_RESTRICTED, 'You must be at least 18 to use this service');
      }
      if (requireVerifiedAdult && user.ageVerificationStatus !== 'verified_adult') {
        throw AppException.forbidden(
          ErrorCode.PROFILE_INCOMPLETE,
          'Complete your profile (date of birth) first',
        );
      }
      return;
    }
    if (auth.subjectType === 'admin') {
      const admin = await this.prisma.adminUser.findUnique({
        where: { id: auth.subjectId },
        select: { active: true, role: true },
      });
      if (!admin) throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Account no longer exists');
      if (!admin.active) throw AppException.forbidden(ErrorCode.ADMIN_INACTIVE, 'Admin account deactivated');
      // role changes take effect without re-login
      auth.role = admin.role;
      return;
    }
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: auth.subjectId },
      select: { id: true },
    });
    if (!advertiser) throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Account no longer exists');
  }
}
