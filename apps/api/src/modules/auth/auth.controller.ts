import { Body, Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AUTH_MODE_HEADER, ErrorCode } from '@rap/shared';
import type { Request, Response } from 'express';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  Public,
  Subjects,
  UserAgent,
} from '../../common/decorators/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { AppConfig } from '../../config/app-config';
import { clearRefreshCookie, deliverTokens, readRefreshCookie, wantsCookieMode } from './auth-cookies';
import { AuthService } from './auth.service';
import {
  AdminMfaLoginDto,
  AdvertiserRegisterDto,
  ChangePasswordDto,
  CompleteProfileDto,
  EmailPasswordLoginDto,
  LogoutDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshTokenDto,
} from './dto/auth.dto';

const COOKIE_MODE_DOC = {
  name: AUTH_MODE_HEADER,
  required: false,
  description:
    'Phase 5 (#16): `cookie` keeps the refresh token in an httpOnly, Secure, SameSite=Strict cookie (`rap_refresh`) and omits it from the body (web consoles). Default: body mode (mobile).',
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Post('otp/request')
  @Public()
  @ApiOperation({
    summary: 'Request an OTP for a phone number',
    description:
      'Rate-limited per phone and per IP. The SMS provider is mocked in this build; when OTP_DEV_ECHO=true the code is returned as `devCode`.',
  })
  @ApiResponse({ status: 429, description: 'OTP_RATE_LIMITED' })
  requestOtp(@Body() dto: OtpRequestDto, @ClientIp() ip: string) {
    return this.auth.requestOtp(dto.phoneNumber, ip);
  }

  @Post('otp/verify')
  @Public()
  @ApiOperation({
    summary: 'Verify an OTP and receive tokens (creates the user on first login)',
    description:
      'Returns `isNewUser` and the profile; when `user.profileComplete` is false call /auth/users/complete-profile.',
  })
  @ApiResponse({ status: 400, description: 'OTP_INVALID | OTP_EXPIRED | REFERRAL_CODE_INVALID (business errors are 400; only token problems are 401)' })
  @ApiResponse({ status: 429, description: 'OTP_TOO_MANY_ATTEMPTS' })
  @ApiResponse({ status: 403, description: 'ACCOUNT_SUSPENDED | ACCOUNT_BANNED | AGE_RESTRICTED' })
  verifyOtp(@Body() dto: OtpVerifyDto, @ClientIp() ip: string, @UserAgent() userAgent?: string) {
    return this.auth.verifyOtp(dto, { ip, userAgent });
  }

  @Post('users/complete-profile')
  @ApiBearerAuth()
  @Subjects('user')
  @ApiOperation({
    summary: 'Set full name + date of birth; age is verified server-side',
    description:
      'Under MIN_AGE (18) the account is marked age-rejected, its sessions are revoked and 403 AGE_RESTRICTED is returned.',
  })
  @ApiResponse({ status: 403, description: 'AGE_RESTRICTED' })
  completeProfile(@Body() dto: CompleteProfileDto, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.auth.completeProfile(auth.subjectId, dto, ip);
  }

  @Post('advertiser/register')
  @Public()
  @ApiOperation({ summary: 'Register an advertiser business account (starts in pending verification)' })
  @ApiHeader(COOKIE_MODE_DOC)
  @ApiResponse({ status: 409, description: 'EMAIL_ALREADY_REGISTERED' })
  async registerAdvertiser(
    @Body() dto: AdvertiserRegisterDto,
    @ClientIp() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UserAgent() userAgent?: string,
  ) {
    const result = await this.auth.registerAdvertiser(dto, { ip, userAgent });
    return { ...result, tokens: deliverTokens(req, res, this.config, result.tokens) };
  }

  @Post('advertiser/login')
  @Public()
  @ApiOperation({ summary: 'Advertiser email + password login (throttled per IP / account; lockout after repeated failures)' })
  @ApiHeader(COOKIE_MODE_DOC)
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 423, description: 'ACCOUNT_LOCKED (details.retryAfterSeconds)' })
  @ApiResponse({ status: 429, description: 'LOGIN_RATE_LIMITED' })
  async loginAdvertiser(
    @Body() dto: EmailPasswordLoginDto,
    @ClientIp() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UserAgent() userAgent?: string,
  ) {
    const result = await this.auth.loginAdvertiser(dto.email, dto.password, { ip, userAgent });
    return { ...result, tokens: deliverTokens(req, res, this.config, result.tokens) };
  }

  @Post('admin/login')
  @Public()
  @ApiOperation({
    summary: 'Admin email + password login (role is embedded in the access token)',
    description:
      'Throttled per IP and per account (429 LOGIN_RATE_LIMITED) with lockout after repeated failures (423 ACCOUNT_LOCKED). ' +
      'When the admin has TOTP enabled the response is `{ mfaRequired: true, mfaToken, expiresIn }` and the session is only issued by POST /auth/admin/login/mfa.',
  })
  @ApiHeader(COOKIE_MODE_DOC)
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 423, description: 'ACCOUNT_LOCKED (details.retryAfterSeconds)' })
  @ApiResponse({ status: 429, description: 'LOGIN_RATE_LIMITED' })
  async loginAdmin(
    @Body() dto: EmailPasswordLoginDto,
    @ClientIp() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UserAgent() userAgent?: string,
  ) {
    const result = await this.auth.loginAdmin(dto.email, dto.password, { ip, userAgent });
    if ('mfaRequired' in result) return result;
    return { ...result, tokens: deliverTokens(req, res, this.config, result.tokens) };
  }

  @Post('admin/login/mfa')
  @Public()
  @ApiOperation({
    summary: 'Admin login step 2: TOTP code + the single-use mfaToken from step 1',
    description: 'Wrong codes count toward the account lockout. Returns the same `{ tokens, admin }` payload as a password-only login.',
  })
  @ApiHeader(COOKIE_MODE_DOC)
  @ApiResponse({ status: 400, description: 'MFA_CODE_INVALID' })
  @ApiResponse({ status: 401, description: 'MFA_TOKEN_INVALID (expired / already used)' })
  @ApiResponse({ status: 423, description: 'ACCOUNT_LOCKED' })
  async loginAdminMfa(
    @Body() dto: AdminMfaLoginDto,
    @ClientIp() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UserAgent() userAgent?: string,
  ) {
    const result = await this.auth.loginAdminMfa(dto.mfaToken, dto.code, { ip, userAgent });
    return { ...result, tokens: deliverTokens(req, res, this.config, result.tokens) };
  }

  @Post('refresh')
  @Public()
  @ApiOperation({
    summary: 'Rotate a refresh token (single use; reuse revokes the whole token family)',
    description:
      'Body mode: `{ refreshToken }`. Cookie mode (`X-Auth-Mode: cookie`): the token is read from the httpOnly `rap_refresh` cookie, the rotated one is set as a new cookie and omitted from the body.',
  })
  @ApiHeader(COOKIE_MODE_DOC)
  @ApiResponse({ status: 401, description: 'INVALID_TOKEN | TOKEN_EXPIRED | REFRESH_TOKEN_REUSED' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @ClientIp() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UserAgent() userAgent?: string,
  ) {
    const cookieMode = wantsCookieMode(req);
    const token = cookieMode ? readRefreshCookie(req) ?? dto.refreshToken : dto.refreshToken;
    if (!token) {
      if (cookieMode) throw AppException.unauthorized(ErrorCode.INVALID_TOKEN, 'Missing refresh cookie');
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'refreshToken is required');
    }
    try {
      const tokens = await this.auth.refresh(token, { ip, userAgent });
      return deliverTokens(req, res, this.config, tokens);
    } catch (err) {
      // a dead / reused cookie must not keep being sent
      if (cookieMode) clearRefreshCookie(res, this.config);
      throw err;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiHeader(COOKIE_MODE_DOC)
  @ApiOperation({
    summary: 'Revoke a refresh token family (and immediately deny the presented access token)',
    description:
      'Send the refresh token in the body and the current access token as the Bearer header: the access token is denylisted for its remaining lifetime so it stops working right away on this device.',
  })
  async logout(
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('authorization') authorization?: string,
  ) {
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    // cookie mode: the httpOnly cookie carries the token and is cleared regardless of the outcome
    const token = wantsCookieMode(req) ? readRefreshCookie(req) ?? dto.refreshToken : dto.refreshToken;
    if (wantsCookieMode(req)) clearRefreshCookie(res, this.config);
    if (token) await this.auth.logout(token, accessToken);
  }

  @Post('advertiser/change-password')
  @ApiBearerAuth()
  @Subjects('advertiser')
  @ApiOperation({ summary: 'Change the advertiser password (revokes all refresh tokens; re-login required)' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS (current password wrong)' })
  changeAdvertiserPassword(
    @Body() dto: ChangePasswordDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.auth.changeAdvertiserPassword(auth.subjectId, dto.currentPassword, dto.newPassword, ip);
  }
}
