import { Inject, Injectable } from '@nestjs/common';
import { type KycIdType, type KycStatus, type KycSubmission, Prisma } from '@prisma/client';
import { type EthiopianDate, ErrorCode, IN_FLIGHT_WITHDRAWAL_STATUSES, KYC_UPLOAD_LIMITS, type KycUploadKind } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { pageArgs, paginated } from '../../common/pagination';
import { sha256 } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PRIVATE_PREFIX, StorageService } from '../../infra/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notifications/notifications.module';
import { ID_VERIFICATION_PROVIDER, type IdVerificationProvider } from './id-verification.provider';

export interface KycAdminActor {
  adminId: string;
  ip?: string;
}

const userSelect = { id: true, phoneNumber: true, fullName: true, kycTier: true, trustScore: true, dateOfBirth: true };
const adminInclude = { user: { select: userSelect } } satisfies Prisma.KycSubmissionInclude;
type AdminRow = Prisma.KycSubmissionGetPayload<{ include: typeof adminInclude }>;

/** Statuses that count towards the rolling 30-day payout total (completed + in-flight, incl. needs_manual_review). */
export const MONTHLY_PAYOUT_STATUSES = ['completed', ...IN_FLIGHT_WITHDRAWAL_STATUSES] as const;

/**
 * KYC tiers (Feature 3). Everyone starts `phone_only`; an approved submission promotes the user to `id_verified`.
 * Documents live under the private storage prefix and are only ever exposed through 5-minute presigned links to
 * admins. The identity registry pre-check (mock Fayda) is advisory; the admin decision is authoritative.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
    private readonly notifications: NotificationService,
    private readonly auth: AuthService,
    @Inject(ID_VERIFICATION_PROVIDER) private readonly idVerification: IdVerificationProvider,
  ) {}

  /* ------------------------------ threshold rule ------------------------------ */

  /** Completed + in-flight payouts (ETB) requested in the rolling 30-day window. */
  async monthlyPayoutTotalEtb(userId: string, now = new Date()): Promise<Prisma.Decimal> {
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const agg = await this.prisma.withdrawal.aggregate({
      where: { userId, status: { in: [...MONTHLY_PAYOUT_STATUSES] }, requestedAt: { gte: since } },
      _sum: { amountEtb: true },
    });
    return agg._sum.amountEtb ?? new Prisma.Decimal(0);
  }

  /**
   * Pure rule: phone_only users must stay strictly below KYC_REQUIRED_ABOVE_MONTHLY_ETB (rolling 30 days incl. the new
   * request). The boundary is INCLUSIVE: a projected total equal to the threshold already requires KYC (owner decision,
   * Phase 4D). The env variable keeps its historical name for compatibility.
   * Returns null when allowed, else the error details.
   */
  evaluateThreshold(input: {
    kycTier: 'phone_only' | 'id_verified';
    monthlyTotalEtb: Prisma.Decimal | number;
    newAmountEtb: Prisma.Decimal | number;
    thresholdEtb?: number;
  }) {
    if (input.kycTier === 'id_verified') return null;
    const threshold = input.thresholdEtb ?? this.config.platform.kycRequiredAboveMonthlyEtb;
    const total = new Prisma.Decimal(input.monthlyTotalEtb).plus(input.newAmountEtb);
    if (total.lessThan(threshold)) return null;
    return {
      kycTier: input.kycTier,
      monthlyTotalEtb: new Prisma.Decimal(input.monthlyTotalEtb).toNumber(),
      requestedEtb: new Prisma.Decimal(input.newAmountEtb).toNumber(),
      thresholdEtb: threshold,
      projectedEtb: total.toNumber(),
    };
  }

  async assertWithinTier(userId: string, kycTier: 'phone_only' | 'id_verified', newAmountEtb: Prisma.Decimal) {
    const monthly = await this.monthlyPayoutTotalEtb(userId);
    const violation = this.evaluateThreshold({ kycTier, monthlyTotalEtb: monthly, newAmountEtb });
    if (violation) {
      this.security.warn('kyc.required', { userId, ...violation });
      throw AppException.unprocessable(
        ErrorCode.KYC_REQUIRED,
        `Payouts of ${violation.thresholdEtb} ETB or more per 30 days require identity verification`,
        violation,
      );
    }
    return monthly;
  }

  /* ------------------------------ user API ------------------------------ */

  async presignUpload(userId: string, input: { kind: KycUploadKind; contentType: string; sizeBytes: number }) {
    if (!(KYC_UPLOAD_LIMITS.mimeTypes as readonly string[]).includes(input.contentType)) {
      throw AppException.badRequest(ErrorCode.UPLOAD_TYPE_NOT_ALLOWED, 'Unsupported document type', {
        allowed: KYC_UPLOAD_LIMITS.mimeTypes,
      });
    }
    if (input.sizeBytes > KYC_UPLOAD_LIMITS.maxBytes) {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, `File too large (max ${KYC_UPLOAD_LIMITS.maxBytes} bytes)`);
    }
    const ext = input.contentType === 'application/pdf' ? 'pdf' : input.contentType.split('/')[1].replace('jpeg', 'jpg');
    const key = this.storage.buildKey(`${PRIVATE_PREFIX}/kyc/${userId}/${input.kind}`, `${input.kind}.${ext}`);
    const presigned = await this.storage.presignUpload(key, input.contentType, input.sizeBytes);
    return { ...presigned, kind: input.kind, publicUrl: '' };
  }

  async mine(userId: string) {
    const [user, submission, monthly] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { kycTier: true } }),
      this.prisma.kycSubmission.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.monthlyPayoutTotalEtb(userId),
    ]);
    return {
      kycTier: user.kycTier,
      submission: submission ? this.toItem(submission) : null,
      canSubmit: user.kycTier !== 'id_verified' && submission?.status !== 'pending',
      requiredAboveMonthlyEtb: this.config.platform.kycRequiredAboveMonthlyEtb,
      monthlyPayoutTotalEtb: monthly,
      uploadLimits: { maxBytes: KYC_UPLOAD_LIMITS.maxBytes, mimeTypes: KYC_UPLOAD_LIMITS.mimeTypes },
    };
  }

  async submit(
    userId: string,
    input: {
      idType: KycIdType;
      idNumber: string;
      fullName: string;
      dateOfBirth?: string;
      dateOfBirthEthiopian?: EthiopianDate;
      documentFrontKey: string;
      documentBackKey?: string;
      selfieKey: string;
    },
    ip: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.kycTier === 'id_verified') {
      throw AppException.conflict(ErrorCode.KYC_ALREADY_VERIFIED, 'Your identity is already verified');
    }
    const pending = await this.prisma.kycSubmission.findFirst({ where: { userId, status: 'pending' } });
    if (pending) {
      throw AppException.conflict(ErrorCode.KYC_SUBMISSION_PENDING, 'A submission is already under review', {
        submissionId: pending.id,
      });
    }
    for (const key of [input.documentFrontKey, input.documentBackKey, input.selfieKey]) {
      if (key && !key.startsWith(`${PRIVATE_PREFIX}/kyc/${userId}/`)) {
        throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Document keys must come from the KYC presign endpoint');
      }
    }
    const dob = this.auth.resolveDateOfBirth(input);
    const idNumber = input.idNumber.replace(/\s+/g, '');
    if (idNumber.length < 6) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'idNumber is too short');
    const idNumberHash = sha256(`${input.idType}:${idNumber}`);

    const duplicates = await this.prisma.kycSubmission.count({
      where: { idNumberHash, userId: { not: userId }, status: { in: ['pending', 'approved'] } },
    });
    const providerResult = await this.idVerification
      .verify({ idType: input.idType, idNumber, fullName: input.fullName.trim(), dateOfBirth: dob })
      .catch((err: Error) => ({
        provider: this.idVerification.name,
        mock: this.idVerification.isMock,
        found: false,
        score: 0,
        match: { fullName: false, dateOfBirth: false },
        error: err.message,
      }));

    const submission = await this.prisma.kycSubmission.create({
      data: {
        userId,
        idType: input.idType,
        idNumberHash,
        idNumberLast4: idNumber.slice(-4),
        fullName: input.fullName.trim(),
        dateOfBirth: dob,
        documentFrontKey: input.documentFrontKey,
        documentBackKey: input.documentBackKey,
        selfieKey: input.selfieKey,
        providerName: providerResult.provider,
        providerResult: { ...providerResult, duplicateIdentityUsers: duplicates } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      action: 'kyc.submitted',
      targetType: 'kyc_submission',
      targetId: submission.id,
      after: { idType: input.idType, idNumberLast4: submission.idNumberLast4, provider: providerResult },
      ipAddress: ip,
    });
    this.security.info('kyc.submitted', { userId, submissionId: submission.id, idType: input.idType, duplicates });
    if (duplicates > 0) {
      this.security.warn('kyc.duplicate_identity', { userId, submissionId: submission.id, duplicates });
      await this.prisma.fraudFlag.create({
        data: {
          userId,
          relatedEntityType: 'kyc_submission',
          relatedEntityId: submission.id,
          flagType: 'KYC_DUPLICATE_IDENTITY',
          severity: 'high',
          description: `The same identity document was submitted by ${duplicates} other account(s)`,
          metadata: { duplicates },
          trustScoreDelta: 0,
        },
      });
    }
    return this.toItem(submission);
  }

  /* ------------------------------ admin API ------------------------------ */

  async adminList(query: { page?: number; limit?: number; status?: KycStatus; idType?: KycIdType; q?: string }) {
    const p = pageArgs(query);
    const where: Prisma.KycSubmissionWhereInput = {
      status: query.status ?? 'pending',
      idType: query.idType,
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' } },
              { idNumberLast4: query.q.slice(-4) },
              { user: { phoneNumber: { contains: query.q.replace(/\s+/g, '') } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.kycSubmission.findMany({
        where,
        include: adminInclude,
        orderBy: { createdAt: 'asc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.kycSubmission.count({ where }),
    ]);
    return paginated(
      rows.map((r) => this.toAdminItem(r)),
      total,
      p,
    );
  }

  async adminDetail(id: string) {
    const row = await this.prisma.kycSubmission.findUnique({ where: { id }, include: adminInclude });
    if (!row) throw AppException.notFound('KYC submission not found');
    const ttl = this.config.env.KYC_DOCUMENT_URL_TTL_SECONDS;
    const [front, back, selfie, duplicates] = await Promise.all([
      this.storage.presignDownload(row.documentFrontKey, ttl),
      row.documentBackKey ? this.storage.presignDownload(row.documentBackKey, ttl) : Promise.resolve(null),
      this.storage.presignDownload(row.selfieKey, ttl),
      this.prisma.kycSubmission.findMany({
        where: { idNumberHash: row.idNumberHash, userId: { not: row.userId }, status: { in: ['pending', 'approved'] } },
        select: { status: true, user: { select: { id: true, phoneNumber: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    // one entry per other account (latest submission wins)
    const seen = new Set<string>();
    const duplicateIdentityUsers = duplicates
      .filter((d) => (seen.has(d.user.id) ? false : (seen.add(d.user.id), true)))
      .map((d) => ({ id: d.user.id, phoneNumber: d.user.phoneNumber, kycStatus: d.status }));
    return {
      ...this.toAdminItem(row),
      documents: { front, back, selfie },
      profileMatch: {
        fullName: normalizeName(row.fullName) === normalizeName(row.user.fullName ?? ''),
        dateOfBirth: Boolean(row.user.dateOfBirth) && sameDay(row.dateOfBirth, row.user.dateOfBirth!),
      },
      duplicateIdentityUsers,
      /** Kept for compatibility with clients that consumed the earlier numeric field. */
      duplicateIdentityCount: duplicateIdentityUsers.length,
    };
  }

  async decide(id: string, decision: 'approved' | 'rejected', actor: KycAdminActor, reason?: string, note?: string) {
    if (decision === 'rejected' && !reason?.trim()) {
      throw AppException.badRequest(ErrorCode.REJECTION_REASON_REQUIRED, 'A rejection reason is required');
    }
    const row = await this.prisma.kycSubmission.findUnique({ where: { id }, include: adminInclude });
    if (!row) throw AppException.notFound('KYC submission not found');
    if (row.status !== 'pending') {
      throw AppException.conflict(ErrorCode.KYC_NOT_PENDING, `Submission is already ${row.status}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.kycSubmission.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: decision,
          reviewedBy: actor.adminId,
          reviewedAt: new Date(),
          reason: decision === 'rejected' ? reason : note ?? null,
        },
      });
      if (claimed.count === 0) throw AppException.conflict(ErrorCode.KYC_NOT_PENDING, 'Submission changed state');
      if (decision === 'approved') {
        await tx.user.update({ where: { id: row.userId }, data: { kycTier: 'id_verified' } });
      }
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: actor.adminId,
          action: `kyc.${decision}`,
          targetType: 'kyc_submission',
          targetId: id,
          before: { status: 'pending', kycTier: row.user.kycTier },
          after: { status: decision, kycTier: decision === 'approved' ? 'id_verified' : row.user.kycTier, reason, note },
          ipAddress: actor.ip,
        },
        tx,
      );
      return tx.kycSubmission.findUniqueOrThrow({ where: { id }, include: adminInclude });
    });
    this.security.info('kyc.decision', { submissionId: id, userId: row.userId, decision, adminId: actor.adminId });
    await this.notifications.notify({
      userId: row.userId,
      type: 'kyc_status',
      title: decision === 'approved' ? 'Identity verified' : 'Identity verification not approved',
      body:
        decision === 'approved'
          ? 'Your identity has been verified. Higher monthly payout limits are now available.'
          : `We could not verify your identity: ${reason}. You can submit again with clearer documents.`,
      data: { submissionId: id, status: decision },
    });
    return this.toAdminItem(updated);
  }

  /* ------------------------------ mappers ------------------------------ */

  toItem(s: KycSubmission) {
    return {
      id: s.id,
      userId: s.userId,
      idType: s.idType,
      idNumberLast4: s.idNumberLast4,
      fullName: s.fullName,
      dateOfBirth: s.dateOfBirth.toISOString().slice(0, 10),
      status: s.status,
      providerName: s.providerName,
      providerResult: s.providerResult,
      reviewedAt: s.reviewedAt,
      reason: s.reason,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  toAdminItem(r: AdminRow) {
    const { dateOfBirth: _dob, ...user } = r.user;
    return { ...this.toItem(r), user, reviewedBy: r.reviewedBy };
  }

  async latestForUser(userId: string) {
    const row = await this.prisma.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: adminInclude,
    });
    return row ? this.toAdminItem(row) : null;
  }
}

function normalizeName(v: string) {
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameDay(a: Date, b: Date) {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
