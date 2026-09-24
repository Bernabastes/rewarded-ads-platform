import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminRole, AuthSubjectType } from '@rap/shared';
import type { Request } from 'express';

export interface AuthContext {
  subjectType: AuthSubjectType;
  subjectId: string;
  role?: AdminRole;
  /** Raw JWT id (jti) for logging. */
  tokenId?: string;
}

export interface RequestWithAuth extends Request {
  auth?: AuthContext;
}

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const SUBJECTS_KEY = 'auth:subjects';
export const ROLES_KEY = 'auth:roles';
export const REQUIRE_VERIFIED_ADULT_KEY = 'auth:requireVerifiedAdult';

/** Skip authentication for this handler/controller. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict the handler/controller to the given token subject types. */
export const Subjects = (...subjects: AuthSubjectType[]) => SetMetadata(SUBJECTS_KEY, subjects);

/** Restrict the handler/controller to admins with one of the given roles. */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

/** User endpoints that require a completed profile with verified adult age. */
export const RequireVerifiedAdult = () => SetMetadata(REQUIRE_VERIFIED_ADULT_KEY, true);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!req.auth) throw new Error('CurrentAuth used on an unauthenticated route');
  return req.auth;
});

export function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  const ip = (first ?? req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string =>
  extractClientIp(ctx.switchToHttp().getRequest<Request>()),
);

export const UserAgent = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined =>
  ctx.switchToHttp().getRequest<Request>().headers['user-agent'],
);
