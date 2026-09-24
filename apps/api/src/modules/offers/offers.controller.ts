import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  RequireVerifiedAdult,
  Subjects,
} from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/pagination';
import { CompleteAppInstallDto, CompleteSurveyDto, OffersQueryDto } from './dto/offers.dto';
import { OffersService } from './offers.service';

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
@Subjects('user')
@RequireVerifiedAdult()
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @ApiOperation({
    summary: 'Surveys and app-install offers available to the user (higher value than plain ads)',
  })
  list(@CurrentAuth() auth: AuthContext, @Query() query: OffersQueryDto) {
    return this.offers.list(auth.subjectId, query);
  }

  @Get('me/completions')
  @ApiOperation({ summary: 'Offer completion history' })
  myCompletions(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.offers.myCompletions(auth.subjectId, query);
  }

  @Get('surveys/:id')
  @ApiOperation({ summary: 'Survey detail with questions' })
  survey(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.survey(auth.subjectId, id);
  }

  @Post('surveys/:id/complete')
  @ApiOperation({ summary: 'Submit survey answers (validated; credited immediately)' })
  completeSurvey(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSurveyDto,
    @ClientIp() ip: string,
  ) {
    return this.offers.completeSurvey(auth.subjectId, id, dto.answers, ip);
  }

  @Get('app-installs/:id')
  @ApiOperation({ summary: 'App-install offer detail' })
  appInstall(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.appInstall(auth.subjectId, id);
  }

  @Post('app-installs/:id/complete')
  @ApiOperation({
    summary: 'Report an app install (recorded as pending verification; credited after admin verification)',
  })
  completeAppInstall(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteAppInstallDto,
  ) {
    return this.offers.completeAppInstall(auth.subjectId, id, dto);
  }
}
