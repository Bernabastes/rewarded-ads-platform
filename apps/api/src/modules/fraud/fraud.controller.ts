import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthContext, ClientIp, CurrentAuth, Roles, Subjects } from '../../common/decorators/auth.decorators';
import { CreateFraudFlagDto, ResolveFraudFlagDto } from './dto/fraud.dto';
import { FraudService } from './fraud.service';

/** Internal fraud endpoints (admin tokens only). The admin dashboard uses /admin/fraud/* for list views. */
@ApiTags('fraud')
@ApiBearerAuth()
@Controller('fraud')
@Subjects('admin')
@Roles('super_admin', 'support', 'finance')
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get('rules')
  @ApiOperation({ summary: 'List the completion fraud rules with their weights' })
  rules() {
    return this.fraud.listRules();
  }

  @Post('flags')
  @ApiOperation({ summary: 'Create a manual fraud flag' })
  createFlag(@Body() dto: CreateFraudFlagDto, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.fraud.createFlag(dto, { adminId: auth.subjectId, ip });
  }

  @Post('flags/:id/resolve')
  @ApiOperation({ summary: 'Resolve a flag (dismissed / escalated / confirmed)' })
  resolveFlag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveFraudFlagDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.fraud.resolveFlag(id, dto.resolution, dto.note, { adminId: auth.subjectId, ip });
  }

  @Post('users/:userId/recompute-trust')
  @ApiOperation({ summary: 'Recompute a user trust score from completions, withdrawals and open flags' })
  recompute(@Param('userId', ParseUUIDPipe) userId: string, @CurrentAuth() auth: AuthContext) {
    return this.fraud.recomputeTrustScore(userId, { adminId: auth.subjectId });
  }
}
