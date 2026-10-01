import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type AdminRole, type AuthSubjectType, ErrorCode } from '@rap/shared';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../modules/audit/audit.service';
import { MfaService } from '../../modules/auth/mfa.service';
import { TokenService } from '../../modules/auth/token.service';
import {
  ALLOW_PENDING_SECURITY_SETUP_KEY,
  type AuthContext,
  extractClientIp,
  IS_PUBLIC_KEY,
  REQUIRE_VERIFIED_ADULT_KEY,
  type RequestWithAuth,
  ROLES_KEY,
  SUBJECTS_KEY,
} from '../decorators/auth.decorators';
import { AppException } from '../errors/app.exception';

interface AccessClaims {
  sub: string;
  typ: AuthSubjectType | 'impersonation';
  role?: AdminRole;
  jti?: string;
  iat?: number;
  /** Impersonation tokens only. */
  actorAdminId?: string;
}

/**
 * Global guard: verifies the bearer token, enforces subject type (@Subjects) and admin role (@Roles),
 * rejects denylisted tokens (F2: logout / suspension / ban / age rejection / refresh reuse) and re-checks
 * account status on every request so suspensions/bans take effect immediately.
 *
 * Impersonation tokens (`typ: 'impersonation'`, issued to support staff) act as the user for GET requests
 * only; every other method fails with 403 IMPERSONATION_READ_ONLY and every use is audited.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    private readonly mfa: MfaService,
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

    const impersonation = claims.typ === 'impersonation';
    const subjectType = (impersonation ? 'user' : claims.typ) as AuthSubjectType;
    if (!['user', 'advertiser', 'admin'].includes(subjectType)) {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Invalid access token');
    }

    if (await this.tokens.isAccessTokenDenied(subjectType, claims.sub, claims)) {
      throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'This session has been signed out');
    }

    const auth: AuthContext = {
      subjectType,
      subjectId: claims.sub,
      role: claims.role,
      tokenId: claims.jti,
      ...(impersonation && claims.actorAdminId ? { impersonation: { actorAdminId: claims.actorAdminId } } : {}),
    };
    req.auth = auth;

    if (impersonation) await this.assertImpersonationAllowed(req, auth);

    const subjects = this.reflector.getAllAndOverride<AuthSubjectType[] | undefined>(SUBJECTS_KEY, targets);
    if (subjects?.length && !subjects.includes(auth.subjectType)) {
      throw AppException.forbidden(
        ErrorCode.FORBIDDEN,
        'This endpoint is not available for your account type',
      );
    }

    // Account status (and, for admins, the CURRENT role from the DB) is loaded BEFORE @Roles is evaluated,
    // so a role change takes effect on the next request even for an access token minted with the old role (#13).
    await this.assertAccountUsable(
      auth,
      this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_ADULT_KEY, targets),
      Boolean(this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_SECURITY_SETUP_KEY, targets)),
    );

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
    return true;
  }

  private async assertImpersonationAllowed(req: RequestWithAuth, auth: AuthContext) {
    const actorAdminId = auth.impersonation?.actorAdminId;
    if (!actorAdminId) throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Invalid impersonation token');
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: actorAdminId },
      select: { active: true, role: true },
    });
    if (!admin?.active || !['support', 'super_admin'].includes(admin.role)) {
      throw AppException.forbidden(ErrorCode.FORBIDDEN, 'Impersonation is no longer permitted for this admin');
    }
    const method = req.method.toUpperCase();
    const readOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    const ip = extractClientIp(req);
    // Every use is audited (fire-and-forget so reads stay fast).
    void this.audit
      .record({
        actorType: 'admin',
        actorId: actorAdminId,
        action: readOnly ? 'impersonation.read' : 'impersonation.write_blocked',
        targetType: 'user',
        targetId: auth.subjectId,
        metadata: { method, path: req.originalUrl ?? req.url, tokenId: auth.tokenId },
        ipAddress: ip,
      })
      .catch(() => undefined);
    if (!readOnly) {
      this.security.warn('impersonation.write_blocked', {
        adminId: actorAdminId,
        userId: auth.subjectId,
        method,
        path: req.originalUrl ?? req.url,
        ip,
      });
      throw AppException.forbidden(
        ErrorCode.IMPERSONATION_READ_ONLY,
        'Impersonation sessions are read-only; mutations are not allowed',
      );
    }
  }

  private async assertAccountUsable(
    auth: AuthContext,
    requireVerifiedAdult?: boolean,
    allowPendingSecuritySetup = false,
  ) {
    if (auth.subjectType === 'user') {
      const user = await this.prisma.user.findUnique({
        where: { id: auth.subjectId },
        select: { status: true, ageVerificationStatus: true },
      });
      if (!user || user.status === 'deleted') {
        throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Account no longer exists');
      }
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
        select: { active: true, role: true, mfaEnabledAt: true, mustChangePassword: true },
      });
      if (!admin) throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Account no longer exists');
      if (!admin.active) throw AppException.forbidden(ErrorCode.ADMIN_INACTIVE, 'Admin account deactivated');
      // role changes take effect without re-login (#13: @Roles is evaluated against this value, not the claim)
      auth.role = admin.role;
      if (!allowPendingSecuritySetup) {
        // Audit #5: temporary passwords and (when required) missing TOTP confine the admin to /admin/me + setup routes.
        if (admin.mustChangePassword) {
          throw AppException.forbidden(
            ErrorCode.PASSWORD_CHANGE_REQUIRED,
            'Change your temporary password before using the console',
          );
        }
        if (this.mfa.setupRequiredFor(admin)) {
          throw AppException.forbidden(
            ErrorCode.MFA_SETUP_REQUIRED,
            'Two-factor authentication must be enabled for your role before using the console',
          );
        }
      }
      return;
    }
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { id: auth.subjectId },
      select: { id: true },
    });
    if (!advertiser) throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Account no longer exists');
  }
}
