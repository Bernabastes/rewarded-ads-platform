import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { type PayoutMethod, Prisma, type Withdrawal, type WithdrawalStatus } from '@prisma/client';
import { ErrorCode, IN_FLIGHT_WITHDRAWAL_STATUSES, normalizeEthiopianPhone, PAYOUT_METHOD_INFO } from '@rap/shared';
import { Queue } from 'bullmq';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { maskDestination, secondsUntilEndOfUtcDay, utcDayKey } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_PAYOUTS } from '../../infra/queue/queue.module';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { KycService } from '../kyc/kyc.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationService } from '../notifications/notifications.module';
import { DestinationsService } from './destinations/destinations.service';
import type { CreateWithdrawalDto } from './dto/withdrawals.dto';
import { PayoutProviderRegistry } from './providers/payout-provider.registry';

export const REVIEW_REASON = {
  firstWithdrawal: 'first_withdrawal',
  largeAmount: 'large_amount',
  lowTrustScore: 'low_trust_score',
} as const;

const REVIEWABLE: WithdrawalStatus[] = ['flagged_for_review'];
const REJECTABLE: WithdrawalStatus[] = ['flagged_for_review', 'pending'];

const adminInclude = {
  user: { select: { id: true, phoneNumber: true, fullName: true, trustScore: true, status: true } },
  approvals: { include: { admin: { select: { email: true } } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.WithdrawalInclude;

type WithdrawalForAdmin = Prisma.WithdrawalGetPayload<{ include: typeof adminInclude }>;

/** Partial unique index from migration 20261001080100 (one in-flight withdrawal per user) - the DB backstop for #12. */
export const ONE_IN_FLIGHT_INDEX = 'withdrawals_one_in_flight_per_user';

export function isOneInFlightViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const meta = err.meta as { target?: unknown; constraint?: unknown } | undefined;
  const target = JSON.stringify(meta?.target ?? meta?.constraint ?? '');
  return target.includes(ONE_IN_FLIGHT_INDEX) || err.message.includes(ONE_IN_FLIGHT_INDEX);
}

export interface WithdrawalDecisionContext {
  adminId: string;
  role: 'super_admin' | 'ad_reviewer' | 'support' | 'finance';
  ip?: string;
}

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly ledger: LedgerService,
    private readonly registry: PayoutProviderRegistry,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    private readonly notifications: NotificationService,
    private readonly kyc: KycService,
    private readonly destinations: DestinationsService,
    @InjectQueue(QUEUE_PAYOUTS) private readonly payoutQueue: Queue,
  ) {}

  /* ------------------------------- user API ------------------------------- */

  getConfig() {
    const p = this.config.platform;
    return {
      minWithdrawalEtb: p.minWithdrawalEtb,
      coinsPerEtb: p.coinsPerEtb,
      largeWithdrawalThresholdEtb: p.largeWithdrawalThresholdEtb,
      dailyRequestLimit: p.dailyWithdrawalRequestLimit,
      methods: (Object.keys(PAYOUT_METHOD_INFO) as PayoutMethod[]).map((method) => ({
        method,
        label: PAYOUT_METHOD_INFO[method].label,
        destinationHint: PAYOUT_METHOD_INFO[method].destinationHint,
        destinationKind: PAYOUT_METHOD_INFO[method].destinationKind,
        available: this.registry.isMethodAvailable(method),
      })),
      conversionNote: `${p.coinsPerEtb} coins = 1 ETB. Minimum withdrawal ${p.minWithdrawalEtb} ETB. First withdrawals and amounts of ${p.largeWithdrawalThresholdEtb} ETB or more are reviewed manually before payout.`,
      kycRequiredAboveMonthlyEtb: p.kycRequiredAboveMonthlyEtb,
      destinationResolveTtlMinutes: p.destinationResolveTtlMinutes,
    };
  }

  /** Per-user config: static thresholds + this user's KYC tier, rolling payout total and known destinations. */
  async getConfigForUser(userId: string) {
    const [user, monthly, knownDestinations] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } }),
      this.kyc.monthlyPayoutTotalEtb(userId),
      this.destinations.listKnown(userId),
    ]);
    return {
      ...this.getConfig(),
      kycTier: user.kycTier,
      monthlyPayoutTotalEtb: monthly,
      knownDestinations,
    };
  }

  async request(userId: string, dto: CreateWithdrawalDto, ip: string) {
    const p = this.config.platform;
    const amountEtb = new Prisma.Decimal(dto.amountEtb).toDecimalPlaces(2);
    if (amountEtb.lessThan(p.minWithdrawalEtb)) {
      throw AppException.badRequest(
        ErrorCode.BELOW_MIN_WITHDRAWAL,
        `Minimum withdrawal is ${p.minWithdrawalEtb} ETB`,
        { minWithdrawalEtb: p.minWithdrawalEtb },
      );
    }
    const coinAmount = amountEtb.mul(p.coinsPerEtb).round().toNumber();
    // A known destination id stands in for the full number (clients never need to store/resend it).
    const known = dto.payoutDestinationId
      ? await this.destinations.findKnownById(userId, dto.payoutDestinationId, dto.payoutMethod)
      : null;
    const destination = known
      ? known.destination
      : this.validateDestination({
          payoutMethod: dto.payoutMethod,
          payoutDestination: dto.payoutDestination ?? '',
          destinationName: dto.destinationName,
          bankCode: dto.bankCode,
        });
    const bankCode = dto.bankCode ?? known?.bankCode ?? undefined;
    if (!this.registry.isMethodAvailable(dto.payoutMethod)) {
      throw new AppException(
        ErrorCode.PAYOUT_METHOD_UNAVAILABLE,
        'This payout method is temporarily unavailable',
        503,
      );
    }

    const rate = await this.redis.allow(
      `wd:${userId}:${utcDayKey()}`,
      p.dailyWithdrawalRequestLimit,
      secondsUntilEndOfUtcDay(),
    );
    if (!rate.allowed) {
      this.security.warn('withdrawal.rate_limited', { userId, count: rate.count, ip });
      throw AppException.rateLimited(
        ErrorCode.WITHDRAWAL_RATE_LIMITED,
        'Daily withdrawal request limit reached',
        { dailyRequestLimit: p.dailyWithdrawalRequestLimit },
      );
    }

    const requiresDualApproval = amountEtb.greaterThanOrEqualTo(p.largeWithdrawalThresholdEtb);

    /**
     * Security audit #12 (TOCTOU): one-in-flight, first-withdrawal and the KYC monthly cap are evaluated INSIDE the
     * transaction after locking the user row, so two concurrent requests serialise on the lock and the second one
     * sees the first. The partial unique index `withdrawals_one_in_flight_per_user` is the DB-level backstop.
     */
    const result = await this.prisma
      .$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<
          Array<{ trust_score: number; coin_balance: number; kyc_tier: 'phone_only' | 'id_verified' }>
        >`SELECT trust_score, coin_balance, kyc_tier FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (!locked) throw AppException.notFound('User not found');
        const [inFlight, completedCount] = await Promise.all([
          tx.withdrawal.count({ where: { userId, status: { in: [...IN_FLIGHT_WITHDRAWAL_STATUSES] } } }),
          tx.withdrawal.count({ where: { userId, status: 'completed' } }),
        ]);
        if (inFlight > 0) {
          throw AppException.conflict(ErrorCode.WITHDRAWAL_PENDING_EXISTS, 'You already have a withdrawal in progress');
        }
        if (locked.coin_balance < coinAmount) {
          throw AppException.unprocessable(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient coin balance', {
            coinBalance: locked.coin_balance,
            required: coinAmount,
          });
        }
        // KYC tier rule (rolling 30 days incl. this request) -> 422 KYC_REQUIRED, under the same lock
        await this.kyc.assertWithinTier(userId, locked.kyc_tier, amountEtb, tx);
        // Destination verification: known destinations pass; NEW ones need a fresh partner lookup + OTP re-check.
        const verifiedDestination =
          known ??
          (await this.destinations.assertVerifiedForRequest(userId, {
            payoutMethod: dto.payoutMethod,
            destination,
            bankCode,
          }));

        const reviewReasons = this.reviewReasons({
          isFirst: completedCount === 0,
          amountEtb,
          trustScore: locked.trust_score,
        });
        const status: WithdrawalStatus = reviewReasons.length ? 'flagged_for_review' : 'pending';

        const w = await tx.withdrawal.create({
          data: {
            userId,
            amountEtb,
            coinAmount,
            payoutMethod: dto.payoutMethod,
            payoutDestination: destination,
            destinationName: dto.destinationName?.trim() ?? verifiedDestination.accountName ?? undefined,
            bankCode: bankCode ?? verifiedDestination.bankCode ?? undefined,
            destinationAccountName: verifiedDestination.accountName,
            destinationVerifiedAt: verifiedDestination.verifiedAt,
            payoutDestinationId: verifiedDestination.id,
            status,
            reviewReasons,
            isFirstWithdrawal: completedCount === 0,
            requiresDualApproval,
          },
        });
        // Hold the coins immediately, atomically with the request (throws INSUFFICIENT_BALANCE -> rollback).
        const hold = await this.ledger.applyEntry(
          {
            userId,
            amount: -coinAmount,
            sourceType: 'withdrawal',
            sourceId: w.id,
            idempotencyKey: `withdrawal_hold:${w.id}`,
            description: `Withdrawal ${amountEtb.toFixed(2)} ETB via ${dto.payoutMethod}`,
          },
          tx,
        );
        const updated = await tx.withdrawal.update({
          where: { id: w.id },
          data: { ledgerHoldEntryId: hold.entry.id },
        });
        // the destination is now "known": no lookup / OTP re-check needed for future requests to it
        await this.destinations.markUsed(verifiedDestination.id, tx);
        await this.audit.record(
          {
            actorType: 'user',
            actorId: userId,
            action: 'withdrawal.requested',
            targetType: 'withdrawal',
            targetId: w.id,
            after: { status, amountEtb, coinAmount, reviewReasons, requiresDualApproval },
            ipAddress: ip,
          },
          tx,
        );
        return { withdrawal: updated, status, reviewReasons };
      })
      .catch((err: unknown) => {
        if (isOneInFlightViolation(err)) {
          throw AppException.conflict(ErrorCode.WITHDRAWAL_PENDING_EXISTS, 'You already have a withdrawal in progress');
        }
        throw err;
      });
    const { withdrawal, status, reviewReasons } = result;

    if (status === 'flagged_for_review') {
      this.security.warn('withdrawal.flagged_for_review', {
        withdrawalId: withdrawal.id,
        userId,
        amountEtb: amountEtb.toNumber(),
        reviewReasons,
        requiresDualApproval,
        ip,
      });
    } else {
      await this.enqueuePayout(withdrawal.id);
    }
    await this.notifications.notify({
      userId,
      type: 'withdrawal_status',
      title: status === 'pending' ? 'Withdrawal submitted' : 'Withdrawal under review',
      body:
        status === 'pending'
          ? `Your withdrawal of ${amountEtb.toFixed(2)} ETB is being processed.`
          : `Your withdrawal of ${amountEtb.toFixed(2)} ETB is being reviewed by our team. You will be notified once approved.`,
      data: { withdrawalId: withdrawal.id, status },
    });
    return this.toUserView(withdrawal, 0);
  }

  async listForUser(userId: string, query: { page?: number; limit?: number; status?: WithdrawalStatus }) {
    const p = pageArgs(query);
    const where: Prisma.WithdrawalWhereInput = { userId, status: query.status };
    const [rows, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: { _count: { select: { approvals: true } } },
      }),
      this.prisma.withdrawal.count({ where }),
    ]);
    return paginated(
      rows.map((w) => this.toUserView(w, w._count.approvals)),
      total,
      p,
    );
  }

  async getForUser(userId: string, id: string) {
    const w = await this.prisma.withdrawal.findFirst({
      where: { id, userId },
      include: { _count: { select: { approvals: true } } },
    });
    if (!w) throw AppException.notFound('Withdrawal not found');
    return this.toUserView(w, w._count.approvals);
  }

  /* ------------------------------- admin API ------------------------------- */

  async listForAdmin(query: { page?: number; limit?: number; status?: WithdrawalStatus; userId?: string }) {
    const p = pageArgs(query);
    const where: Prisma.WithdrawalWhereInput = { status: query.status, userId: query.userId };
    const [rows, total] = await Promise.all([
      this.prisma.withdrawal.findMany({
        where,
        orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
        skip: p.skip,
        take: p.take,
        include: adminInclude,
      }),
      this.prisma.withdrawal.count({ where }),
    ]);
    return paginated(
      rows.map((w) => this.toAdminView(w)),
      total,
      p,
    );
  }

  async getForAdmin(id: string) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id }, include: adminInclude });
    if (!w) throw AppException.notFound('Withdrawal not found');
    return this.toAdminView(w);
  }

  /**
   * Approve a withdrawal held for review. Large withdrawals need approvals from TWO DISTINCT finance/super_admin
   * accounts before they move to `pending` and are enqueued for payout.
   */
  async approve(id: string, ctx: WithdrawalDecisionContext, note?: string) {
    this.assertFinanceRole(ctx);
    const w = await this.prisma.withdrawal.findUnique({ where: { id }, include: { approvals: true } });
    if (!w) throw AppException.notFound('Withdrawal not found');
    if (!REVIEWABLE.includes(w.status))
      throw AppException.conflict(ErrorCode.WITHDRAWAL_NOT_REVIEWABLE, `Withdrawal is ${w.status}`);
    if (w.approvals.some((a) => a.adminId === ctx.adminId)) {
      this.security.warn('withdrawal.decision', {
        withdrawalId: id,
        adminId: ctx.adminId,
        blocked: 'same_admin_second_approval',
      });
      throw AppException.conflict(
        ErrorCode.DUAL_APPROVAL_SAME_ADMIN,
        'A different admin must provide the second approval',
      );
    }

    const required = w.requiresDualApproval ? 2 : 1;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.withdrawalApproval.create({
        data: { withdrawalId: id, adminId: ctx.adminId, decision: 'approved', note },
      });
      const approvals = await tx.withdrawalApproval.count({
        where: { withdrawalId: id, decision: 'approved' },
      });
      const released = approvals >= required;
      const updated = await tx.withdrawal.update({
        where: { id },
        data: released
          ? { status: 'pending', processedBy: ctx.adminId, reviewNote: note ?? w.reviewNote }
          : { reviewNote: note ?? w.reviewNote },
      });
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: ctx.adminId,
          action: released ? 'withdrawal.approved' : 'withdrawal.approval_recorded',
          targetType: 'withdrawal',
          targetId: id,
          before: { status: w.status, approvals: w.approvals.length },
          after: { status: updated.status, approvals, required },
          metadata: { note },
          ipAddress: ctx.ip,
        },
        tx,
      );
      return { updated, released, approvals, required };
    });

    this.security.info('withdrawal.decision', {
      withdrawalId: id,
      adminId: ctx.adminId,
      decision: 'approved',
      approvals: result.approvals,
      required,
      released: result.released,
    });
    if (result.released) {
      await this.enqueuePayout(id);
      await this.notifications.notify({
        userId: w.userId,
        type: 'withdrawal_status',
        title: 'Withdrawal approved',
        body: `Your withdrawal of ${w.amountEtb.toFixed(2)} ETB was approved and is being paid out.`,
        data: { withdrawalId: id, status: 'pending' },
      });
    }
    return this.getForAdmin(id);
  }

  /** Reject: refunds the held coins via a reversing ledger entry. */
  async reject(id: string, ctx: WithdrawalDecisionContext, reason: string) {
    this.assertFinanceRole(ctx);
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw AppException.notFound('Withdrawal not found');
    if (!REJECTABLE.includes(w.status))
      throw AppException.conflict(ErrorCode.WITHDRAWAL_NOT_REVIEWABLE, `Withdrawal is ${w.status}`);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: { id, status: { in: REJECTABLE } },
        data: {
          status: 'rejected',
          failureReason: `Rejected by admin: ${reason}`,
          processedAt: new Date(),
          processedBy: ctx.adminId,
          reviewNote: reason,
        },
      });
      if (claimed.count === 0)
        throw AppException.conflict(
          ErrorCode.WITHDRAWAL_NOT_REVIEWABLE,
          'Withdrawal changed state concurrently',
        );
      await tx.withdrawalApproval.upsert({
        where: { withdrawalId_adminId: { withdrawalId: id, adminId: ctx.adminId } },
        create: { withdrawalId: id, adminId: ctx.adminId, decision: 'rejected', note: reason },
        update: { decision: 'rejected', note: reason },
      });
      await this.reverseHold(tx, w, `Withdrawal rejected: ${reason}`);
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: ctx.adminId,
          action: 'withdrawal.rejected',
          targetType: 'withdrawal',
          targetId: id,
          before: { status: w.status },
          after: { status: 'rejected', reason },
          ipAddress: ctx.ip,
        },
        tx,
      );
    });
    this.security.info('withdrawal.decision', {
      withdrawalId: id,
      adminId: ctx.adminId,
      decision: 'rejected',
      reason,
    });
    await this.notifications.notify({
      userId: w.userId,
      type: 'withdrawal_status',
      title: 'Withdrawal rejected',
      body: `Your withdrawal of ${w.amountEtb.toFixed(2)} ETB was not approved. The coins have been returned to your balance.`,
      data: { withdrawalId: id, status: 'rejected' },
    });
    return this.getForAdmin(id);
  }

  /** Retry a failed payout: a fresh hold is taken (balance permitting) and the payout is re-queued. */
  async retry(id: string, ctx: WithdrawalDecisionContext) {
    this.assertFinanceRole(ctx);
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw AppException.notFound('Withdrawal not found');
    if (w.status !== 'failed')
      throw AppException.conflict(
        ErrorCode.WITHDRAWAL_NOT_REVIEWABLE,
        'Only failed withdrawals can be retried',
      );
    if (w.attempts >= this.config.env.PAYOUT_MAX_ATTEMPTS)
      throw AppException.conflict(ErrorCode.WITHDRAWAL_NOT_REVIEWABLE, 'Maximum payout attempts reached');

    await this.prisma.$transaction(async (tx) => {
      const hold = await this.ledger.applyEntry(
        {
          userId: w.userId,
          amount: -w.coinAmount,
          sourceType: 'withdrawal',
          sourceId: w.id,
          idempotencyKey: `withdrawal_hold:${w.id}:retry${w.attempts + 1}`,
          description: `Withdrawal retry ${w.amountEtb.toFixed(2)} ETB`,
        },
        tx,
      );
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: 'pending',
          failureReason: null,
          ledgerHoldEntryId: hold.entry.id,
          ledgerReversalEntryId: null,
          providerPayoutId: null,
          providerName: null,
          processedBy: ctx.adminId,
        },
      });
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: ctx.adminId,
          action: 'withdrawal.retried',
          targetType: 'withdrawal',
          targetId: id,
          before: { status: 'failed', attempts: w.attempts },
          after: { status: 'pending' },
          ipAddress: ctx.ip,
        },
        tx,
      );
    });
    await this.enqueuePayout(id);
    return this.getForAdmin(id);
  }

  /* --------------------------- worker callbacks --------------------------- */

  async markProcessing(id: string): Promise<Withdrawal | null> {
    const claimed = await this.prisma.withdrawal.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'processing', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return null;
    return this.prisma.withdrawal.findUnique({ where: { id } });
  }

  async markCompleted(id: string, raw: unknown) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w || w.status !== 'processing') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id },
        data: { status: 'completed', processedAt: new Date(), providerStatusRaw: toJson(raw) },
      });
      await this.audit.record(
        {
          actorType: 'system',
          action: 'withdrawal.completed',
          targetType: 'withdrawal',
          targetId: id,
          before: { status: 'processing' },
          after: { status: 'completed', provider: w.providerName, providerPayoutId: w.providerPayoutId },
        },
        tx,
      );
    });
    await this.notifications.notify({
      userId: w.userId,
      type: 'withdrawal_status',
      title: 'Withdrawal completed',
      body: `${w.amountEtb.toFixed(2)} ETB has been sent to your ${w.payoutMethod} account.`,
      data: { withdrawalId: id, status: 'completed' },
    });
  }

  /** Terminal failure: refund the hold with a reversing ledger entry and notify. */
  async markFailed(id: string, reason: string, raw?: unknown) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w || w.status !== 'processing') return;
    await this.prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id },
        data: {
          status: 'failed',
          failureReason: reason,
          processedAt: new Date(),
          providerStatusRaw: raw === undefined ? undefined : toJson(raw),
        },
      });
      await this.reverseHold(tx, w, `Payout failed: ${reason}`);
      await this.audit.record(
        {
          actorType: 'system',
          action: 'withdrawal.failed',
          targetType: 'withdrawal',
          targetId: id,
          before: { status: 'processing' },
          after: { status: 'failed', reason },
        },
        tx,
      );
    });
    this.security.warn('withdrawal.payout_failed', {
      withdrawalId: id,
      userId: w.userId,
      provider: w.providerName,
      reason,
      attempts: w.attempts,
    });
    await this.notifications.notify({
      userId: w.userId,
      type: 'withdrawal_status',
      title: 'Withdrawal failed',
      body: `We could not complete your withdrawal of ${w.amountEtb.toFixed(2)} ETB. The coins have been returned to your balance; please try again.`,
      data: { withdrawalId: id, status: 'failed' },
    });
  }

  /**
   * The partner's outcome is unknown (#7): park the withdrawal with the coins STILL HELD. Finance confirms the
   * transfer with the partner and resolves it via `resolveManualReview`. Never refunds automatically.
   */
  async markNeedsManualReview(id: string, reason: string, raw?: unknown) {
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w || w.status !== 'processing') return;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: { id, status: 'processing' },
        data: {
          status: 'needs_manual_review',
          failureReason: reason,
          providerStatusRaw: raw === undefined ? undefined : toJson(raw),
        },
      });
      if (claimed.count === 0) return;
      await this.audit.record(
        {
          actorType: 'system',
          action: 'withdrawal.needs_manual_review',
          targetType: 'withdrawal',
          targetId: id,
          before: { status: 'processing' },
          after: { status: 'needs_manual_review', reason, provider: w.providerName, providerPayoutId: w.providerPayoutId },
        },
        tx,
      );
    });
    this.security.error('payout.outcome_unknown', {
      withdrawalId: id,
      userId: w.userId,
      provider: w.providerName,
      providerPayoutId: w.providerPayoutId,
      amountEtb: w.amountEtb.toNumber(),
      reason,
    });
    await this.notifications.notify({
      userId: w.userId,
      type: 'withdrawal_status',
      title: 'Withdrawal being verified',
      body: `We are confirming your withdrawal of ${w.amountEtb.toFixed(2)} ETB with the payout partner. Your coins stay reserved until it is confirmed.`,
      data: { withdrawalId: id, status: 'needs_manual_review' },
    });
  }

  /**
   * Finance resolution of a `needs_manual_review` withdrawal after checking the partner's records:
   * `completed` = the money reached the user (coins stay debited); `failed` = the partner never paid (coins refunded,
   * admin may retry). Both are audited with the stated reason / partner reference.
   */
  async resolveManualReview(
    id: string,
    ctx: WithdrawalDecisionContext,
    input: { outcome: 'completed' | 'failed'; reason: string; providerReference?: string },
  ) {
    this.assertFinanceRole(ctx);
    const w = await this.prisma.withdrawal.findUnique({ where: { id } });
    if (!w) throw AppException.notFound('Withdrawal not found');
    if (w.status !== 'needs_manual_review') {
      throw AppException.conflict(ErrorCode.WITHDRAWAL_NOT_REVIEWABLE, `Withdrawal is ${w.status}, not needs_manual_review`);
    }
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: { id, status: 'needs_manual_review' },
        data: {
          status: input.outcome,
          processedAt: new Date(),
          processedBy: ctx.adminId,
          reviewNote: input.reason,
          failureReason: input.outcome === 'failed' ? `Partner confirmed failure: ${input.reason}` : null,
          providerPayoutId: input.providerReference ?? w.providerPayoutId,
        },
      });
      if (claimed.count === 0) throw AppException.conflict(ErrorCode.WITHDRAWAL_NOT_REVIEWABLE, 'Withdrawal changed state concurrently');
      if (input.outcome === 'failed') await this.reverseHold(tx, w, `Manual review: partner confirmed no payout (${input.reason})`);
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: ctx.adminId,
          action: `withdrawal.manual_review_${input.outcome}`,
          targetType: 'withdrawal',
          targetId: id,
          before: { status: 'needs_manual_review', provider: w.providerName, providerPayoutId: w.providerPayoutId },
          after: { status: input.outcome, reason: input.reason, providerReference: input.providerReference ?? null },
          ipAddress: ctx.ip,
        },
        tx,
      );
    });
    this.security.warn('payout.manual_review_decided', { withdrawalId: id, adminId: ctx.adminId, outcome: input.outcome, reason: input.reason });
    await this.notifications.notify({
      userId: w.userId,
      type: 'withdrawal_status',
      title: input.outcome === 'completed' ? 'Withdrawal completed' : 'Withdrawal failed',
      body:
        input.outcome === 'completed'
          ? `${w.amountEtb.toFixed(2)} ETB has been confirmed as sent to your ${w.payoutMethod} account.`
          : `We could not complete your withdrawal of ${w.amountEtb.toFixed(2)} ETB. The coins have been returned to your balance.`,
      data: { withdrawalId: id, status: input.outcome },
    });
    return this.getForAdmin(id);
  }

  async setProvider(id: string, providerName: string, providerPayoutId: string, raw: unknown) {
    await this.prisma.withdrawal.update({
      where: { id },
      data: { providerName, providerPayoutId, providerStatusRaw: toJson(raw) },
    });
  }

  /* ------------------------------- helpers ------------------------------- */

  reviewReasons(input: { isFirst: boolean; amountEtb: Prisma.Decimal; trustScore: number }): string[] {
    const reasons: string[] = [];
    if (input.isFirst) reasons.push(REVIEW_REASON.firstWithdrawal);
    if (input.amountEtb.greaterThanOrEqualTo(this.config.platform.largeWithdrawalThresholdEtb))
      reasons.push(REVIEW_REASON.largeAmount);
    if (input.trustScore < 30) reasons.push(REVIEW_REASON.lowTrustScore);
    return reasons;
  }

  /**
   * Refund the CURRENTLY held coins. Keyed to the hold ledger entry being reversed (#6): after fail -> retry
   * (new hold) -> reject, the second reversal has its own key instead of replaying the first one and leaving the
   * user's coins held forever. A replay where a fresh reversal is expected aborts the transaction.
   */
  private async reverseHold(tx: Prisma.TransactionClient, w: Withdrawal, description: string) {
    const holdEntryId = w.ledgerHoldEntryId;
    if (!holdEntryId) {
      this.logger.error(`Withdrawal ${w.id} has no hold ledger entry to reverse`);
      throw AppException.conflict(ErrorCode.WITHDRAWAL_NOT_REVIEWABLE, 'Withdrawal has no hold to refund');
    }
    const reversal = await this.ledger.applyEntry(
      {
        userId: w.userId,
        amount: w.coinAmount,
        sourceType: 'withdrawal_reversal',
        sourceId: w.id,
        idempotencyKey: `withdrawal_reversal:${holdEntryId}`,
        description,
      },
      tx,
    );
    if (reversal.replayed) {
      this.security.error('ledger.write', {
        withdrawalId: w.id,
        holdEntryId,
        problem: 'reversal_replayed',
        detail: 'a reversal for this hold already exists; refusing to mark the withdrawal reversed twice',
      });
      throw AppException.conflict(ErrorCode.WITHDRAWAL_NOT_REVIEWABLE, 'This hold was already refunded');
    }
    await tx.withdrawal.update({ where: { id: w.id }, data: { ledgerReversalEntryId: reversal.entry.id } });
  }

  private async enqueuePayout(withdrawalId: string) {
    if (!this.config.env.QUEUES_ENABLED || this.config.isTest) return;
    try {
      await this.payoutQueue.add(
        'initiate',
        { withdrawalId },
        { jobId: `initiate-${withdrawalId}-${Date.now()}` },
      );
    } catch (err) {
      this.logger.error(`Could not enqueue payout for ${withdrawalId}: ${(err as Error).message}`);
    }
  }

  private assertFinanceRole(ctx: WithdrawalDecisionContext) {
    if (ctx.role !== 'finance' && ctx.role !== 'super_admin') {
      throw AppException.forbidden(
        ErrorCode.DUAL_APPROVAL_ROLE_REQUIRED,
        'Only finance or super_admin can decide withdrawals',
      );
    }
  }

  validateDestination(dto: {
    payoutMethod: PayoutMethod;
    payoutDestination: string;
    destinationName?: string;
    bankCode?: string;
  }): string {
    if (dto.payoutMethod === 'bank') {
      const acct = dto.payoutDestination.replace(/\s+/g, '');
      if (!/^\d{6,30}$/.test(acct))
        throw AppException.badRequest(
          ErrorCode.INVALID_PAYOUT_DESTINATION,
          'Enter a valid bank account number',
        );
      if (!dto.destinationName?.trim())
        throw AppException.badRequest(
          ErrorCode.INVALID_PAYOUT_DESTINATION,
          'Account holder name is required for bank transfers',
        );
      if (!dto.bankCode?.trim())
        throw AppException.badRequest(
          ErrorCode.INVALID_PAYOUT_DESTINATION,
          'bankCode is required for bank transfers',
        );
      return acct;
    }
    const phone = normalizeEthiopianPhone(dto.payoutDestination);
    if (!phone)
      throw AppException.badRequest(
        ErrorCode.INVALID_PAYOUT_DESTINATION,
        'Enter a valid Ethiopian mobile number',
      );
    return phone;
  }

  toUserView(w: Withdrawal, approvalsCount: number) {
    return {
      id: w.id,
      userId: w.userId,
      amountEtb: w.amountEtb,
      coinAmount: w.coinAmount,
      payoutMethod: w.payoutMethod,
      payoutDestination: maskDestination(w.payoutDestination),
      destinationName: w.destinationName,
      destinationAccountName: w.destinationAccountName,
      destinationVerifiedAt: w.destinationVerifiedAt,
      status: w.status,
      reviewReasons: (w.reviewReasons as string[]) ?? [],
      requiresDualApproval: w.requiresDualApproval,
      approvalsCount,
      failureReason: w.failureReason,
      providerName: w.providerName,
      providerPayoutId: w.providerPayoutId,
      requestedAt: w.requestedAt,
      processedAt: w.processedAt,
      updatedAt: w.updatedAt,
    };
  }

  toAdminView(w: WithdrawalForAdmin) {
    return {
      ...this.toUserView(w, w.approvals.filter((a) => a.decision === 'approved').length),
      user: w.user,
      isFirstWithdrawal: w.isFirstWithdrawal,
      approvals: w.approvals.map((a) => ({
        id: a.id,
        adminId: a.adminId,
        adminEmail: a.admin.email,
        decision: a.decision,
        note: a.note,
        createdAt: a.createdAt,
      })),
      payoutDestinationFull: w.payoutDestination,
      bankCode: w.bankCode,
      reviewNote: w.reviewNote,
      processedBy: w.processedBy,
      attempts: w.attempts,
    };
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}
