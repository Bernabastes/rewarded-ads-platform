import { Injectable } from '@nestjs/common';
import { type PayoutDestination, type PayoutMethod } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../../common/errors/app.exception';
import { addSeconds, maskDestination, randomNumericCode, sha256 } from '../../../common/utils';
import { AppConfig } from '../../../config/app-config';
import { SecurityLogger } from '../../../infra/logger/logger.module';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { RedisService } from '../../../infra/redis/redis.service';
import { SMS_PROVIDER, type SmsProvider } from '../../../infra/sms/sms.module';
import { Inject } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { OtpVerifier } from '../../auth/otp.verifier';
import { DestinationNotFoundError } from '../providers/payout-provider';
import { PayoutProviderRegistry } from '../providers/payout-provider.registry';

export interface DestinationInput {
  payoutMethod: PayoutMethod;
  /** Already normalised (E.164 phone / cleaned account number). */
  destination: string;
  bankCode?: string;
}

/**
 * Withdrawal destination verification (Feature 2).
 *
 *  1. `resolve()` asks the payout partner for the account holder name (MOCK: deterministic fake name) and records
 *     `verified_at` on the user's payout_destinations row.
 *  2. A NEW destination (never used for a successful request) additionally needs an OTP re-check
 *     (`purpose = destination_change`) within the same window.
 *  3. `assertVerifiedForRequest()` is called by WithdrawalsService.request(): known destinations pass; new ones must
 *     have both checks within DESTINATION_RESOLVE_TTL_MINUTES, else 422 DESTINATION_NOT_VERIFIED /
 *     DESTINATION_OTP_REQUIRED. On success the destination is marked used (=> known).
 */
