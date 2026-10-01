import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminRole, AuthSubjectType } from '@rap/shared';
import type { Request } from 'express';

export interface AuthContext {
  subjectType: AuthSubjectType;
  subjectId: string;
  role?: AdminRole;
  /** Raw JWT id (jti) for logging. */
  tokenId?: string;
  /** Set when a support admin is reading the user's data through a read-only impersonation token. */
  impersonation?: { actorAdminId: string };
}

export interface RequestWithAuth extends Request {
  auth?: AuthContext;
}

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const SUBJECTS_KEY = 'auth:subjects';
export const ROLES_KEY = 'auth:roles';
export const REQUIRE_VERIFIED_ADULT_KEY = 'auth:requireVerifiedAdult';
export const REQUIRE_CONSENT_KEY = 'auth:requireConsent';
export const ALLOW_IMPERSONATION_WRITE_KEY = 'auth:allowImpersonationWrite';
export const ALLOW_PENDING_SECURITY_SETUP_KEY = 'auth:allowPendingSecuritySetup';

/** Skip authentication for this handler/controller. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Admin routes that stay reachable while the account is in a pending security state
 * (403 MFA_SETUP_REQUIRED / PASSWORD_CHANGE_REQUIRED everywhere else): /admin/me, MFA setup, change-password.
 */
export const AllowPendingSecuritySetup = () => SetMetadata(ALLOW_PENDING_SECURITY_SETUP_KEY, true);

/** Restrict the handler/controller to the given token subject types. */
export const Subjects = (...subjects: AuthSubjectType[]) => SetMetadata(SUBJECTS_KEY, subjects);

/** Restrict the handler/controller to admins with one of the given roles. */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

/** User endpoints that require a completed profile with verified adult age. */
export const RequireVerifiedAdult = () => SetMetadata(REQUIRE_VERIFIED_ADULT_KEY, true);

/** User/advertiser endpoints that require the current terms + privacy versions to be accepted (403 CONSENT_REQUIRED). */
export const RequireConsent = () => SetMetadata(REQUIRE_CONSENT_KEY, true);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!req.auth) throw new Error('CurrentAuth used on an unauthenticated route');
  return req.auth;
});

/**
 * Client IP for rate limits, fraud signals, referral checks and audit rows.
 *
 * Security audit #3: NEVER read `X-Forwarded-For` here. Express computes `req.ip` from the socket address and the
 * configured number of trusted proxy hops (`TRUST_PROXY_HOPS`, see app.setup.ts); a client-supplied header is
 * only honoured when it was appended by a trusted proxy. With 0 hops (direct exposure, docker compose) the
 * header is ignored completely.
 */
export function extractClientIp(req: Request): string {
  const ip = (req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  extractClientIp(ctx.switchToHttp().getRequest<Request>()),
);

export const UserAgent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<Request>().headers['user-agent'],
);
