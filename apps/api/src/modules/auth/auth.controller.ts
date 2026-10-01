import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  Public,
  Subjects,
  UserAgent,
} from '../../common/decorators/auth.decorators';
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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
  @ApiResponse({ status: 409, description: 'EMAIL_ALREADY_REGISTERED' })
  registerAdvertiser(
    @Body() dto: AdvertiserRegisterDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent?: string,
  ) {
    return this.auth.registerAdvertiser(dto, { ip, userAgent });
  }

  @Post('advertiser/login')
  @Public()
  @ApiOperation({ summary: 'Advertiser email + password login (throttled per IP / account; lockout after repeated failures)' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 423, description: 'ACCOUNT_LOCKED (details.retryAfterSeconds)' })
  @ApiResponse({ status: 429, description: 'LOGIN_RATE_LIMITED' })
  loginAdvertiser(
    @Body() dto: EmailPasswordLoginDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent?: string,
  ) {
    return this.auth.loginAdvertiser(dto.email, dto.password, { ip, userAgent });
  }

  @Post('admin/login')
  @Public()
  @ApiOperation({
    summary: 'Admin email + password login (role is embedded in the access token)',
    description:
      'Throttled per IP and per account (429 LOGIN_RATE_LIMITED) with lockout after repeated failures (423 ACCOUNT_LOCKED). ' +
      'When the admin has TOTP enabled the response is `{ mfaRequired: true, mfaToken, expiresIn }` and the session is only issued by POST /auth/admin/login/mfa.',
  })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 423, description: 'ACCOUNT_LOCKED (details.retryAfterSeconds)' })
  @ApiResponse({ status: 429, description: 'LOGIN_RATE_LIMITED' })
  loginAdmin(@Body() dto: EmailPasswordLoginDto, @ClientIp() ip: string, @UserAgent() userAgent?: string) {
    return this.auth.loginAdmin(dto.email, dto.password, { ip, userAgent });
  }

  @Post('admin/login/mfa')
  @Public()
  @ApiOperation({
    summary: 'Admin login step 2: TOTP code + the single-use mfaToken from step 1',
    description: 'Wrong codes count toward the account lockout. Returns the same `{ tokens, admin }` payload as a password-only login.',
  })
  @ApiResponse({ status: 400, description: 'MFA_CODE_INVALID' })
  @ApiResponse({ status: 401, description: 'MFA_TOKEN_INVALID (expired / already used)' })
  @ApiResponse({ status: 423, description: 'ACCOUNT_LOCKED' })
  loginAdminMfa(@Body() dto: AdminMfaLoginDto, @ClientIp() ip: string, @UserAgent() userAgent?: string) {
    return this.auth.loginAdminMfa(dto.mfaToken, dto.code, { ip, userAgent });
  }

  @Post('refresh')
  @Public()
  @ApiOperation({ summary: 'Rotate a refresh token (single use; reuse revokes the whole token family)' })
  @ApiResponse({ status: 401, description: 'INVALID_TOKEN | TOKEN_EXPIRED | REFRESH_TOKEN_REUSED' })
  refresh(@Body() dto: RefreshTokenDto, @ClientIp() ip: string, @UserAgent() userAgent?: string) {
    return this.auth.refresh(dto.refreshToken, { ip, userAgent });
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoke a refresh token family (and immediately deny the presented access token)',
    description:
      'Send the refresh token in the body and the current access token as the Bearer header: the access token is denylisted for its remaining lifetime so it stops working right away on this device.',
  })
  async logout(@Body() dto: LogoutDto, @Headers('authorization') authorization?: string) {
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    await this.auth.logout(dto.refreshToken, accessToken);
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