@Injectable()
export class DestinationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly registry: PayoutProviderRegistry,
    private readonly redis: RedisService,
    private readonly security: SecurityLogger,
    private readonly audit: AuditService,
    private readonly otpVerifier: OtpVerifier,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  get ttlMs(): number {
    return this.config.platform.destinationResolveTtlMinutes * 60_000;
  }

  isFresh(at: Date | null, now = new Date()): boolean {
    return Boolean(at) && now.getTime() - at!.getTime() <= this.ttlMs;
  }

  async find(userId: string, input: DestinationInput): Promise<PayoutDestination | null> {
    return this.prisma.payoutDestination.findUnique({
      where: {
        userId_payoutMethod_destination: {
          userId,
          payoutMethod: input.payoutMethod,
          destination: input.destination,
        },
      },
    });
  }

  /**
   * Resolves a KNOWN destination by id for `POST /withdrawals { payoutDestinationId }`. Must belong to the user,
   * match the requested method and have been used for a successful request before (otherwise the client must go
   * through resolve + OTP with the full number).
   */
  async findKnownById(userId: string, id: string, payoutMethod: PayoutMethod): Promise<PayoutDestination> {
    const row = await this.prisma.payoutDestination.findFirst({ where: { id, userId } });
    if (!row) {
      throw AppException.badRequest(ErrorCode.INVALID_PAYOUT_DESTINATION, 'Unknown payout destination id', {
        payoutDestinationId: id,
      });
    }
    if (row.payoutMethod !== payoutMethod) {
      throw AppException.badRequest(
        ErrorCode.INVALID_PAYOUT_DESTINATION,
        `This destination belongs to the ${row.payoutMethod} method`,
        { payoutDestinationId: id, payoutMethod: row.payoutMethod },
      );
    }
    if (!row.lastUsedAt) {
      this.security.warn('destination.not_verified', { userId, method: payoutMethod, reason: 'id_not_known' });
      throw AppException.unprocessable(
        ErrorCode.DESTINATION_NOT_VERIFIED,
        'This destination has not been used yet; verify it with the full number first',
        { payoutDestinationId: id },
      );
    }
    return row;
  }

  /** Partner account lookup; upserts the destination with `verifiedAt = now`. */
  async resolve(userId: string, input: DestinationInput, ip?: string) {
    if (!this.registry.isMethodAvailable(input.payoutMethod)) {
      throw new AppException(ErrorCode.PAYOUT_METHOD_UNAVAILABLE, 'This payout method is temporarily unavailable', 503);
    }
    let resolved;
    try {
      resolved = await this.registry.resolveWithFailover(input.payoutMethod, input.destination, input.bankCode);
    } catch (err) {
      if (err instanceof DestinationNotFoundError) {
        this.security.warn('destination.not_verified', { userId, method: input.payoutMethod, reason: 'not_found', ip });
        throw AppException.unprocessable(
          ErrorCode.DESTINATION_NOT_FOUND,
          'The payout partner could not find an account for this destination',
          { payoutMethod: input.payoutMethod, destination: maskDestination(input.destination) },
        );
      }
      throw new AppException(ErrorCode.SERVICE_UNAVAILABLE, 'Account lookup is temporarily unavailable', 503);
    }
    const now = new Date();
    const row = await this.prisma.payoutDestination.upsert({
      where: {
        userId_payoutMethod_destination: {
          userId,
          payoutMethod: input.payoutMethod,
          destination: resolved.result.normalizedDestination,
        },
      },
      create: {
        userId,
        payoutMethod: input.payoutMethod,
        destination: resolved.result.normalizedDestination,
        bankCode: input.bankCode,
        accountName: resolved.result.accountName,
        providerName: resolved.provider.name,
        providerMock: resolved.provider.isMock,
        verifiedAt: now,
      },
      update: {
        bankCode: input.bankCode ?? undefined,
        accountName: resolved.result.accountName,
        providerName: resolved.provider.name,
        providerMock: resolved.provider.isMock,
        verifiedAt: now,
      },
    });
    this.security.info('destination.resolved', {
      userId,
      method: input.payoutMethod,
      provider: resolved.provider.name,
      mock: resolved.provider.isMock,
      known: Boolean(row.lastUsedAt),
      ip,
    });
    const known = Boolean(row.lastUsedAt);
    return {
      accountName: row.accountName!,
      normalizedDestination: row.destination,
      payoutMethod: row.payoutMethod,
      provider: resolved.provider.name,
      mock: resolved.provider.isMock,
      known,
      otpRequired: !known && !this.isFresh(row.otpVerifiedAt, now),
      validUntil: new Date(now.getTime() + this.ttlMs),
    };
  }

  /* ------------------------------ OTP re-check ------------------------------ */

  async requestOtp(userId: string, ip: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phoneNumber: true } });
    const e = this.config.env;
    const rate = await this.redis.allow(`otp:dest:${userId}`, e.OTP_RATE_LIMIT_PER_PHONE_PER_HOUR, 3600);
    if (!rate.allowed) {
      this.security.warn('otp.rate_limited', { phone: user.phoneNumber, ip, purpose: 'destination_change' });
      throw AppException.rateLimited(ErrorCode.OTP_RATE_LIMITED, 'Too many verification codes; try again later', {
        retryAfterSeconds: 3600,
      });
    }
    const recent = await this.prisma.otpCode.findFirst({
      where: {
        phoneNumber: user.phoneNumber,
        purpose: 'destination_change',
        consumedAt: null,
        createdAt: { gte: addSeconds(new Date(), -e.OTP_RESEND_AFTER_SECONDS) },
      },
    });
    if (recent) {
      throw AppException.rateLimited(ErrorCode.OTP_RATE_LIMITED, 'A code was sent recently; wait before requesting again', {
        retryAfterSeconds: e.OTP_RESEND_AFTER_SECONDS,
      });
    }
    const code = randomNumericCode(e.OTP_LENGTH);
    await this.prisma.otpCode.create({
      data: {
        phoneNumber: user.phoneNumber,
        purpose: 'destination_change',
        codeHash: sha256(`${user.phoneNumber}:destination_change:${code}`),
        expiresAt: addSeconds(new Date(), e.OTP_TTL_SECONDS),
        ipAddress: ip,
      },
    });
    await this.sms.sendOtp(user.phoneNumber, code, e.OTP_TTL_SECONDS);
    return {
      phoneNumber: maskDestination(user.phoneNumber),
      purpose: 'destination_change' as const,
      expiresInSeconds: e.OTP_TTL_SECONDS,
      resendAfterSeconds: e.OTP_RESEND_AFTER_SECONDS,
      ...(e.OTP_DEV_ECHO && !this.config.isProduction ? { devCode: code } : {}),
    };
  }

  async verifyOtp(userId: string, code: string, input: DestinationInput, ip: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phoneNumber: true } });
    const e = this.config.env;
    const now = new Date();
    const fixedOk = Boolean(e.OTP_DEV_FIXED_CODE) && !this.config.isProduction && code === e.OTP_DEV_FIXED_CODE;
    if (!fixedOk) {
      // Security audit #4: same throttled / atomic / constant-time verifier as the login OTP.
      await this.otpVerifier.verify({
        phone: user.phoneNumber,
        purpose: 'destination_change',
        code,
        hashInput: (c) => `${user.phoneNumber}:destination_change:${c}`,
        ip,
      });
    }
    const row = await this.prisma.payoutDestination.upsert({
      where: {
        userId_payoutMethod_destination: {
          userId,
          payoutMethod: input.payoutMethod,
          destination: input.destination,
        },
      },
      create: {
        userId,
        payoutMethod: input.payoutMethod,
        destination: input.destination,
        bankCode: input.bankCode,
        otpVerifiedAt: now,
      },
      update: { otpVerifiedAt: now, bankCode: input.bankCode ?? undefined },
    });
    this.security.info('destination.otp_verified', { userId, method: input.payoutMethod, ip });
    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      action: 'destination.otp_verified',
      targetType: 'payout_destination',
      targetId: row.id,
      after: { payoutMethod: row.payoutMethod, destination: maskDestination(row.destination) },
      ipAddress: ip,
    });
    return this.toItem(row);
  }

  /* ------------------------------ enforcement ------------------------------ */

  /**
   * Called by the withdrawal request. Returns the destination row so the withdrawal can snapshot the verified
   * account name; throws 422 when a NEW destination lacks a fresh lookup or OTP re-check.
   */
  async assertVerifiedForRequest(userId: string, input: DestinationInput, now = new Date()): Promise<PayoutDestination> {
    const row = await this.find(userId, input);
    const known = Boolean(row?.lastUsedAt);
    if (known) return row!;
    if (!row || !this.isFresh(row.verifiedAt, now)) {
      this.security.warn('destination.not_verified', { userId, method: input.payoutMethod, reason: 'resolve_missing' });
      throw AppException.unprocessable(
        ErrorCode.DESTINATION_NOT_VERIFIED,
        'Confirm the account name for this new destination first (POST /withdrawals/destinations/resolve)',
        { payoutMethod: input.payoutMethod, ttlMinutes: this.config.platform.destinationResolveTtlMinutes },
      );
    }
    if (!this.isFresh(row.otpVerifiedAt, now)) {
      this.security.warn('destination.not_verified', { userId, method: input.payoutMethod, reason: 'otp_missing' });
      throw AppException.unprocessable(
        ErrorCode.DESTINATION_OTP_REQUIRED,
        'Verify this new destination with the code sent to your phone first',
        { payoutMethod: input.payoutMethod, ttlMinutes: this.config.platform.destinationResolveTtlMinutes },
      );
    }
    return row;
  }

  async markUsed(id: string, tx: Parameters<AuditService['record']>[1] | undefined, now = new Date()) {
    const db = tx ?? this.prisma;
    await db.payoutDestination.update({
      where: { id },
      data: { lastUsedAt: now, useCount: { increment: 1 } },
    });
  }

  async listKnown(userId: string) {
    const rows = await this.prisma.payoutDestination.findMany({
      where: { userId },
      orderBy: [{ lastUsedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
    });
    return rows.map((r) => this.toItem(r));
  }

  toItem(r: PayoutDestination) {
    return {
      id: r.id,
      payoutMethod: r.payoutMethod,
      destination: maskDestination(r.destination),
      bankCode: r.bankCode,
      accountName: r.accountName,
      verifiedAt: r.verifiedAt,
      otpVerifiedAt: r.otpVerifiedAt,
      lastUsedAt: r.lastUsedAt,
      useCount: r.useCount,
      known: Boolean(r.lastUsedAt),
    };
  }
}
