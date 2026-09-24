import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type Campaign, Prisma } from '@prisma/client';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../wallet/wallet.module';

/**
 * Campaign end-of-life handling shared by admin moderation and the scheduler:
 * releases the unspent part of the reserved budget back to the advertiser wallet exactly once.
 */
@Injectable()
export class CampaignLifecycleService {
  private readonly logger = new Logger(CampaignLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  /** Refund reserved-but-unspent budget (idempotent per campaign + reason). */
  async refundUnspent(tx: Prisma.TransactionClient, campaign: Campaign, reason: string) {
    const unspent = new Prisma.Decimal(campaign.budgetReservedEtb).minus(campaign.spentEtb);
    if (unspent.lessThanOrEqualTo(0)) return null;
    const write = await this.wallet.applyEntry(
      {
        advertiserId: campaign.advertiserId,
        amountEtb: unspent,
        entryType: 'campaign_budget_refund',
        referenceType: 'campaign',
        referenceId: campaign.id,
        idempotencyKey: `campaign_budget_refund:${campaign.id}:${reason}`,
        description: `Unspent budget released (${reason}) for "${campaign.title}"`,
      },
      tx,
    );
    await tx.campaign.update({ where: { id: campaign.id }, data: { budgetReservedEtb: campaign.spentEtb } });
    return write;
  }

  async complete(campaignId: string, reason: 'end_date_reached' | 'admin_completed', actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.campaign.findUnique({ where: { id: campaignId } });
      if (!c || !['active', 'paused'].includes(c.status)) return c;
      const updated = await tx.campaign.update({
        where: { id: campaignId },
        data: { status: 'completed', completedAt: new Date(), pausedReason: null },
      });
      await this.refundUnspent(tx, c, reason);
      await this.audit.record(
        {
          actorType: actorId ? 'admin' : 'system',
          actorId,
          action: 'campaign.completed',
          targetType: 'campaign',
          targetId: campaignId,
          before: { status: c.status },
          after: { status: 'completed', reason },
        },
        tx,
      );
      return updated;
    });
  }

  /** Hourly maintenance: end campaigns past their end date and expire stale watch sessions. */
  @Cron('15 * * * *')
  async hourlyMaintenance() {
    if (this.config.isTest || !this.config.env.QUEUES_ENABLED) return;
    try {
      const ended = await this.prisma.campaign.findMany({
        where: { status: { in: ['active', 'paused'] }, endDate: { lt: new Date() } },
        select: { id: true },
      });
      for (const c of ended) await this.complete(c.id, 'end_date_reached');
      const expired = await this.prisma.adWatchSession.updateMany({
        where: { status: 'active', expiresAt: { lt: new Date() } },
        data: { status: 'expired' },
      });
      if (ended.length || expired.count) {
        this.logger.log(
          `Maintenance: completed ${ended.length} campaign(s), expired ${expired.count} watch session(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(`Maintenance failed: ${(err as Error).message}`);
    }
  }
}
