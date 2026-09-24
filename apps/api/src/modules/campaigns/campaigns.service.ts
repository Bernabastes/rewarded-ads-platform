import { Injectable, Logger } from '@nestjs/common';
import { type Campaign, type CampaignStatus, Prisma } from '@prisma/client';
import { ErrorCode, UPLOAD_LIMITS } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { eachUtcDay, parseDateRange, utcDayKey } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../wallet/wallet.module';
import { computeRewardPerAction, rewardCoins } from './campaign.economics';
import type { CreateAdDto, CreateCampaignDto, UpdateCampaignDto } from './dto/campaigns.dto';

const campaignSummaryInclude = {
  _count: { select: { ads: true } },
  ads: { select: { reviewStatus: true } },
} satisfies Prisma.CampaignInclude;

type CampaignWithCounts = Prisma.CampaignGetPayload<{ include: typeof campaignSummaryInclude }> & {
  completionCounts?: { raw: number; valid: number };
};

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------ CRUD ------------------------------ */

  async list(advertiserId: string, query: { page?: number; limit?: number; status?: CampaignStatus }) {
    const p = pageArgs(query);
    const where: Prisma.CampaignWhereInput = { advertiserId, status: query.status };
    const [rows, total] = await Promise.all([
      this.prisma.campaign.findMany({ where, include: campaignSummaryInclude, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
      this.prisma.campaign.count({ where }),
    ]);
    const counts = await this.completionCounts(rows.map((r) => r.id));
    return paginated(rows.map((c) => this.toSummary({ ...c, completionCounts: counts.get(c.id) })), total, p);
  }

  async create(advertiserId: string, dto: CreateCampaignDto) {
    this.assertEconomics(dto.budgetEtb, dto.costPerActionEtb);
    this.assertDates(dto.startDate, dto.endDate);
    const takeRate = this.config.platform.platformTakeRate;
    const campaign = await this.prisma.campaign.create({
      data: {
        advertiserId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        budgetEtb: new Prisma.Decimal(dto.budgetEtb),
        costPerActionEtb: new Prisma.Decimal(dto.costPerActionEtb),
        rewardPerActionEtb: computeRewardPerAction(dto.costPerActionEtb, takeRate),
        takeRateSnapshot: new Prisma.Decimal(takeRate),
        targetActionType: dto.targetActionType,
        startDate: dto.startDate ? new Date(`${dto.startDate}T00:00:00Z`) : null,
        endDate: dto.endDate ? new Date(`${dto.endDate}T00:00:00Z`) : null,
        attentionCheckEnabled: dto.attentionCheckEnabled ?? true,
      },
      include: campaignSummaryInclude,
    });
    await this.audit.record({ actorType: 'advertiser', actorId: advertiserId, action: 'campaign.created', targetType: 'campaign', targetId: campaign.id, after: this.toSummary(campaign) });
    return this.toSummary(campaign);
  }

  async detail(advertiserId: string, id: string) {
    const c = await this.owned(advertiserId, id, {
      ...campaignSummaryInclude,
      ads: { include: { _count: { select: { attentionQuestions: true } } }, orderBy: { createdAt: 'desc' } },
    });
    const counts = await this.completionCounts([id]);
    return {
      ...this.toSummary({ ...c, ads: c.ads.map((a) => ({ reviewStatus: a.reviewStatus })), completionCounts: counts.get(id) }),
      ads: c.ads.map((a) => this.toAdSummary(a)),
    };
  }

  async update(advertiserId: string, id: string, dto: UpdateCampaignDto) {
    const c = await this.owned(advertiserId, id, campaignSummaryInclude);
    const editable: CampaignStatus[] = ['draft', 'rejected', 'paused'];
    if (!editable.includes(c.status)) {
      throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Campaign in status ${c.status} cannot be edited`);
    }
    if (c.status === 'paused') {
      // live campaigns: only the budget (increase) and dates/description/title may change
      const forbidden = ['costPerActionEtb', 'targetActionType'].filter((k) => dto[k as keyof UpdateCampaignDto] !== undefined);
      if (forbidden.length) throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Cannot change ${forbidden.join(', ')} of a live campaign`);
      if (dto.budgetEtb !== undefined && new Prisma.Decimal(dto.budgetEtb).lessThan(c.budgetEtb)) {
        throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, 'Budget of a live campaign can only be increased');
      }
    }
    const budget = dto.budgetEtb ?? Number(c.budgetEtb);
    const cost = dto.costPerActionEtb ?? Number(c.costPerActionEtb);
    this.assertEconomics(budget, cost);
    this.assertDates(dto.startDate ?? (c.startDate ? utcDayKey(c.startDate) : undefined), dto.endDate ?? (c.endDate ? utcDayKey(c.endDate) : undefined));

    const updated = await this.prisma.$transaction(async (tx) => {
      if (c.status === 'paused' && dto.budgetEtb !== undefined) {
        const extra = new Prisma.Decimal(dto.budgetEtb).minus(c.budgetEtb);
        if (extra.greaterThan(0)) {
          await this.wallet.applyEntry(
            { advertiserId, amountEtb: extra.negated(), entryType: 'campaign_budget_reservation', referenceType: 'campaign', referenceId: id, idempotencyKey: `campaign_budget_increase:${id}:${Date.now()}`, description: `Budget increase for "${c.title}"` },
            tx,
          );
          await tx.campaign.update({ where: { id }, data: { budgetReservedEtb: { increment: extra }, pausedReason: c.pausedReason === 'budget_exhausted' ? null : c.pausedReason } });
        }
      }
      return tx.campaign.update({
        where: { id },
        data: {
          title: dto.title?.trim(),
          description: dto.description?.trim(),
          budgetEtb: dto.budgetEtb !== undefined ? new Prisma.Decimal(dto.budgetEtb) : undefined,
          costPerActionEtb: dto.costPerActionEtb !== undefined ? new Prisma.Decimal(dto.costPerActionEtb) : undefined,
          rewardPerActionEtb: dto.costPerActionEtb !== undefined ? computeRewardPerAction(dto.costPerActionEtb, Number(c.takeRateSnapshot)) : undefined,
          targetActionType: dto.targetActionType,
          startDate: dto.startDate ? new Date(`${dto.startDate}T00:00:00Z`) : undefined,
          endDate: dto.endDate ? new Date(`${dto.endDate}T00:00:00Z`) : undefined,
          attentionCheckEnabled: dto.attentionCheckEnabled,
          ...(c.status === 'rejected' ? { status: 'draft', rejectionReason: null } : {}),
        },
        include: campaignSummaryInclude,
      });
    });
    await this.audit.record({ actorType: 'advertiser', actorId: advertiserId, action: 'campaign.updated', targetType: 'campaign', targetId: id, before: this.toSummary(c), after: this.toSummary(updated) });
    return this.toSummary(updated);
  }

  async remove(advertiserId: string, id: string) {
    const c = await this.owned(advertiserId, id, campaignSummaryInclude);
    if (c.status !== 'draft') throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, 'Only draft campaigns can be deleted');
    await this.prisma.$transaction([
      this.prisma.attentionQuestion.deleteMany({ where: { ad: { campaignId: id } } }),
      this.prisma.ad.deleteMany({ where: { campaignId: id } }),
      this.prisma.campaign.delete({ where: { id } }),
    ]);
    await this.audit.record({ actorType: 'advertiser', actorId: advertiserId, action: 'campaign.deleted', targetType: 'campaign', targetId: id, before: this.toSummary(c) });
  }

  /* --------------------------- lifecycle --------------------------- */

  /** draft -> pending_review. Reserves the full budget from the wallet (prepaid model). */
  async submit(advertiserId: string, id: string) {
    const advertiser = await this.prisma.advertiser.findUniqueOrThrow({ where: { id: advertiserId }, select: { verificationStatus: true } });
    if (advertiser.verificationStatus !== 'verified') {
      throw AppException.forbidden(ErrorCode.ADVERTISER_NOT_VERIFIED, 'Your business must be verified before submitting campaigns');
    }
    const c = await this.owned(advertiserId, id, campaignSummaryInclude);
    if (c.status !== 'draft') throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, 'Only draft campaigns can be submitted');
    if (c.targetActionType === 'video_view' && c._count.ads === 0) {
      throw AppException.badRequest(ErrorCode.CAMPAIGN_HAS_NO_ADS, 'Add at least one ad creative before submitting');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.wallet.applyEntry(
        { advertiserId, amountEtb: c.budgetEtb.negated(), entryType: 'campaign_budget_reservation', referenceType: 'campaign', referenceId: id, idempotencyKey: `campaign_budget_reservation:${id}`, description: `Budget reservation for "${c.title}"` },
        tx,
      );
      return tx.campaign.update({ where: { id }, data: { status: 'pending_review', submittedAt: new Date(), budgetReservedEtb: c.budgetEtb, rejectionReason: null }, include: campaignSummaryInclude });
    });
    await this.audit.record({ actorType: 'advertiser', actorId: advertiserId, action: 'campaign.submitted', targetType: 'campaign', targetId: id, before: { status: c.status }, after: { status: updated.status, reservedEtb: c.budgetEtb } });
    return this.toSummary(updated);
  }

  async pause(advertiserId: string, id: string) {
    const c = await this.owned(advertiserId, id, campaignSummaryInclude);
    if (c.status !== 'active') throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, 'Only active campaigns can be paused');
    const updated = await this.prisma.campaign.update({ where: { id }, data: { status: 'paused', pausedReason: 'advertiser_paused' }, include: campaignSummaryInclude });
    await this.audit.record({ actorType: 'advertiser', actorId: advertiserId, action: 'campaign.paused', targetType: 'campaign', targetId: id, before: { status: c.status }, after: { status: 'paused' } });
    return this.toSummary(updated);
  }

  async resume(advertiserId: string, id: string) {
    const c = await this.owned(advertiserId, id, campaignSummaryInclude);
    if (c.status !== 'paused') throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, 'Only paused campaigns can be resumed');
    if (c.pausedReason === 'admin_paused') throw AppException.forbidden(ErrorCode.CAMPAIGN_INVALID_STATE, 'This campaign was paused by the platform; contact support');
    if (c.budgetEtb.minus(c.spentEtb).lessThan(c.costPerActionEtb)) {
      throw AppException.conflict(ErrorCode.CAMPAIGN_BUDGET_EXHAUSTED, 'Increase the budget before resuming');
    }
    const updated = await this.prisma.campaign.update({ where: { id }, data: { status: 'active', pausedReason: null }, include: campaignSummaryInclude });
    await this.audit.record({ actorType: 'advertiser', actorId: advertiserId, action: 'campaign.resumed', targetType: 'campaign', targetId: id, before: { status: 'paused' }, after: { status: 'active' } });
    return this.toSummary(updated);
  }

  /* ------------------------------ ads ------------------------------ */

  async presignUpload(advertiserId: string, dto: { fileName: string; contentType: string; sizeBytes: number }) {
    const isVideo = (UPLOAD_LIMITS.video.mimeTypes as readonly string[]).includes(dto.contentType);
    const isImage = (UPLOAD_LIMITS.image.mimeTypes as readonly string[]).includes(dto.contentType);
    if (!isVideo && !isImage) {
      throw AppException.badRequest(ErrorCode.UPLOAD_TYPE_NOT_ALLOWED, 'Unsupported media type', { allowed: [...UPLOAD_LIMITS.video.mimeTypes, ...UPLOAD_LIMITS.image.mimeTypes] });
    }
    const max = isVideo ? UPLOAD_LIMITS.video.maxBytes : UPLOAD_LIMITS.image.maxBytes;
    if (dto.sizeBytes > max) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, `File too large (max ${max} bytes)`);
    const key = this.storage.buildKey(`creatives/${advertiserId}`, dto.fileName);
    return this.storage.presignUpload(key, dto.contentType, dto.sizeBytes);
  }

  async addAd(advertiserId: string, campaignId: string, dto: CreateAdDto) {
    const c = await this.owned(advertiserId, campaignId, campaignSummaryInclude);
    if (!['draft', 'rejected', 'active', 'paused', 'pending_review'].includes(c.status)) {
      throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Cannot add ads to a ${c.status} campaign`);
    }
    if (!dto.storageKey && !dto.mediaUrl) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'storageKey or mediaUrl is required');
    if (dto.attentionQuestions?.some((q) => q.correctIndex >= q.options.length)) {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'correctIndex must reference an option');
    }
    const ad = await this.prisma.ad.create({
      data: {
        campaignId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        storageKey: dto.storageKey,
        mediaUrl: dto.mediaUrl ?? this.storage.publicUrl(dto.storageKey!),
        thumbnailUrl: dto.thumbnailUrl,
        mediaType: dto.mediaType,
        durationSeconds: dto.durationSeconds,
        attentionQuestions: dto.attentionQuestions?.length
          ? { create: dto.attentionQuestions.map((q) => ({ prompt: q.prompt, promptAm: q.promptAm, options: q.options, correctIndex: q.correctIndex })) }
          : undefined,
      },
      include: { _count: { select: { attentionQuestions: true } } },
    });
    await this.audit.record({ actorType: 'advertiser', actorId: advertiserId, action: 'ad.created', targetType: 'ad', targetId: ad.id, after: this.toAdSummary(ad) });
    return this.toAdSummary(ad);
  }

  async listAds(advertiserId: string, campaignId: string) {
    await this.owned(advertiserId, campaignId, {});
    const ads = await this.prisma.ad.findMany({ where: { campaignId }, include: { _count: { select: { attentionQuestions: true } } }, orderBy: { createdAt: 'desc' } });
    return ads.map((a) => this.toAdSummary(a));
  }

  async removeAd(advertiserId: string, campaignId: string, adId: string) {
    await this.owned(advertiserId, campaignId, {});
    const ad = await this.prisma.ad.findFirst({ where: { id: adId, campaignId } });
    if (!ad) throw AppException.notFound('Ad not found');
    if (ad.reviewStatus === 'approved') throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, 'Approved ads cannot be deleted; pause the campaign instead');
    await this.prisma.$transaction([
      this.prisma.attentionQuestion.deleteMany({ where: { adId } }),
      this.prisma.ad.delete({ where: { id: adId } }),
    ]);
    await this.audit.record({ actorType: 'advertiser', actorId: advertiserId, action: 'ad.deleted', targetType: 'ad', targetId: adId, before: this.toAdSummary({ ...ad, _count: { attentionQuestions: 0 } }) });
  }

  /* --------------------------- analytics --------------------------- */

  async analytics(advertiserId: string, campaignId: string, range: { from?: string; to?: string }) {
    const c = await this.owned(advertiserId, campaignId, {});
    return this.analyticsFor(c, range);
  }

  async analyticsFor(c: Campaign, range: { from?: string; to?: string }) {
    const { from, to } = parseDateRange(range.from, range.to);
    const [views, byStatus, spend, uniqueUsers, dailyViews, dailyCompletions] = await Promise.all([
      this.prisma.adWatchSession.count({ where: { ad: { campaignId: c.id }, startedAt: { gte: from, lte: to } } }),
      this.prisma.adCompletion.groupBy({ by: ['status'], where: { campaignId: c.id, completedAt: { gte: from, lte: to } }, _count: { _all: true }, _sum: { costEtb: true } }),
      this.prisma.adCompletion.aggregate({ where: { campaignId: c.id, status: 'valid', completedAt: { gte: from, lte: to } }, _sum: { costEtb: true } }),
      this.prisma.adCompletion.findMany({ where: { campaignId: c.id, status: 'valid', completedAt: { gte: from, lte: to } }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', s.started_at AT TIME ZONE 'UTC') AS day, COUNT(*)::bigint AS count
        FROM ad_watch_sessions s JOIN ads a ON a.id = s.ad_id
        WHERE a.campaign_id = ${c.id}::uuid AND s.started_at BETWEEN ${from} AND ${to} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ day: Date; status: string; count: bigint; cost: Prisma.Decimal | null }>>`
        SELECT date_trunc('day', completed_at AT TIME ZONE 'UTC') AS day, status::text AS status, COUNT(*)::bigint AS count, SUM(cost_etb) AS cost
        FROM ad_completions WHERE campaign_id = ${c.id}::uuid AND completed_at BETWEEN ${from} AND ${to} GROUP BY 1, 2`,
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const raw = byStatus.reduce((n, b) => n + b._count._all, 0);
    const valid = count('valid');
    const flagged = count('flagged');
    const rejected = count('rejected');

    const daily = new Map<string, { rawViews: number; rawCompletions: number; validCompletions: number; flaggedCompletions: number; rejectedCompletions: number; spendEtb: number }>();
    for (const d of eachUtcDay(from, to)) daily.set(d, { rawViews: 0, rawCompletions: 0, validCompletions: 0, flaggedCompletions: 0, rejectedCompletions: 0, spendEtb: 0 });
    for (const r of dailyViews) {
      const b = daily.get(utcDayKey(new Date(r.day)));
      if (b) b.rawViews += Number(r.count);
    }
    for (const r of dailyCompletions) {
      const b = daily.get(utcDayKey(new Date(r.day)));
      if (!b) continue;
      const n = Number(r.count);
      b.rawCompletions += n;
      if (r.status === 'valid') {
        b.validCompletions += n;
        b.spendEtb = Math.round((b.spendEtb + Number(r.cost ?? 0)) * 100) / 100;
      }
      if (r.status === 'flagged') b.flaggedCompletions += n;
      if (r.status === 'rejected') b.rejectedCompletions += n;
    }

    return {
      campaignId: c.id,
      from,
      to,
      totals: {
        rawViews: views,
        rawCompletions: raw,
        validCompletions: valid,
        flaggedCompletions: flagged,
        rejectedCompletions: rejected,
        fraudFilteredRate: raw ? Math.round(((flagged + rejected) / raw) * 10000) / 10000 : 0,
        spendEtb: spend._sum.costEtb ?? new Prisma.Decimal(0),
        budgetEtb: c.budgetEtb,
        remainingEtb: c.budgetEtb.minus(c.spentEtb),
        uniqueUsers: uniqueUsers.length,
      },
      daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })),
    };
  }

  async overview(advertiserId: string) {
    const { from, to } = parseDateRange(undefined, undefined, 30);
    const [active, total, spend, wallet, views, byStatus, reach, daily] = await Promise.all([
      this.prisma.campaign.count({ where: { advertiserId, status: 'active' } }),
      this.prisma.campaign.count({ where: { advertiserId } }),
      this.prisma.campaign.aggregate({ where: { advertiserId }, _sum: { spentEtb: true } }),
      this.prisma.advertiser.findUniqueOrThrow({ where: { id: advertiserId }, select: { walletBalanceEtb: true } }),
      this.prisma.adWatchSession.count({ where: { ad: { campaign: { advertiserId } } } }),
      this.prisma.adCompletion.groupBy({ by: ['status'], where: { campaign: { advertiserId } }, _count: { _all: true } }),
      this.prisma.adCompletion.findMany({ where: { campaign: { advertiserId }, status: 'valid' }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.$queryRaw<Array<{ day: Date; valid: bigint; views: bigint; spend: Prisma.Decimal | null }>>`
        SELECT d.day,
          COALESCE((SELECT COUNT(*) FROM ad_completions ac JOIN campaigns c ON c.id = ac.campaign_id WHERE c.advertiser_id = ${advertiserId}::uuid AND ac.status = 'valid' AND date_trunc('day', ac.completed_at AT TIME ZONE 'UTC') = d.day), 0)::bigint AS valid,
          COALESCE((SELECT COUNT(*) FROM ad_watch_sessions s JOIN ads a ON a.id = s.ad_id JOIN campaigns c ON c.id = a.campaign_id WHERE c.advertiser_id = ${advertiserId}::uuid AND date_trunc('day', s.started_at AT TIME ZONE 'UTC') = d.day), 0)::bigint AS views,
          (SELECT SUM(ac.cost_etb) FROM ad_completions ac JOIN campaigns c ON c.id = ac.campaign_id WHERE c.advertiser_id = ${advertiserId}::uuid AND ac.status = 'valid' AND date_trunc('day', ac.completed_at AT TIME ZONE 'UTC') = d.day) AS spend
        FROM generate_series(date_trunc('day', ${from}::timestamptz), date_trunc('day', ${to}::timestamptz), interval '1 day') AS d(day)`,
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    return {
      activeCampaigns: active,
      totalCampaigns: total,
      totalSpendEtb: spend._sum.spentEtb ?? new Prisma.Decimal(0),
      walletBalanceEtb: wallet.walletBalanceEtb,
      totalRawViews: views,
      totalValidCompletions: count('valid'),
      totalFlaggedCompletions: count('flagged') + count('rejected'),
      estimatedReach: reach.length,
      daily: daily.map((d) => ({ date: utcDayKey(new Date(d.day)), spendEtb: Number(d.spend ?? 0), validCompletions: Number(d.valid), rawViews: Number(d.views) })),
    };
  }

  /* ------------------------------ helpers ------------------------------ */

  private async owned<I extends Prisma.CampaignInclude>(advertiserId: string, id: string, include: I) {
    const c = await this.prisma.campaign.findFirst({ where: { id, advertiserId }, include });
    if (!c) throw AppException.notFound('Campaign not found');
    return c as Prisma.CampaignGetPayload<{ include: I }>;
  }

  private assertEconomics(budgetEtb: number, costPerActionEtb: number) {
    const p = this.config.platform;
    if (budgetEtb < p.minCampaignBudgetEtb) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, `Budget must be at least ${p.minCampaignBudgetEtb} ETB`);
    if (costPerActionEtb < p.minCostPerActionEtb) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, `Cost per action must be at least ${p.minCostPerActionEtb} ETB`);
    if (costPerActionEtb > budgetEtb) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Cost per action cannot exceed the budget');
  }

  private assertDates(start?: string, end?: string) {
    if (start && end && new Date(start) > new Date(end)) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'endDate must be after startDate');
  }

  private async completionCounts(campaignIds: string[]) {
    const map = new Map<string, { raw: number; valid: number }>();
    if (!campaignIds.length) return map;
    const rows = await this.prisma.adCompletion.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: campaignIds } }, _count: { _all: true } });
    for (const r of rows) {
      const entry = map.get(r.campaignId) ?? { raw: 0, valid: 0 };
      entry.raw += r._count._all;
      if (r.status === 'valid') entry.valid += r._count._all;
      map.set(r.campaignId, entry);
    }
    return map;
  }

  toSummary(c: CampaignWithCounts & { advertiser?: { id: string; businessName: string } }) {
    return {
      id: c.id,
      advertiserId: c.advertiserId,
      title: c.title,
      description: c.description,
      status: c.status,
      targetActionType: c.targetActionType,
      budgetEtb: c.budgetEtb,
      spentEtb: c.spentEtb,
      remainingEtb: c.budgetEtb.minus(c.spentEtb),
      costPerActionEtb: c.costPerActionEtb,
      rewardPerActionEtb: c.rewardPerActionEtb,
      rewardCoins: rewardCoins(c.rewardPerActionEtb, this.config.platform.coinsPerEtb),
      attentionCheckEnabled: c.attentionCheckEnabled,
      startDate: c.startDate ? utcDayKey(c.startDate) : null,
      endDate: c.endDate ? utcDayKey(c.endDate) : null,
      pausedReason: c.pausedReason,
      rejectionReason: c.rejectionReason,
      adsCount: c._count?.ads ?? c.ads?.length ?? 0,
      approvedAdsCount: c.ads?.filter((a) => a.reviewStatus === 'approved').length ?? 0,
      rawCompletions: c.completionCounts?.raw ?? 0,
      validCompletions: c.completionCounts?.valid ?? 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      ...(c.advertiser ? { advertiser: c.advertiser } : {}),
    };
  }

  toAdSummary(a: Prisma.AdGetPayload<{ include: { _count: { select: { attentionQuestions: true } } } }>) {
    return {
      id: a.id,
      campaignId: a.campaignId,
      title: a.title,
      description: a.description,
      mediaUrl: a.mediaUrl,
      thumbnailUrl: a.thumbnailUrl,
      mediaType: a.mediaType,
      durationSeconds: a.durationSeconds,
      reviewStatus: a.reviewStatus,
      rejectionReason: a.rejectionReason,
      reviewedAt: a.reviewedAt,
      attentionQuestionsCount: a._count.attentionQuestions,
      createdAt: a.createdAt,
    };
  }
}
