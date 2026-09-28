import { Body, Controller, Get, Global, HttpCode, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  Public,
  Subjects,
} from '../../common/decorators/auth.decorators';
import { type ConsentAudience, LegalService } from './legal.service';

export class LegalCurrentQueryDto {
  @IsOptional()
  @IsIn(['am', 'en', 'om', 'ti'])
  locale?: 'am' | 'en' | 'om' | 'ti';

  @IsOptional()
  @IsIn(['user', 'advertiser'])
  audience?: ConsentAudience;
}

export class AcceptConsentDto {
  @IsEnum(['terms', 'privacy'])
  kind!: 'terms' | 'privacy';

  @IsString()
  @MaxLength(32)
  version!: string;
}

@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('current')
  @Public()
  @ApiOperation({
    summary: 'Current terms of service and privacy notice',
    description:
      'One document per kind in the requested locale (`am` default; falls back to `en`). `audience=advertiser` returns the advertiser terms only. Clients show these before asking for consent.',
  })
  current(@Query() query: LegalCurrentQueryDto) {
    return this.legal.current(query.locale ?? 'am', query.audience ?? 'user');
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me/consents')
@Subjects('user')
export class UserConsentsController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  @ApiOperation({ summary: 'Consent state per legal document kind' })
  state(@CurrentAuth() auth: AuthContext) {
    return this.legal.userConsentState(auth.subjectId);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept the current version of the terms or privacy notice',
    description: 'Returns the updated consent state. 409 CONSENT_VERSION_OUTDATED when `version` is not current.',
  })
  accept(@CurrentAuth() auth: AuthContext, @Body() dto: AcceptConsentDto, @ClientIp() ip: string) {
    return this.legal.acceptUserConsent(auth.subjectId, dto.kind, dto.version, { ip });
  }
}

@ApiTags('advertisers')
@ApiBearerAuth()
@Controller('advertisers/me/consents')
@Subjects('advertiser')
export class AdvertiserConsentsController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  @ApiOperation({ summary: 'Advertiser terms acceptance state' })
  state(@CurrentAuth() auth: AuthContext) {
    return this.legal.advertiserConsentState(auth.subjectId);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept the current advertiser terms version (required before submitting campaigns)' })
  accept(@CurrentAuth() auth: AuthContext, @Body() dto: AcceptConsentDto, @ClientIp() ip: string) {
    return this.legal.acceptAdvertiserConsent(auth.subjectId, dto.kind, dto.version, ip);
  }
}

@Global()
@Module({
  controllers: [LegalController, UserConsentsController, AdvertiserConsentsController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
