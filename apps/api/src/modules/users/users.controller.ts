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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentAuth, Subjects } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/pagination';
import { NotificationService } from '../notifications/notifications.module';
import { CreateAdReportDto, RegisterPushTokenDto, UpdateProfileDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Subjects('user')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly notifications: NotificationService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile' })
  me(@CurrentAuth() auth: AuthContext) {
    return this.users.me(auth.subjectId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update name, language or notification preferences' })
  update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.users.update(auth.subjectId, dto);
  }

  @Get('me/summary')
  @ApiOperation({ summary: 'Home-screen summary: balance, daily progress, counts' })
  summary(@CurrentAuth() auth: AuthContext) {
    return this.users.summary(auth.subjectId);
  }

  @Get('me/balance')
  @ApiOperation({ summary: 'Coin balance with ledger checksum (source of truth; never compute locally)' })
  balance(@CurrentAuth() auth: AuthContext) {
    return this.users.balance(auth.subjectId);
  }

  @Get('me/ledger')
  @ApiOperation({ summary: 'Paginated coin ledger (transaction history)' })
  ledger(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.users.ledgerEntries(auth.subjectId, query);
  }

  @Get('me/notifications')
  @ApiOperation({ summary: 'In-app notification inbox' })
  notificationsList(@CurrentAuth() auth: AuthContext, @Query() query: PaginationQueryDto) {
    return this.notifications.list(auth.subjectId, query);
  }

  @Post('me/notifications/:id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(auth.subjectId, id);
  }

  @Post('me/push-tokens')
  @HttpCode(201)
  @ApiOperation({ summary: 'Register an FCM device token' })
  registerPushToken(@CurrentAuth() auth: AuthContext, @Body() dto: RegisterPushTokenDto) {
    return this.notifications.registerPushToken(auth.subjectId, dto.token, dto.platform, dto.deviceId);
  }

  @Delete('me/push-tokens/:token')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an FCM device token' })
  async removePushToken(@CurrentAuth() auth: AuthContext, @Param('token') token: string) {
    await this.notifications.removePushToken(auth.subjectId, decodeURIComponent(token));
  }

  @Post('me/ad-reports')
  @HttpCode(201)
  @ApiOperation({ summary: 'Report a bad ad' })
  reportAd(@CurrentAuth() auth: AuthContext, @Body() dto: CreateAdReportDto) {
    return this.users.reportAd(auth.subjectId, dto.adId, dto.reason, dto.details);
  }
}
