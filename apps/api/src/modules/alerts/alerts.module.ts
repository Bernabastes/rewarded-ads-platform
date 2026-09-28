import { Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AlertSeverity } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { type AuthContext, ClientIp, CurrentAuth, Roles, Subjects } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/pagination';
import { ToBoolean } from '../../common/transformers/to-boolean';
import { AppConfig } from '../../config/app-config';
import { AlertRulesProcessor, AlertRulesScheduler, AlertService } from './alerts.service';
import { ALERT_NOTIFIERS, buildNotifiers } from './notifiers';

export class AdminAlertsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  type?: string;

  @IsOptional()
  @IsEnum(AlertSeverity)
  severity?: AlertSeverity;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  acknowledged?: boolean;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}/)
  to?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/alerts')
@Subjects('admin')
@Roles('super_admin', 'finance', 'support')
export class AdminAlertsController {
  constructor(private readonly alerts: AlertService) {}

  @Get()
  @ApiOperation({
    summary: 'Money-day alerts (ledger drift, payout failure rate, account minting, spend velocity, OTP spikes)',
    description: '`meta.openCount` = unacknowledged alerts; `meta.notifiers` lists the configured delivery channels.',
  })
  list(@Query() query: AdminAlertsQueryDto) {
    return this.alerts.list(query);
  }

  @Post('run-rules')
  @HttpCode(200)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Evaluate all alert rules now (normally runs on ALERT_RULES_CRON)' })
  run() {
    return this.alerts.runRules();
  }

  @Post(':id/ack')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acknowledge an alert (audited)' })
  ack(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.alerts.acknowledge(id, { adminId: auth.subjectId, ip });
  }
}

@Global()
@Module({
  controllers: [AdminAlertsController],
  providers: [
    AlertService,
    AlertRulesProcessor,
    AlertRulesScheduler,
    { provide: ALERT_NOTIFIERS, inject: [AppConfig], useFactory: (config: AppConfig) => buildNotifiers(config) },
  ],
  exports: [AlertService],
})
export class AlertsModule {}