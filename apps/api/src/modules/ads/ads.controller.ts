import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  ClientIp,
  CurrentAuth,
  RequireVerifiedAdult,
  Subjects,
  UserAgent,
} from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/pagination';
import { AdsService } from './ads.service';
import { CompleteWatchSessionDto, HeartbeatDto, StartWatchSessionDto } from './dto/ads.dto';

@ApiTags('ads')
@ApiBearerAuth()
@Controller('ads')
@Subjects('user')
@RequireVerifiedAdult()
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get('feed')
  @ApiOperation({
    summary: 'Personalised, server-filtered ad feed',
    description:
      'Only approved ads of active, funded campaigns the user has not been credited for. Empty when the daily cap is reached or the trust score is too low. `meta` includes dailyLimit/dailyCompleted/dailyRemaining.',
  })
  feed(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.ads.feed(auth.subjectId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ad detail' })
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.ads.getAd(auth.subjectId, id);
  }

  @Post(':id/watch-sessions')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Start a server-timed watch session',
    description:
      'Records started_at, device fingerprint and IP on the server. Returns the heartbeat interval, minimum watch seconds and (optionally) an attention question that must be answered at completion.',
  })
  @ApiResponse({ status: 400, description: 'AD_NOT_AVAILABLE | DAILY_LIMIT_REACHED | TOO_MANY_WATCH_ATTEMPTS' })
  start(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) adId: string,
    @Body() dto: StartWatchSessionDto,
    @ClientIp() ip: string,
    @UserAgent() userAgent?: string,
  ) {
    return this.ads.startWatchSession(auth.subjectId, adId, dto, { ip, userAgent });
  }

  @Post('watch-sessions/:sid/heartbeat')
  @ApiOperation({ summary: 'Heartbeat while the ad is playing (call every heartbeatIntervalSeconds)' })
  @ApiResponse({ status: 400, description: 'WATCH_SESSION_NOT_ACTIVE | WATCH_SESSION_EXPIRED' })
  heartbeat(@CurrentAuth() auth: AuthContext, @Param('sid', ParseUUIDPipe) sid: string, @Body() _dto: HeartbeatDto) {
    return this.ads.heartbeat(auth.subjectId, sid);
  }

  @Post('watch-sessions/:sid/complete')
  @ApiOperation({
    summary: 'Complete a watch session (server decides the reward)',
    description:
      'Watch duration = server now - server started_at. Verifies min/max duration, heartbeat continuity, attention answer, daily cap and fraud signals, then credits the ledger in one transaction. Idempotent: repeating the call returns the same result (`replayed: true`) and never double-credits. Result status: valid | flagged | rejected with `reasonCode`.',
  })
  complete(
    @CurrentAuth() auth: AuthContext,
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: CompleteWatchSessionDto,
    @ClientIp() ip: string,
  ) {
    return this.ads.completeWatchSession(auth.subjectId, sid, dto, { ip });
  }
}
