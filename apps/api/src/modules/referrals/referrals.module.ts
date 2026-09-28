import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReferralStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { type AuthContext, CurrentAuth, Roles, Subjects } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/pagination';
import { ReferralsService } from './referrals.service';

export class AdminReferralsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ReferralStatus)
  status?: ReferralStatus;

  @IsOptional()
  @IsUUID()
  referrerId?: string;

  @IsOptional()
  @IsUUID()
  refereeId?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me/referrals')
@Subjects('user')
export class UserReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @ApiOperation({
    summary: 'My referral code, share text, invited friends and bonus totals',
    description:
      'Bonuses are credited only when the invited friend completes their FIRST valid ad (same transaction). Referrals from the same device or IP are rejected and flagged.',
  })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.referrals.myReferrals(auth.subjectId);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/referrals')
@Subjects('admin')
@Roles('super_admin', 'finance', 'support')
export class AdminReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @ApiOperation({ summary: 'All referrals (filter by status / referrer / referee)' })
  list(@Query() query: AdminReferralsQueryDto) {
    return this.referrals.adminList(query);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Referral programme metrics (counts, bonus cost, top referrers)' })
  metrics() {
    return this.referrals.adminMetrics();
  }
}

@Global()
@Module({
  controllers: [UserReferralsController, AdminReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
