import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { startOfUtcDay } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationService } from '../notifications/notifications.module';
import { type NotificationPrefsDto, type UpdateProfileDto } from './dto/users.dto';
import { DEFAULT_NOTIFICATION_PREFS, toUserProfile } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
  ) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('User not found');
    return toUserProfile(user);
  }

  async update(userId: string, dto: UpdateProfileDto) {
    const current = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!current) throw AppException.notFound('User not found');
    const prefs = mergePrefs(current.notificationPrefs, dto.notificationPrefs);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: dto.fullName?.trim(),
        languagePreference: dto.languagePreference,
        notificationPrefs: prefs as unknown as Prisma.InputJsonValue,
      },
    });
    return toUserProfile(user);
  }

  balance(userId: string) {
    return this.ledger.getBalance(userId);
  }

  ledgerEntries(userId: string, query: { page?: number; limit?: number }) {
    return this.ledger.listEntries(userId, query);
  }

  async summary(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { coinBalance: true, status: true } });
    if (!user) throw AppException.notFound('User not found');
    const today = startOfUtcDay();
    const [todayCompletions, earned, withdrawn, pending, unread, availableAds, availableOffers] = await Promise.all([
      this.prisma.adCompletion.count({ where: { userId, status: 'valid', completedAt: { gte: today } } }),
      this.prisma.coinLedger.aggregate({ where: { userId, amount: { gt: 0 }, sourceType: { in: ['ad_view', 'survey', 'app_install'] } }, _sum: { amount: true } }),
      this.prisma.withdrawal.aggregate({ where: { userId, status: 'completed' }, _sum: { amountEtb: true } }),
      this.prisma.withdrawal.aggregate({ where: { userId, status: { in: ['pending', 'processing', 'flagged_for_review'] } }, _sum: { amountEtb: true } }),
      this.notifications.unreadCount(userId),
      this.countAvailableAds(userId),
      this.countAvailableOffers(userId),
    ]);
    const limit = this.config.platform.dailyAdCompletionLimit;
    return {
      coinBalance: user.coinBalance,
      etbEquivalent: Math.round((user.coinBalance / this.config.platform.coinsPerEtb) * 100) / 100,
      todayCompletions,
      dailyLimit: limit,
      dailyRemaining: Math.max(0, limit - todayCompletions),
      totalEarnedCoins: earned._sum.amount ?? 0,
      totalWithdrawnEtb: withdrawn._sum.amountEtb ?? new Prisma.Decimal(0),
      pendingWithdrawalsEtb: pending._sum.amountEtb ?? new Prisma.Decimal(0),
      unreadNotifications: unread,
      availableAds,
      availableOffers,
    };
  }

  private async countAvailableAds(userId: string) {
    return this.prisma.ad.count({
      where: {
        reviewStatus: 'approved',
        campaign: { status: 'active', targetActionType: 'video_view' },
        completions: { none: { userId, status: { in: ['valid', 'flagged'] } } },
      },
    });
  }

  private async countAvailableOffers(userId: string) {
    const [surveys, installs] = await Promise.all([
      this.prisma.survey.count({ where: { active: true, campaign: { status: 'active' }, responses: { none: { userId } } } }),
      this.prisma.appInstallOffer.count({ where: { active: true, campaign: { status: 'active' }, completions: { none: { userId } } } }),
    ]);
    return surveys + installs;
  }

  async reportAd(userId: string, adId: string, reason: Prisma.AdReportCreateInput['reason'], details?: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id: adId }, select: { id: true } });
    if (!ad) throw AppException.notFound('Ad not found');
    const existing = await this.prisma.adReport.findUnique({ where: { userId_adId: { userId, adId } } });
    if (existing) throw AppException.conflict(ErrorCode.CONFLICT, 'You already reported this ad');
    return this.prisma.adReport.create({
      data: { userId, adId, reason, details },
      select: { id: true, adId: true, userId: true, reason: true, details: true, status: true, createdAt: true },
    });
  }
}

function mergePrefs(current: Prisma.JsonValue, patch?: NotificationPrefsDto) {
  const base = { ...DEFAULT_NOTIFICATION_PREFS, ...((current as Record<string, boolean>) ?? {}) };
  if (!patch) return base;
  for (const key of ['rewards', 'withdrawals', 'offers'] as const) {
    if (typeof patch[key] === 'boolean') base[key] = patch[key] as boolean;
  }
  return base;
}
