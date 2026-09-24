import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentAuth, Subjects } from '../../common/decorators/auth.decorators';
import { CampaignsService } from './campaigns.service';
import {
  CampaignsQueryDto,
  CreateAdDto,
  CreateCampaignDto,
  DateRangeQueryDto,
  PresignUploadDto,
  UpdateCampaignDto,
} from './dto/campaigns.dto';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('campaigns')
@Subjects('advertiser')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Advertiser dashboard cards + 30-day series' })
  overview(@CurrentAuth() auth: AuthContext) {
    return this.campaigns.overview(auth.subjectId);
  }

  @Post('uploads/presign')
  @ApiOperation({ summary: 'Get a presigned PUT URL for a creative (video/image) upload to object storage' })
  @ApiResponse({ status: 400, description: 'UPLOAD_TYPE_NOT_ALLOWED' })
  presign(@CurrentAuth() auth: AuthContext, @Body() dto: PresignUploadDto) {
    return this.campaigns.presignUpload(auth.subjectId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List my campaigns' })
  list(@CurrentAuth() auth: AuthContext, @Query() query: CampaignsQueryDto) {
    return this.campaigns.list(auth.subjectId, query);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create a draft campaign (reward per action is derived from cost x (1 - take rate))',
  })
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(auth.subjectId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Campaign detail including ads' })
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.detail(auth.subjectId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a draft/rejected campaign (paused: budget increase only)' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.update(auth.subjectId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a draft campaign' })
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.campaigns.remove(auth.subjectId, id);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit for review; reserves the budget from the wallet' })
  @ApiResponse({ status: 422, description: 'INSUFFICIENT_WALLET_BALANCE' })
  @ApiResponse({ status: 403, description: 'ADVERTISER_NOT_VERIFIED' })
  submit(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.submit(auth.subjectId, id);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause an active campaign' })
  pause(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.pause(auth.subjectId, id);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused campaign' })
  resume(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.resume(auth.subjectId, id);
  }

  @Get(':id/ads')
  @ApiOperation({ summary: 'List creatives of a campaign' })
  listAds(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.listAds(auth.subjectId, id);
  }

  @Post(':id/ads')
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a creative (enters the admin review queue)' })
  addAd(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAdDto) {
    return this.campaigns.addAd(auth.subjectId, id, dto);
  }

  @Delete(':id/ads/:adId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a non-approved creative' })
  async removeAd(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('adId', ParseUUIDPipe) adId: string,
  ) {
    await this.campaigns.removeAd(auth.subjectId, id, adId);
  }

  @Get(':id/analytics')
  @ApiOperation({ summary: 'Raw vs fraud-filtered performance with daily buckets' })
  analytics(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() range: DateRangeQueryDto,
  ) {
    return this.campaigns.analytics(auth.subjectId, id, range);
  }
}
