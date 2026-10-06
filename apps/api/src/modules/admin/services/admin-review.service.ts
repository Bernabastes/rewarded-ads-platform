import { Injectable } from '@nestjs/common';
import { type AdReportStatus, type CampaignStatus, type MediaStatus, Prisma, type ReviewStatus } from '@prisma/client';
import { BANNED_TOPICS, ErrorCode } from '@rap/shared';
import { AppException } from '../../../common/errors/app.exception';
import { pageArgs, paginated } from '../../../common/pagination';
import { SecurityLogger } from '../../../infra/logger/logger.module';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CampaignLifecycleService } from '../../campaigns/campaign-lifecycle.service';
import { CampaignsService } from '../../campaigns/campaigns.service';
import { MediaService } from '../../media/media.service';
import type { BannedTopicsChecklistDto } from '../dto/admin.dto';

export interface AdminActor {
  adminId: string;
  ip?: string;
}

const reviewInclude = {
  campaign: {
    select: {
      id: true,
      title: true,
      status: true,
      targetActionType: true,
      costPerActionEtb: true,
      budgetEtb: true,
      advertiser: { select: { id: true, businessName: true, verificationStatus: true } },
    },
  },
  attentionQuestions: { select: { id: true, prompt: true, options: true, correctIndex: true } },
  _count: { select: { attentionQuestions: true, reports: { where: { status: 'open' } } } },
} satisfies Prisma.AdInclude;

