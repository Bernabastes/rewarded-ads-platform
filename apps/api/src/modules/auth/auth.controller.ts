import { Body, Controller, HttpCode, Post } from '@nestjs/common';
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
  AdvertiserRegisterDto,
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
  @ApiResponse({ status: 401, description: 'OTP_INVALID | OTP_EXPIRED' })
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
  @ApiOperation({ summary: 'Advertiser email + password login' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  loginAdvertiser(
    @Body() dto: EmailPasswordLoginDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent?: string,
  ) {
    return this.auth.loginAdvertiser(dto.email, dto.password, { ip, userAgent });
  }

  @Post('admin/login')
  @Public()
  @ApiOperation({ summary: 'Admin email + password login (role is embedded in the access token)' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  loginAdmin(@Body() dto: EmailPasswordLoginDto, @ClientIp() ip: string, @UserAgent() userAgent?: string) {
    return this.auth.loginAdmin(dto.email, dto.password, { ip, userAgent });
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
  @ApiOperation({ summary: 'Revoke a refresh token family' })
  async logout(@Body() dto: LogoutDto) {
    await this.auth.logout(dto.refreshToken);
  }
}
