import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode, type SurveyQuestion } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationService } from '../notifications/notifications.module';

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationService,
  ) {}

  async list(userId: string, query: { page?: number; limit?: number; type?: 'survey' | 'app_install' }) {
    const p = pageArgs(query);
    const activeCampaign = { status: 'active' as const };
    const [surveys, installs] = await Promise.all([
      query.type === 'app_install'
        ? []
        : this.prisma.survey.findMany({
            where: { active: true, campaign: activeCampaign },
            include: { campaign: { include: { advertiser: { select: { businessName: true } } } }, responses: { where: { userId }, select: { status: true } } },
            orderBy: { rewardEtb: 'desc' },
          }),
      query.type === 'survey'
        ? []
        : this.prisma.appInstallOffer.findMany({
            where: { active: true, campaign: activeCampaign },
            include: { campaign: { include: { advertiser: { select: { businessName: true } } } }, completions: { where: { userId }, select: { status: true } } },
            orderBy: { rewardEtb: 'desc' },
          }),
    ]);
    const items = [
      ...surveys.map((s) => this.surveyItem(s)),
      ...installs.map((o) => this.installItem(o)),
    ].sort((a, b) => b.rewardEtb - a.rewardEtb);
    return paginated(items.slice(p.skip, p.skip + p.take), items.length, p);
  }

  async survey(userId: string, id: string) {
    const s = await this.prisma.survey.findUnique({
      where: { id },
      include: { campaign: { include: { advertiser: { select: { businessName: true } } } }, responses: { where: { userId }, select: { status: true } } },
    });
    if (!s || !s.active || s.campaign.status !== 'active') throw AppException.notFound('Offer not available', { code: ErrorCode.OFFER_NOT_AVAILABLE });
    return { ...this.surveyItem(s), questions: this.questions(s.details) };
  }

  async completeSurvey(userId: string, id: string, answers: Array<{ questionId: string; value: unknown }>, ip: string) {
    const s = await this.prisma.survey.findUnique({ where: { id }, include: { campaign: true } });
    if (!s || !s.active || s.campaign.status !== 'active') {
      throw AppException.badRequest(ErrorCode.OFFER_NOT_AVAILABLE, 'This survey is not available');
    }
    const existing = await this.prisma.surveyResponse.findUnique({ where: { surveyId_userId: { surveyId: id, userId } } });
    if (existing) throw AppException.conflict(ErrorCode.OFFER_ALREADY_COMPLETED, 'You already completed this survey');

    this.validateAnswers(this.questions(s.details), answers);
    const coins = this.coins(s.rewardEtb);

    const result = await this.prisma.$transaction(async (tx) => {
      const charge = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE campaigns SET spent_etb = spent_etb + ${s.campaign.costPerActionEtb}, updated_at = NOW()
        WHERE id = ${s.campaignId}::uuid AND status = 'active' AND spent_etb + ${s.campaign.costPerActionEtb} <= budget_etb RETURNING id`;
      if (charge.length === 0) throw AppException.badRequest(ErrorCode.CAMPAIGN_BUDGET_EXHAUSTED, 'This survey is no longer funded');
      const response = await tx.surveyResponse.create({
        data: { surveyId: id, userId, answers: answers as unknown as Prisma.InputJsonValue, coinReward: coins, status: 'valid', ipAddress: ip },
      });
      const write = await this.ledger.applyEntry(
        { userId, amount: coins, sourceType: 'survey', sourceId: response.id, idempotencyKey: `survey_response:${response.id}`, description: `Survey: ${s.title}` },
        tx,
      );
      return { response, balance: write.balanceAfter };
    });

    await this.notifications.notify({
      userId,
      type: 'reward_confirmed',
      title: 'Survey reward confirmed',
      body: `You earned ${coins} coins for completing "${s.title}".`,
      data: { surveyId: id, coins },
    });
    return {
      completionId: result.response.id,
      offerId: id,
      type: 'survey' as const,
      status: result.response.status,
      coinReward: coins,
      newBalance: result.balance,
      message: 'Thank you! Your reward has been credited.',
    };
  }

  async appInstall(userId: string, id: string) {
    const o = await this.prisma.appInstallOffer.findUnique({
      where: { id },
      include: { campaign: { include: { advertiser: { select: { businessName: true } } } }, completions: { where: { userId }, select: { status: true } } },
    });
    if (!o || !o.active || o.campaign.status !== 'active') throw AppException.notFound('Offer not available', { code: ErrorCode.OFFER_NOT_AVAILABLE });
    const details = (o.details as { description?: string; instructions?: string }) ?? {};
    return { ...this.installItem(o), appName: o.appName, packageName: o.packageName, storeUrl: o.storeUrl, instructions: details.instructions ?? null };
  }

  /** App installs cannot be verified server-side in this build: recorded as pending_verification for admin review. */
  async completeAppInstall(userId: string, id: string, input: { deviceFingerprint: string; proof?: string }) {
    const o = await this.prisma.appInstallOffer.findUnique({ where: { id }, include: { campaign: true } });
    if (!o || !o.active || o.campaign.status !== 'active') {
      throw AppException.badRequest(ErrorCode.OFFER_NOT_AVAILABLE, 'This offer is not available');
    }
    const existing = await this.prisma.appInstallCompletion.findUnique({ where: { offerId_userId: { offerId: id, userId } } });
    if (existing) throw AppException.conflict(ErrorCode.OFFER_ALREADY_COMPLETED, 'You already submitted this offer');
    const coins = this.coins(o.rewardEtb);
    const completion = await this.prisma.appInstallCompletion.create({
      data: { offerId: id, userId, deviceFingerprint: input.deviceFingerprint, proof: input.proof, coinReward: coins, status: 'pending_verification' },
    });
    return {
      completionId: completion.id,
      offerId: id,
      type: 'app_install' as const,
      status: completion.status,
      coinReward: coins,
      newBalance: null,
      message: 'Thanks! We are verifying the install; coins are credited once confirmed.',
    };
  }

  async myCompletions(userId: string, query: { page?: number; limit?: number }) {
    const p = pageArgs(query);
    const [responses, installs] = await Promise.all([
      this.prisma.surveyResponse.findMany({ where: { userId }, include: { survey: { select: { title: true } } }, orderBy: { completedAt: 'desc' } }),
      this.prisma.appInstallCompletion.findMany({ where: { userId }, include: { offer: { select: { appName: true } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const items = [
      ...responses.map((r) => ({ id: r.id, offerId: r.surveyId, type: 'survey' as const, title: r.survey.title, status: r.status, coinReward: r.coinReward, createdAt: r.completedAt })),
      ...installs.map((c) => ({ id: c.id, offerId: c.offerId, type: 'app_install' as const, title: c.offer.appName, status: c.status, coinReward: c.coinReward, createdAt: c.createdAt })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginated(items.slice(p.skip, p.skip + p.take), items.length, p);
  }

  /* ------------------------------ helpers ------------------------------ */

  coins(rewardEtb: Prisma.Decimal): number {
    return new Prisma.Decimal(rewardEtb).mul(this.config.platform.coinsPerEtb).round().toNumber();
  }

  questions(details: Prisma.JsonValue): SurveyQuestion[] {
    const q = (details as { questions?: SurveyQuestion[] })?.questions;
    return Array.isArray(q) ? q : [];
  }

  validateAnswers(questions: SurveyQuestion[], answers: Array<{ questionId: string; value: unknown }>) {
    const byId = new Map(answers.map((a) => [a.questionId, a.value]));
    const problems: string[] = [];
    for (const q of questions) {
      const v = byId.get(q.id);
      if (v === undefined || v === null || v === '') {
        if (q.required) problems.push(`${q.id}: answer required`);
        continue;
      }
      switch (q.type) {
        case 'single_choice': {
          const idx = Number(v);
          if (!Number.isInteger(idx) || idx < 0 || idx >= (q.options?.length ?? 0)) problems.push(`${q.id}: invalid option`);
          break;
        }
        case 'multi_choice':
          if (!Array.isArray(v) || v.some((x) => !Number.isInteger(Number(x)) || Number(x) < 0 || Number(x) >= (q.options?.length ?? 0))) {
            problems.push(`${q.id}: invalid options`);
          }
          break;
        case 'rating': {
          const n = Number(v);
          if (!Number.isFinite(n) || n < (q.min ?? 1) || n > (q.max ?? 5)) problems.push(`${q.id}: rating out of range`);
          break;
        }
        case 'text':
          if (typeof v !== 'string' || v.length > 2000) problems.push(`${q.id}: invalid text`);
          break;
      }
    }
    if (problems.length) throw AppException.badRequest(ErrorCode.SURVEY_ANSWERS_INVALID, 'Survey answers are invalid', problems);
  }

  private surveyItem(s: Prisma.SurveyGetPayload<{ include: { campaign: { include: { advertiser: { select: { businessName: true } } } }; responses: { select: { status: true } } } }>) {
    return {
      id: s.id,
      type: 'survey' as const,
      campaignId: s.campaignId,
      title: s.title,
      description: s.description,
      advertiserName: s.campaign.advertiser.businessName,
      rewardCoins: this.coins(s.rewardEtb),
      rewardEtb: Number(s.rewardEtb),
      estimatedMinutes: s.estimatedMinutes,
      iconUrl: null,
      completionStatus: s.responses[0]?.status ?? null,
    };
  }

  private installItem(o: Prisma.AppInstallOfferGetPayload<{ include: { campaign: { include: { advertiser: { select: { businessName: true } } } }; completions: { select: { status: true } } } }>) {
    const details = (o.details as { description?: string }) ?? {};
    return {
      id: o.id,
      type: 'app_install' as const,
      campaignId: o.campaignId,
      title: `Install ${o.appName}`,
      description: details.description ?? null,
      advertiserName: o.campaign.advertiser.businessName,
      rewardCoins: this.coins(o.rewardEtb),
      rewardEtb: Number(o.rewardEtb),
      estimatedMinutes: 3,
      iconUrl: o.iconUrl,
      completionStatus: o.completions[0]?.status ?? null,
    };
  }
}
