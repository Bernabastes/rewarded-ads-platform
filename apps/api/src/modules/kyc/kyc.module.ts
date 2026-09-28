import { Body, Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { KycIdType, KycStatus } from '@prisma/client';
import { KYC_UPLOAD_LIMITS } from '@rap/shared';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  RequireVerifiedAdult,
  Roles,
  Subjects,
} from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/pagination';
import { AppConfig } from '../../config/app-config';
import { EthiopianDateDto } from '../auth/dto/auth.dto';
import { FaydaProvider, ID_VERIFICATION_PROVIDER, MockFaydaProvider } from './id-verification.provider';
import { KycService } from './kyc.service';

export class KycPresignDto {
  @IsIn([...KYC_UPLOAD_LIMITS.kinds])
  kind!: (typeof KYC_UPLOAD_LIMITS.kinds)[number];

  @IsString()
  @MaxLength(100)
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(KYC_UPLOAD_LIMITS.maxBytes)
  sizeBytes!: number;
}

export class CreateKycSubmissionDto {
  @IsEnum(KycIdType)
  idType!: KycIdType;

  @IsString()
  @MinLength(6)
  @MaxLength(40)
  idNumber!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiPropertyOptional({ example: '1990-05-14' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth?: string;

  @ApiPropertyOptional({ type: EthiopianDateDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => EthiopianDateDto)
  dateOfBirthEthiopian?: EthiopianDateDto;

  @IsString()
  @MaxLength(400)
  documentFrontKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  documentBackKey?: string;

  @IsString()
  @MaxLength(400)
  selfieKey!: string;
}

export class AdminKycQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(KycStatus)
  status?: KycStatus;

  @IsOptional()
  @IsEnum(KycIdType)
  idType?: KycIdType;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class KycDecisionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me/kyc')
@Subjects('user')
export class UserKycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @ApiOperation({ summary: 'My KYC tier, latest submission and whether a new one may be submitted' })
  mine(@CurrentAuth() auth: AuthContext) {
    return this.kyc.mine(auth.subjectId);
  }

  @Post('uploads/presign')
  @HttpCode(201)
  @RequireVerifiedAdult()
  @ApiOperation({
    summary: 'Presigned PUT for a KYC document (front/back/selfie) into the private storage prefix',
    description: 'Upload with the returned headers, then POST /users/me/kyc with the storage keys. Documents are never public.',
  })
  presign(@CurrentAuth() auth: AuthContext, @Body() dto: KycPresignDto) {
    return this.kyc.presignUpload(auth.subjectId, dto);
  }

  @Post()
  @HttpCode(201)
  @RequireVerifiedAdult()
  @ApiOperation({
    summary: 'Submit identity documents for review (Fayda / national id / passport)',
    description:
      'One pending submission at a time (409 KYC_SUBMISSION_PENDING). Only a hash + last 4 digits of the id number are stored. The id-registry pre-check (mock Fayda) is advisory; an admin decides.',
  })
  submit(@CurrentAuth() auth: AuthContext, @Body() dto: CreateKycSubmissionDto, @ClientIp() ip: string) {
    return this.kyc.submit(auth.subjectId, dto, ip);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/kyc')
@Subjects('admin')
@Roles('super_admin', 'support', 'finance')
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @ApiOperation({ summary: 'KYC review queue (default: pending)' })
  list(@Query() query: AdminKycQueryDto) {
    return this.kyc.adminList(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'KYC submission detail with 5-minute presigned document links' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.kyc.adminDetail(id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve: promotes the user to id_verified (audited)' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KycDecisionDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.kyc.decide(id, 'approved', { adminId: auth.subjectId, ip }, undefined, dto.note);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject (reason required; shown to the user)' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KycDecisionDto,
    @CurrentAuth() auth: AuthContext,
    @ClientIp() ip: string,
  ) {
    return this.kyc.decide(id, 'rejected', { adminId: auth.subjectId, ip }, dto.reason, dto.note);
  }
}

@Global()
@Module({
  controllers: [UserKycController, AdminKycController],
  providers: [
    KycService,
    {
      provide: ID_VERIFICATION_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.env.ID_VERIFICATION_PROVIDER === 'fayda' ? new FaydaProvider(config) : new MockFaydaProvider(),
    },
  ],
  exports: [KycService],
})
export class KycModule {}
