import { Body, Controller, Get, Module, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { type AuthContext, ClientIp, CurrentAuth, Subjects } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_ADVERTISER_NOTIFICATION_PREFS, toAdvertiserProfile } from '../auth/auth.service';
import { LegalService } from '../legal/legal.service';
import { type AdvertiserNotificationPrefsDto, UpdateAdvertiserProfileDto } from './dto/advertisers.dto';

@ApiTags('advertisers')
@ApiBearerAuth()
@Controller('advertisers')
@Subjects('advertiser')
export class AdvertisersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly legal: LegalService,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Current advertiser profile (fresh verificationStatus, wallet balance, preferences, terms acceptance)',
  })
  async me(@CurrentAuth() auth: AuthContext) {
    const [advertiser, consent] = await Promise.all([
      this.prisma.advertiser.findUniqueOrThrow({ where: { id: auth.subjectId } }),
      this.legal.advertiserConsentState(auth.subjectId),
    ]);
    return toAdvertiserProfile(advertiser, consent);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update business name, contact phone or notification preferences',
    description:
      'Registration number and email are identity fields and cannot be changed here (contact support).',
  })
  async update(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdateAdvertiserProfileDto,
    @ClientIp() ip: string,
  ) {
    const before = await this.prisma.advertiser.findUniqueOrThrow({ where: { id: auth.subjectId } });
    const prefs = mergePrefs(before.notificationPrefs, dto.notificationPrefs);
    const updated = await this.prisma.advertiser.update({
      where: { id: auth.subjectId },
      data: {
        businessName: dto.businessName?.trim(),
        contactPhone: dto.contactPhone?.trim(),
        notificationPrefs: prefs as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorType: 'advertiser',
      actorId: auth.subjectId,
      action: 'advertiser.profile_updated',
      targetType: 'advertiser',
      targetId: auth.subjectId,
      before: {
        businessName: before.businessName,
        contactPhone: before.contactPhone,
        notificationPrefs: before.notificationPrefs,
      },
      after: {
        businessName: updated.businessName,
        contactPhone: updated.contactPhone,
        notificationPrefs: prefs,
      },
      ipAddress: ip,
    });
    return toAdvertiserProfile(updated, await this.legal.advertiserConsentState(auth.subjectId));
  }
}

function mergePrefs(current: Prisma.JsonValue, patch?: AdvertiserNotificationPrefsDto) {
  const base = {
    ...DEFAULT_ADVERTISER_NOTIFICATION_PREFS,
    ...((current as Record<string, boolean> | null) ?? {}),
  };
  if (!patch) return base;
  for (const key of ['campaignReviews', 'billing', 'weeklyReport'] as const) {
    if (typeof patch[key] === 'boolean') base[key] = patch[key] as boolean;
  }
  return base;
}

@Module({ controllers: [AdvertisersController] })
export class AdvertisersModule {}
