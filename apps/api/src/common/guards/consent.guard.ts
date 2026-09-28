import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@rap/shared';
import { LegalService } from '../../modules/legal/legal.service';
import { IS_PUBLIC_KEY, REQUIRE_CONSENT_KEY, type RequestWithAuth } from '../decorators/auth.decorators';
import { AppException } from '../errors/app.exception';

/**
 * Runs after AuthGuard. Handlers/controllers marked @RequireConsent() refuse users (and advertisers) whose
 * accepted terms/privacy versions are not the currently published ones: 403 CONSENT_REQUIRED with
 * `details.requiresConsent` (the kinds to accept via POST /users/me/consents or /advertisers/me/consents).
 * Read-only impersonation sessions are exempt (support must be able to look at a blocked account).
 */
@Injectable()
export class ConsentGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly legal: LegalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (!this.reflector.getAllAndOverride<boolean>(REQUIRE_CONSENT_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = req.auth;
    if (!auth || auth.subjectType === 'admin' || auth.impersonation) return true;

    const missing = await this.legal.missingConsents(auth.subjectType, auth.subjectId);
    if (missing.length) {
      throw AppException.forbidden(
        ErrorCode.CONSENT_REQUIRED,
        'Please accept the current terms of service and privacy notice to continue',
        { requiresConsent: missing },
      );
    }
    return true;
  }
}
