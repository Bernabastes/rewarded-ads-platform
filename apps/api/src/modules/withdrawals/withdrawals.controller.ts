import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  RequireConsent,
  RequireVerifiedAdult,
  Subjects,
} from '../../common/decorators/auth.decorators';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor';
import { DestinationsService } from './destinations/destinations.service';
import {
  CreateWithdrawalDto,
  ResolveDestinationDto,
  VerifyDestinationOtpDto,
  WithdrawalsQueryDto,
} from './dto/withdrawals.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('withdrawals')
@ApiBearerAuth()
@Controller('withdrawals')
@Subjects('user')
export class WithdrawalsController {
  constructor(
    private readonly withdrawals: WithdrawalsService,
    private readonly destinations: DestinationsService,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: 'Withdrawal thresholds, conversion rate, payout methods, KYC tier and known destinations',
    description:
      'Includes the caller\'s `kycTier`, rolling 30-day `monthlyPayoutTotalEtb`, the `kycRequiredAboveMonthlyEtb` threshold (KYC is required once payouts + the new request reach it - at or above) and `knownDestinations` (already used, no lookup/OTP needed).',
  })
  config(@CurrentAuth() auth: AuthContext) {
    return this.withdrawals.getConfigForUser(auth.subjectId);
  }

  /* ------------------------------ destinations ------------------------------ */

  @Get('destinations')
  @ApiOperation({ summary: 'Payout destinations the user has verified / used (masked)' })
  listDestinations(@CurrentAuth() auth: AuthContext) {
    return this.destinations.listKnown(auth.subjectId);
  }

  @Post('destinations/resolve')
  @HttpCode(200)
  @RequireVerifiedAdult()
  @ApiOperation({
    summary: 'Look up the account holder name for a payout destination (required for NEW destinations)',
    description:
      'Known destinations (and ones whose OTP re-check is fresh) are looked up at the payout partner (telebirr / Chapa; MOCK returns a deterministic name) and `accountName` is returned. ' +
      'Security audit #11: for a NEW destination NO partner call is made - the response is `{ accountName: null, otpRequired: true, lookupPerformed: false }`; request + verify the destination OTP, and the verify response reveals the holder name. ' +
      'Every partner lookup counts toward DESTINATION_LOOKUPS_PER_DAY (`lookupsRemainingToday`). Valid for `destinationResolveTtlMinutes`. Send back `normalizedDestination` as `payoutDestination`.',
  })
  @ApiResponse({ status: 422, description: 'DESTINATION_NOT_FOUND' })
  @ApiResponse({ status: 429, description: 'DESTINATION_LOOKUP_LIMIT' })
  @ApiResponse({ status: 503, description: 'PAYOUT_METHOD_UNAVAILABLE | SERVICE_UNAVAILABLE' })
  resolve(@CurrentAuth() auth: AuthContext, @Body() dto: ResolveDestinationDto, @ClientIp() ip: string) {
    const destination = this.withdrawals.validateDestination({
      payoutMethod: dto.payoutMethod,
      payoutDestination: dto.payoutDestination,
      bankCode: dto.bankCode,
      destinationName: 'lookup',
    });
    return this.destinations.resolve(auth.subjectId, { payoutMethod: dto.payoutMethod, destination, bankCode: dto.bankCode }, ip);
  }

  @Post('destinations/otp/request')
  @HttpCode(200)
  @RequireVerifiedAdult()
  @ApiOperation({
    summary: 'Send an OTP (purpose destination_change) to the user\'s own phone before paying out to a NEW destination',
  })
  @ApiResponse({ status: 429, description: 'OTP_RATE_LIMITED' })
  requestDestinationOtp(@CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.destinations.requestOtp(auth.subjectId, ip);
  }

  @Post('destinations/otp/verify')
  @HttpCode(200)
  @RequireVerifiedAdult()
  @ApiOperation({
    summary: 'Confirm the destination_change OTP for a specific destination (then performs the partner lookup)',
    description:
      'Security audit #11: after a valid code the partner lookup for this destination runs here and the account holder name is returned (`accountName`, `provider`, `mock`, `validUntil`). 422 DESTINATION_NOT_FOUND when the partner has no such account; 429 DESTINATION_LOOKUP_LIMIT when the daily lookup cap is used up.',
  })
  @ApiResponse({ status: 400, description: 'OTP_INVALID | OTP_EXPIRED' })
  @ApiResponse({ status: 422, description: 'DESTINATION_NOT_FOUND' })
  @ApiResponse({ status: 429, description: 'OTP_TOO_MANY_ATTEMPTS | DESTINATION_LOOKUP_LIMIT' })
  verifyDestinationOtp(@CurrentAuth() auth: AuthContext, @Body() dto: VerifyDestinationOtpDto, @ClientIp() ip: string) {
    const destination = this.withdrawals.validateDestination({
      payoutMethod: dto.payoutMethod,
      payoutDestination: dto.payoutDestination,
      bankCode: dto.bankCode,
      destinationName: 'lookup',
    });
    return this.destinations.verifyOtp(
      auth.subjectId,
      dto.code,
      { payoutMethod: dto.payoutMethod, destination, bankCode: dto.bankCode },
      ip,
    );
  }

  /* ------------------------------ requests ------------------------------ */

  @Post()
  @HttpCode(201)
  @RequireVerifiedAdult()
  @RequireConsent()
  @Idempotent()
  @ApiOperation({
    summary: 'Request a withdrawal (supports Idempotency-Key)',
    description:
      'Converts ETB to coins and holds them in the same transaction. First-ever withdrawals, amounts >= the large threshold and low-trust accounts are held for manual review (`flagged_for_review`); otherwise the payout is queued immediately (`pending`). NEW destinations need a fresh lookup + OTP re-check; phone_only users must stay strictly below KYC_REQUIRED_ABOVE_MONTHLY_ETB per rolling 30 days (a projected total at or above it => 422 KYC_REQUIRED). The platform never holds funds: payouts execute through telebirr/Chapa.',
  })
  @ApiResponse({ status: 400, description: 'BELOW_MIN_WITHDRAWAL | INVALID_PAYOUT_DESTINATION' })
  @ApiResponse({ status: 403, description: 'CONSENT_REQUIRED' })
  @ApiResponse({ status: 409, description: 'WITHDRAWAL_PENDING_EXISTS | IDEMPOTENCY_KEY_REUSED' })
  @ApiResponse({
    status: 422,
    description: 'INSUFFICIENT_BALANCE | KYC_REQUIRED | DESTINATION_NOT_VERIFIED | DESTINATION_OTP_REQUIRED',
  })
  @ApiResponse({ status: 429, description: 'WITHDRAWAL_RATE_LIMITED' })
  request(@CurrentAuth() auth: AuthContext, @Body() dto: CreateWithdrawalDto, @ClientIp() ip: string) {
    return this.withdrawals.request(auth.subjectId, dto, ip);
  }

  @Get()
  @ApiOperation({ summary: 'Withdrawal history' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: WithdrawalsQueryDto) {
    return this.withdrawals.listForUser(auth.subjectId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Withdrawal status' })
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.withdrawals.getForUser(auth.subjectId, id);
  }
}