/** Ad review queue, campaign moderation and ad reports. Every decision writes audit_log with before/after state. */
@Injectable()
export class AdminReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    private readonly campaigns: CampaignsService,
    private readonly lifecycle: CampaignLifecycleService,
    private readonly media: MediaService,
  ) {}

  /* ------------------------------ ads ------------------------------ */

  async reviewQueue(query: { page?: number; limit?: number; status?: ReviewStatus; mediaStatus?: MediaStatus }) {
    const p = pageArgs(query);
    const where: Prisma.AdWhereInput = { reviewStatus: query.status ?? 'pending', mediaStatus: query.mediaStatus };
    const [rows, total] = await Promise.all([
      this.prisma.ad.findMany({
        where,
        include: reviewInclude,
        orderBy: { createdAt: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.ad.count({ where }),
    ]);
    return paginated(
      rows.map((a) => this.toReviewItem(a)),
      total,
      p,
    );
  }

  async getAd(id: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id }, include: reviewInclude });
    if (!ad) throw AppException.notFound('Ad not found');
    return this.toReviewItem(ad);
  }

  /** Re-run the media pipeline for a creative whose processing failed (or to re-probe after a re-upload). */
  async reprocessMedia(id: string, actor: AdminActor) {
    const ad = await this.prisma.ad.findUnique({ where: { id }, select: { id: true } });
    if (!ad) throw AppException.notFound('Ad not found');
    await this.media.reprocess(id, actor);
    return this.getAd(id);
  }

  async approveAd(
    id: string,
    checklist: BannedTopicsChecklistDto,
    note: string | undefined,
    actor: AdminActor,
  ) {
    const ad = await this.prisma.ad.findUnique({ where: { id }, include: reviewInclude });
    if (!ad) throw AppException.notFound('Ad not found');
    if (ad.reviewStatus !== 'pending')
      throw AppException.conflict(ErrorCode.AD_NOT_PENDING, `Ad is already ${ad.reviewStatus}`);
    if (ad.mediaStatus === 'processing' || ad.mediaStatus === 'failed') {
      throw AppException.unprocessable(
        ErrorCode.MEDIA_NOT_READY,
        ad.mediaStatus === 'processing'
          ? 'The creative is still being processed (probe/transcode); try again shortly'
          : `The creative failed processing: ${ad.mediaError ?? 'unknown error'}. Ask the advertiser to re-upload or reprocess.`,
        { mediaStatus: ad.mediaStatus, mediaError: ad.mediaError },
      );
    }
    const missing = BANNED_TOPICS.filter((t) => checklist.checks[t.key] !== true).map((t) => t.key);
    if (missing.length) {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_ERROR,
        'Every banned topic must be explicitly confirmed absent before approval',
        { missing },
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.ad.update({
        where: { id },
        data: {
          reviewStatus: 'approved',
          reviewedBy: actor.adminId,
          reviewedAt: new Date(),
          rejectionReason: null,
          reviewNote: note,
          bannedTopicsChecklist: checklist as unknown as Prisma.InputJsonValue,
        },
        include: reviewInclude,
      });
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'ad.approved',
          targetType: 'ad',
          targetId: id,
          before: { reviewStatus: ad.reviewStatus },
          after: { reviewStatus: 'approved', checklist, note },
          ipAddress: actor.ip,
        },
        tx,
      );
      return u;
    });
    return this.toReviewItem(updated);
  }

  async rejectAd(
    id: string,
    reason: string,
    checklist: BannedTopicsChecklistDto | undefined,
    actor: AdminActor,
  ) {
    if (!reason?.trim())
      throw AppException.badRequest(ErrorCode.REJECTION_REASON_REQUIRED, 'A rejection reason is required');
    const ad = await this.prisma.ad.findUnique({ where: { id }, include: reviewInclude });
    if (!ad) throw AppException.notFound('Ad not found');
    if (ad.reviewStatus === 'rejected')
      throw AppException.conflict(ErrorCode.AD_NOT_PENDING, 'Ad is already rejected');
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.ad.update({
        where: { id },
        data: {
          reviewStatus: 'rejected',
          reviewedBy: actor.adminId,
          reviewedAt: new Date(),
          rejectionReason: reason.trim(),
          bannedTopicsChecklist: (checklist ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        include: reviewInclude,
      });
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'ad.rejected',
          targetType: 'ad',
          targetId: id,
          before: { reviewStatus: ad.reviewStatus },
          after: { reviewStatus: 'rejected', reason, checklist },
          ipAddress: actor.ip,
        },
        tx,
      );
      return u;
    });
    return this.toReviewItem(updated);
  }

  /* --------------------------- campaigns --------------------------- */

  async listCampaigns(query: {
    page?: number;
    limit?: number;
    status?: CampaignStatus;
    advertiserId?: string;
  }) {
    const p = pageArgs(query);
    const where: Prisma.CampaignWhereInput = { status: query.status, advertiserId: query.advertiserId };
    const [rows, total] = await Promise.all([
      this.prisma.campaign.findMany({
        where,
        include: {
          _count: { select: { ads: true } },
          ads: { select: { reviewStatus: true } },
          advertiser: { select: { id: true, businessName: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return paginated(
      rows.map((c) => this.campaigns.toSummary(c)),
      total,
      p,
    );
  }

  async getCampaign(id: string) {
    const c = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        _count: { select: { ads: true } },
        ads: { include: { _count: { select: { attentionQuestions: true } } } },
        advertiser: { select: { id: true, businessName: true } },
      },
    });
    if (!c) throw AppException.notFound('Campaign not found');
    const analytics = await this.campaigns.analyticsFor(c, {});
    return {
      ...this.campaigns.toSummary({ ...c, ads: c.ads.map((a) => ({ reviewStatus: a.reviewStatus })) }),
      ads: c.ads.map((a) => this.campaigns.toAdSummary(a)),
      analytics,
    };
  }

  /**
   * pending_review -> active. Phase 5b New-1 (defence in depth): approval is refused unless the wallet reservation
   * covers the whole budget (`budget_reserved_etb >= budget_etb`), so a campaign that somehow reached the queue
   * under-funded can never start paying users; the status flip is an atomic claim under the campaign row lock.
   */
  async approveCampaign(id: string, actor: AdminActor, note?: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw AppException.notFound('Campaign not found');
    if (c.status !== 'pending_review')
      throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Campaign is ${c.status}`);
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lifecycle.lockCampaign(tx, id);
      if (!locked || locked.status !== 'pending_review')
        throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Campaign is ${locked?.status ?? 'missing'}`);
      if (locked.budgetReservedEtb.lessThan(locked.budgetEtb)) {
        this.security.error('ledger.write', {
          campaignId: id,
          problem: 'campaign_underfunded',
          budgetEtb: locked.budgetEtb.toNumber(),
          budgetReservedEtb: locked.budgetReservedEtb.toNumber(),
          adminId: actor.adminId,
        });
        throw AppException.unprocessable(
          ErrorCode.CAMPAIGN_UNDERFUNDED,
          'The wallet reservation does not cover this campaign budget; it must be rejected and resubmitted',
          { budgetEtb: locked.budgetEtb.toNumber(), budgetReservedEtb: locked.budgetReservedEtb.toNumber() },
        );
      }
      const claimed = await tx.campaign.updateMany({
        where: { id, status: 'pending_review', budgetEtb: locked.budgetEtb },
        data: { status: 'active', reviewedAt: new Date(), reviewedBy: actor.adminId, rejectionReason: null },
      });
      if (claimed.count === 0) throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, 'Campaign changed concurrently');
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'campaign.approved',
          targetType: 'campaign',
          targetId: id,
          before: { status: locked.status, budgetEtb: locked.budgetEtb, budgetReservedEtb: locked.budgetReservedEtb },
          after: { status: 'active', note },
          ipAddress: actor.ip,
        },
        tx,
      );
    });
    return this.getCampaign(id);
  }

  async rejectCampaign(id: string, reason: string, actor: AdminActor) {
    if (!reason?.trim())
      throw AppException.badRequest(ErrorCode.REJECTION_REASON_REQUIRED, 'A rejection reason is required');
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw AppException.notFound('Campaign not found');
    if (!['pending_review', 'active', 'paused'].includes(c.status))
      throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Campaign is ${c.status}`);
    await this.prisma.$transaction(async (tx) => {
      // Lock + re-read so the refund is computed from the current spent_etb (#1 / #15) and the status claim is atomic.
      const locked = await this.lifecycle.lockCampaign(tx, id);
      if (!locked || !['pending_review', 'active', 'paused'].includes(locked.status))
        throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Campaign is ${locked?.status ?? 'missing'}`);
      await tx.campaign.update({
        where: { id },
        data: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: actor.adminId,
          rejectionReason: reason.trim(),
        },
      });
      await this.lifecycle.refundUnspent(tx, locked, 'rejected');
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'campaign.rejected',
          targetType: 'campaign',
          targetId: id,
          before: { status: locked.status, reserved: locked.budgetReservedEtb, submissionSeq: locked.submissionSeq },
          after: { status: 'rejected', reason },
          ipAddress: actor.ip,
        },
        tx,
      );
    });
    return this.getCampaign(id);
  }

  async pauseCampaign(id: string, reason: string, actor: AdminActor) {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw AppException.notFound('Campaign not found');
    if (c.status !== 'active')
      throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Campaign is ${c.status}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.update({ where: { id }, data: { status: 'paused', pausedReason: 'admin_paused' } });
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'campaign.paused_by_admin',
          targetType: 'campaign',
          targetId: id,
          before: { status: 'active' },
          after: { status: 'paused', reason },
          ipAddress: actor.ip,
        },
        tx,
      );
    });
    this.security.info('admin.moderation', {
      action: 'campaign.paused',
      campaignId: id,
      adminId: actor.adminId,
      reason,
    });
    return this.getCampaign(id);
  }

  /** Admin un-pause. Phase 5c (New-1 residual): same funding assertion + pinned claim as the advertiser's resume(). */
  async resumeCampaign(id: string, actor: AdminActor) {
    const c = await this.prisma.campaign.findUnique({ where: { id } });
    if (!c) throw AppException.notFound('Campaign not found');
    if (c.status !== 'paused')
      throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Campaign is ${c.status}`);
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lifecycle.lockCampaign(tx, id);
      if (!locked || locked.status !== 'paused')
        throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, `Campaign is ${locked?.status ?? 'missing'}`);
      if (locked.budgetReservedEtb.lessThan(locked.budgetEtb)) {
        this.security.error('ledger.write', {
          campaignId: id,
          problem: 'campaign_underfunded',
          budgetEtb: locked.budgetEtb.toNumber(),
          budgetReservedEtb: locked.budgetReservedEtb.toNumber(),
          adminId: actor.adminId,
        });
        throw AppException.unprocessable(
          ErrorCode.CAMPAIGN_UNDERFUNDED,
          'The wallet reservation does not cover this campaign budget; it cannot be re-activated',
          { budgetEtb: locked.budgetEtb.toNumber(), budgetReservedEtb: locked.budgetReservedEtb.toNumber() },
        );
      }
      const claimed = await tx.campaign.updateMany({
        where: { id, status: 'paused', budgetEtb: locked.budgetEtb, budgetReservedEtb: locked.budgetReservedEtb },
        data: { status: 'active', pausedReason: null },
      });
      if (claimed.count === 0) throw AppException.conflict(ErrorCode.CAMPAIGN_INVALID_STATE, 'Campaign changed concurrently');
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: 'campaign.resumed_by_admin',
          targetType: 'campaign',
          targetId: id,
          before: { status: 'paused', budgetEtb: locked.budgetEtb, budgetReservedEtb: locked.budgetReservedEtb },
          after: { status: 'active' },
          ipAddress: actor.ip,
        },
        tx,
      );
    });
    return this.getCampaign(id);
  }

  /* --------------------------- ad reports --------------------------- */

  async listAdReports(query: { page?: number; limit?: number; status?: AdReportStatus }) {
    const p = pageArgs(query);
    const where: Prisma.AdReportWhereInput = { status: query.status ?? 'open' };
    const [rows, total] = await Promise.all([
      this.prisma.adReport.findMany({
        where,
        include: { ad: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.adReport.count({ where }),
    ]);
    return paginated(
      rows.map((r) => ({
        id: r.id,
        adId: r.adId,
        adTitle: r.ad.title,
        userId: r.userId,
        reason: r.reason,
        details: r.details,
        status: r.status,
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt,
        createdAt: r.createdAt,
      })),
      total,
      p,
    );
  }

  async reviewAdReport(
    id: string,
    dto: { outcome: 'reviewed' | 'dismissed'; note?: string; rejectAd?: boolean; rejectionReason?: string },
    actor: AdminActor,
  ) {
    const report = await this.prisma.adReport.findUnique({ where: { id } });
    if (!report) throw AppException.notFound('Report not found');
    if (report.status !== 'open') throw AppException.conflict(ErrorCode.CONFLICT, 'Report already reviewed');
    if (dto.rejectAd && !dto.rejectionReason?.trim())
      throw AppException.badRequest(
        ErrorCode.REJECTION_REASON_REQUIRED,
        'rejectionReason is required when rejecting the ad',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.adReport.update({
        where: { id },
        data: {
          status: dto.outcome,
          reviewedBy: actor.adminId,
          reviewedAt: new Date(),
          reviewNote: dto.note,
        },
      });
      if (dto.rejectAd) {
        await tx.ad.update({
          where: { id: report.adId },
          data: {
            reviewStatus: 'rejected',
            rejectionReason: dto.rejectionReason!.trim(),
            reviewedBy: actor.adminId,
            reviewedAt: new Date(),
          },
        });
      }
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: `ad_report.${dto.outcome}`,
          targetType: 'ad_report',
          targetId: id,
          before: { status: 'open' },
          after: { status: dto.outcome, rejectAd: Boolean(dto.rejectAd), note: dto.note },
          ipAddress: actor.ip,
        },
        tx,
      );
    });
    return this.prisma.adReport.findUniqueOrThrow({ where: { id } });
  }

  private toReviewItem(a: Prisma.AdGetPayload<{ include: typeof reviewInclude }>) {
    const { campaign, attentionQuestions, _count, ...rest } = a;
    return {
      ...this.campaigns.toAdSummary({ ...rest, _count: { attentionQuestions: _count.attentionQuestions } }),
      campaign: {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        targetActionType: campaign.targetActionType,
        costPerActionEtb: campaign.costPerActionEtb,
        budgetEtb: campaign.budgetEtb,
      },
      advertiser: campaign.advertiser,
      bannedTopicsChecklist: a.bannedTopicsChecklist,
      reviewedBy: a.reviewedBy,
      reviewNote: a.reviewNote,
      openReports: _count.reports,
      attentionQuestions,
      bannedTopics: BANNED_TOPICS,
    };
  }
}
