import { Injectable } from '@nestjs/common';
import type { OtpPurpose } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { timingSafeEqual } from 'node:crypto';
import { AppException } from '../../common/errors/app.exception';
import { sha256 } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

export interface OtpVerifyInput {
  /** Normalised E.164 phone the code was sent to. */
  phone: string;
  purpose: OtpPurpose;
  /** The code as typed by the user. */
  code: string;
  /** Hash material convention of the issuing endpoint, e.g. `${phone}:${code}` or `${phone}:destination_change:${code}`. */
  hashInput: (code: string) => string;
  ip: string;
}

/**
 * Brute-force-resistant OTP verification shared by the login and destination-change endpoints
 * (security audit #4).
 *
 *  1. Redis fixed-window limits on VERIFY attempts per phone and per IP (OTP_VERIFY_LIMIT_PER_PHONE /
 *     OTP_VERIFY_LIMIT_PER_IP within OTP_VERIFY_WINDOW_SECONDS) -> 429 OTP_TOO_MANY_ATTEMPTS.
 *  2. The attempt is CLAIMED atomically (`UPDATE ... SET attempts = attempts + 1 WHERE id AND attempts < max AND
 *     consumed_at IS NULL`) BEFORE the comparison, so N parallel guesses can evaluate at most `max` codes.
 *  3. Once the cap is reached the code is burned (consumed) and a new one must be requested.
 *  4. The hash comparison is constant-time; a correct code is consumed atomically so two concurrent correct
 *     submissions cannot both succeed.
 */
@Injectable()
export class OtpVerifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly security: SecurityLogger,
  ) {}

  async verify(input: OtpVerifyInput): Promise<{ otpId: string }> {
    const e = this.config.env;
    const now = new Date();
    await this.assertVerifyAllowed(input.phone, input.ip, input.purpose);

    const otp = await this.prisma.otpCode.findFirst({
      where: { phoneNumber: input.phone, consumedAt: null, purpose: input.purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw AppException.badRequest(ErrorCode.OTP_INVALID, 'No pending verification code for this number');
    if (otp.expiresAt < now) throw AppException.badRequest(ErrorCode.OTP_EXPIRED, 'Verification code expired');

    // Atomic attempt claim: only `max` claims can ever succeed for one code, however many requests race.
    const claimed = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null, attempts: { lt: e.OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      await this.burn(otp.id);
      this.security.warn('otp.too_many_attempts', { phone: input.phone, ip: input.ip, purpose: input.purpose });
      throw AppException.rateLimited(ErrorCode.OTP_TOO_MANY_ATTEMPTS, 'Too many incorrect attempts; request a new code');
    }

    if (!constantTimeEqualHex(otp.codeHash, sha256(input.hashInput(input.code)))) {
      // Burn the code as soon as the last allowed attempt was used up.
      const burned = await this.prisma.otpCode.updateMany({
        where: { id: otp.id, consumedAt: null, attempts: { gte: e.OTP_MAX_ATTEMPTS } },
        data: { consumedAt: now },
      });
      const attemptsRemaining = burned.count > 0 ? 0 : Math.max(0, e.OTP_MAX_ATTEMPTS - otp.attempts - 1);
      if (burned.count > 0) {
        this.security.warn('otp.too_many_attempts', { phone: input.phone, ip: input.ip, purpose: input.purpose, burned: true });
      }
      throw AppException.badRequest(ErrorCode.OTP_INVALID, 'Incorrect verification code', { attemptsRemaining });
    }

    // Correct: consume exactly once (a concurrent correct submission loses the race and is refused).
    const consumed = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) {
      throw AppException.badRequest(ErrorCode.OTP_INVALID, 'This verification code was already used');
    }
    return { otpId: otp.id };
  }

  /** Verify-side throttle (the REQUEST side has its own limits). */
  async assertVerifyAllowed(phone: string, ip: string, purpose: OtpPurpose) {
    const e = this.config.env;
    const [perPhone, perIp] = await Promise.all([
      this.redis.allow(`otpv:${purpose}:phone:${phone}`, e.OTP_VERIFY_LIMIT_PER_PHONE, e.OTP_VERIFY_WINDOW_SECONDS),
      this.redis.allow(`otpv:${purpose}:ip:${ip}`, e.OTP_VERIFY_LIMIT_PER_IP, e.OTP_VERIFY_WINDOW_SECONDS),
    ]);
    if (!perPhone.allowed || !perIp.allowed) {
      this.security.warn('otp.verify_rate_limited', { phone, ip, purpose, perPhone: perPhone.count, perIp: perIp.count });
      throw AppException.rateLimited(ErrorCode.OTP_TOO_MANY_ATTEMPTS, 'Too many verification attempts; try again later', {
        retryAfterSeconds: e.OTP_VERIFY_WINDOW_SECONDS,
      });
    }
  }

  private async burn(otpId: string) {
    await this.prisma.otpCode.updateMany({ where: { id: otpId, consumedAt: null }, data: { consumedAt: new Date() } });
  }
}

/** Constant-time comparison of two hex digests (same algorithm => same length; a length mismatch is simply false). */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
