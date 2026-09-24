import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  RequireVerifiedAdult,
  Subjects,
} from '../../common/decorators/auth.decorators';
import { CreateWithdrawalDto, WithdrawalsQueryDto } from './dto/withdrawals.dto';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('withdrawals')
@ApiBearerAuth()
@Controller('withdrawals')
@Subjects('user')
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get('config')
  @ApiOperation({ summary: 'Withdrawal thresholds, conversion rate and available payout methods' })
  config() {
    return this.withdrawals.getConfig();
  }

  @Post()
  @HttpCode(201)
  @RequireVerifiedAdult()
  @ApiOperation({
    summary: 'Request a withdrawal',
    description:
      'Converts ETB to coins and holds them in the same transaction. First-ever withdrawals, amounts >= the large threshold and low-trust accounts are held for manual review (`flagged_for_review`); otherwise the payout is queued immediately (`pending`). The platform never holds funds: payouts execute through telebirr/Chapa.',
  })
  @ApiResponse({ status: 400, description: 'BELOW_MIN_WITHDRAWAL | INVALID_PAYOUT_DESTINATION' })
  @ApiResponse({ status: 409, description: 'WITHDRAWAL_PENDING_EXISTS' })
  @ApiResponse({ status: 422, description: 'INSUFFICIENT_BALANCE' })
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
