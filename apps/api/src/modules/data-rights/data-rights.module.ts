import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeletionRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { type AuthContext, ClientIp, CurrentAuth, Roles, Subjects } from '../../common/decorators/auth.decorators';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { PaginationQueryDto } from '../../common/pagination';
import { DataRightsProcessor, DataRightsScheduler, DataRightsService } from './data-rights.service';

export class CreateDeletionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminDeletionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(DeletionRequestStatus)
  status?: DeletionRequestStatus;
}

export class AdminDeletionNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
@Subjects('user')
export class UserDataRightsController {
  constructor(private readonly service: DataRightsService) {}

  @Post('data-export')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Request an export of all my data (async; notification with a download link when ready)',
  })
  requestExport(@CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.service.requestExport(auth.subjectId, ip);
  }

  @Get('data-export')
  @ApiOperation({ summary: 'My recent data exports' })
  listExports(@CurrentAuth() auth: AuthContext) {
    return this.service.listExports(auth.subjectId);
  }

  @Get('data-export/:id')
  @ApiOperation({ summary: 'Export status; `downloadUrl` is a short-lived presigned link once ready' })
  getExport(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getExport(auth.subjectId, id);
  }

  @Post('delete-request')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Request account deletion (executed after the grace period; cancellable until then)',
    description:
      'Blocked while withdrawals are in flight (409 DELETION_BLOCKED_PENDING_WITHDRAWALS). Execution anonymises personal data but retains ledger, completions and audit records (financial-record obligations).',
  })
  requestDeletion(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDeletionRequestDto, @ClientIp() ip: string) {
    return this.service.requestDeletion(auth.subjectId, dto.reason, ip);
  }

  @Get('delete-request')
  @ApiOperation({ summary: 'My latest deletion request: { request: DeletionRequestItem | null }' })
  myDeletion(@CurrentAuth() auth: AuthContext) {
    return this.service.myDeletionRequest(auth.subjectId);
  }

  @Delete('delete-request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel my pending deletion request' })
  cancelDeletion(@CurrentAuth() auth: AuthContext, @ClientIp() ip: string) {
    return this.service.cancelOwnDeletion(auth.subjectId, ip);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/deletion-requests')
@Subjects('admin')
@Roles('super_admin', 'support')
export class AdminDeletionRequestsController {
  constructor(private readonly service: DataRightsService) {}

  @Get()
  @ApiOperation({ summary: 'Account deletion requests (default: pending) with in-flight withdrawal counts' })
  list(@Query() query: AdminDeletionQueryDto) {
    return this.service.adminList(query);
  }

  @Post(':id/execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Execute a deletion now (anonymise PII; keep financial records). Audited. Returns the list-row shape (AdminDeletionRequestItem).' })
  async execute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDeletionNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    await this.service.execute(id, { actorType: 'admin', actorId: auth.subjectId, ip, note: dto.note });
    return this.service.adminItem(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a pending deletion request on the user\'s behalf (e.g. support ticket). Audited. Returns the list-row shape (AdminDeletionRequestItem).' })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDeletionNoteDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    await this.service.cancel(id, { actorType: 'admin', actorId: auth.subjectId, ip, note: dto.note });
    return this.service.adminItem(id);
  }
}

@Module({
  controllers: [UserDataRightsController, AdminDeletionRequestsController],
  providers: [DataRightsService, DataRightsProcessor, DataRightsScheduler, IdempotencyInterceptor],
  exports: [DataRightsService],
})
export class DataRightsModule {}
