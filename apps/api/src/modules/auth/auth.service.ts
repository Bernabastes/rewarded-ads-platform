import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Advertiser, AdminUser, Language } from '@prisma/client';
import { calculateAge, ErrorCode, normalizeEthiopianPhone } from '@rap/shared';
import bcrypt from 'bcryptjs';
import { AppException } from '../../common/errors/app.exception';
import { addSeconds, randomNumericCode, sha256 } from '../../common/utils';
import { AppConfig } from '../../config/app-config';
import { SecurityLogger } from '../../infra/logger/logger.module';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SMS_PROVIDER, type SmsProvider } from '../../infra/sms/sms.module';
import { AuditService } from '../audit/audit.service';
import { toUserProfile } from '../users/user.mapper';
import { TokenService } from './token.service';

const BCRYPT_ROUNDS = 10;

export function toAdvertiserProfile(a: Advertiser) {
  return {
    id: a.id,
    businessName: a.businessName,
    businessRegistrationNumber: a.businessRegistrationNumber,
    contactEmail: a.contactEmail,
    contactPhone: a.contactPhone,
    verificationStatus: a.verificationStatus,
    verificationNote: a.verificationNote,
    walletBalanceEtb: a.walletBalanceEtb,
    createdAt: a.createdAt,
  };
}

export function toAdminProfile(a: AdminUser) {
  return {
    id: a.id,
    email: a.email,
    fullName: a.fullName,
    role: a.role,
    active: a.active,
    lastLoginAt: a.lastLoginAt,
    createdAt: a.createdAt,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfig,
    private readonly tokens: TokenService,
    private readonly security: SecurityLogger,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /* ------------------------------ users: OTP ------------------------------ */

  async requestOtp(rawPhone: string, ip: string) {
    const phone = this.normalizePhone(rawPhone);
    const e = this.config.env;

    const [perPhone, perIp] = await Promise.all([
      this.redis.allow(`otp:phone:${phone}`, e.OTP_RATE_LIMIT_PER_PHONE_PER_HOUR, 3600),
      this.redis.allow(`otp:ip:${ip}`, e.OTP_RATE_LIMIT_PER_IP_PER_HOUR, 3600),
    ]);
    if (!perPhone.allowed || !perIp.allowed) {
      this.security.warn('otp.rate_limited', { phone, ip, perPhone: perPhone.count, perIp: perIp.count });
      throw AppException.rateLimited(ErrorCode.OTP_RATE_LIMITED, 'Too many OTP requests; try again later', {
        retryAfterSeconds: 3600,
      });
    }

    const recent = await this.prisma.otpCode.findFirst({
      where: {
        phoneNumber: phone,
        consumedAt: null,
        createdAt: { gte: addSeconds(new Date(), -e.OTP_RESEND_AFTER_SECONDS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      const retryAfter = Math.ceil(
        (recent.createdAt.getTime() + e.OTP_RESEND_AFTER_SECONDS * 1000 - Date.now()) / 1000,
      );
      throw AppException.rateLimited(
        ErrorCode.OTP_RATE_LIMITED,
        'An OTP was sent recently; wait before requesting again',
        {
          retryAfterSeconds: Math.max(1, retryAfter),
        },
      );
    }

    const code = randomNumericCode(e.OTP_LENGTH);
    await this.prisma.otpCode.create({
      data: {
        phoneNumber: phone,
        codeHash: sha256(`${phone}:${code}`),
        expiresAt: addSeconds(new Date(), e.OTP_TTL_SECONDS),
        ipAddress: ip,
      },
    });
    await this.sms.sendOtp(phone, code, e.OTP_TTL_SECONDS);

    return {
      phoneNumber: phone,
      expiresInSeconds: e.OTP_TTL_SECONDS,
      resendAfterSeconds: e.OTP_RESEND_AFTER_SECONDS,
      ...(e.OTP_DEV_ECHO && !this.config.isProduction ? { devCode: code } : {}),
    };
  }

  async verifyOtp(
    input: { phoneNumber: string; code: string; deviceId?: string; deviceFingerprint?: string },
    meta: { ip: string; userAgent?: string },
  ) {
    const phone = this.normalizePhone(input.phoneNumber);
    const e = this.config.env;
    const now = new Date();

    const fixedCodeOk =
      Boolean(e.OTP_DEV_FIXED_CODE) && !this.config.isProduction && input.code === e.OTP_DEV_FIXED_CODE;
    if (!fixedCodeOk) {
      const otp = await this.prisma.otpCode.findFirst({
        where: { phoneNumber: phone, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!otp)
        throw AppException.unauthorized(
          ErrorCode.OTP_INVALID,
          'No pending verification code for this number',
        );
      if (otp.expiresAt < now)
        throw AppException.unauthorized(ErrorCode.OTP_EXPIRED, 'Verification code expired');
      if (otp.attempts >= e.OTP_MAX_ATTEMPTS) {
        this.security.warn('otp.too_many_attempts', { phone, ip: meta.ip });
        throw AppException.rateLimited(
          ErrorCode.OTP_TOO_MANY_ATTEMPTS,
          'Too many incorrect attempts; request a new code',
        );
      }
      if (otp.codeHash !== sha256(`${phone}:${input.code}`)) {
        await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
        throw AppException.unauthorized(ErrorCode.OTP_INVALID, 'Incorrect verification code', {
          attemptsRemaining: e.OTP_MAX_ATTEMPTS - otp.attempts - 1,
        });
      }
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: now } });
    }

    const existing = await this.prisma.user.findUnique({ where: { phoneNumber: phone } });
    if (existing?.status === 'banned')
      throw AppException.forbidden(ErrorCode.ACCOUNT_BANNED, 'Account banned');
    if (existing?.status === 'suspended')
      throw AppException.forbidden(ErrorCode.ACCOUNT_SUSPENDED, 'Account suspended');

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            lastLoginAt: now,
            lastIp: meta.ip,
            phoneVerifiedAt: existing.phoneVerifiedAt ?? now,
            deviceId: input.deviceId ?? existing.deviceId,
          },
        })
      : await this.prisma.user.create({
          data: {
            phoneNumber: phone,
            phoneVerifiedAt: now,
            lastLoginAt: now,
            lastIp: meta.ip,
            deviceId: input.deviceId,
          },
        });

    if (existing?.ageVerificationStatus === 'rejected') {
      throw AppException.forbidden(ErrorCode.AGE_RESTRICTED, 'You must be at least 18 to use this service');
    }

    const tokens = await this.tokens.issue({ type: 'user', id: user.id }, meta);
    return { tokens, user: toUserProfile(user), isNewUser: !existing };
  }

  async completeProfile(
    userId: string,
    input: { fullName: string; dateOfBirth: string; languagePreference?: Language },
    ip: string,
  ) {
    const dob = new Date(`${input.dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'dateOfBirth is invalid');
    }
    const age = calculateAge(dob);
    if (age > 120) throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'dateOfBirth is not plausible');

    const minAge = this.config.platform.minAge;
    const verified = age >= minAge;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: input.fullName.trim(),
        dateOfBirth: dob,
        ageVerificationStatus: verified ? 'verified_adult' : 'rejected',
        languagePreference: input.languagePreference,
        ...(verified ? {} : { statusReason: `age_restricted:${age}` }),
      },
    });

    if (!verified) {
      this.security.warn('age.restricted', { userId, age, ip });
      await this.audit.record({
        actorType: 'system',
        action: 'user.age_restricted',
        targetType: 'user',
        targetId: userId,
        after: { age, minAge },
        ipAddress: ip,
      });
      await this.tokens.revokeAllForSubject('user', userId);
      throw AppException.forbidden(
        ErrorCode.AGE_RESTRICTED,
        `You must be at least ${minAge} years old to use this service`,
        {
          minAge,
        },
      );
    }
    return toUserProfile(user);
  }

  /* --------------------------- advertisers & admins --------------------------- */

  async registerAdvertiser(
    input: {
      businessName: string;
      businessRegistrationNumber: string;
      contactEmail: string;
      contactPhone: string;
      password: string;
    },
    meta: { ip: string; userAgent?: string },
  ) {
    const email = input.contactEmail.trim().toLowerCase();
    const clash = await this.prisma.advertiser.findFirst({
      where: {
        OR: [
          { contactEmail: email },
          { businessRegistrationNumber: input.businessRegistrationNumber.trim() },
        ],
      },
      select: { contactEmail: true },
    });
    if (clash) {
      throw AppException.conflict(
        ErrorCode.EMAIL_ALREADY_REGISTERED,
        'An advertiser with this email or registration number already exists',
      );
    }
    const advertiser = await this.prisma.advertiser.create({
      data: {
        businessName: input.businessName.trim(),
        businessRegistrationNumber: input.businessRegistrationNumber.trim(),
        contactEmail: email,
        contactPhone: input.contactPhone.trim(),
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      },
    });
    await this.audit.record({
      actorType: 'advertiser',
      actorId: advertiser.id,
      action: 'advertiser.registered',
      targetType: 'advertiser',
      targetId: advertiser.id,
      after: toAdvertiserProfile(advertiser),
      ipAddress: meta.ip,
    });
    const tokens = await this.tokens.issue({ type: 'advertiser', id: advertiser.id }, meta);
    return { tokens, advertiser: toAdvertiserProfile(advertiser) };
  }

  async loginAdvertiser(email: string, password: string, meta: { ip: string; userAgent?: string }) {
    const advertiser = await this.prisma.advertiser.findUnique({
      where: { contactEmail: email.trim().toLowerCase() },
    });
    if (!advertiser || !(await bcrypt.compare(password, advertiser.passwordHash))) {
      this.security.warn('auth.invalid_credentials', { subjectType: 'advertiser', email, ip: meta.ip });
      throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }
    const tokens = await this.tokens.issue({ type: 'advertiser', id: advertiser.id }, meta);
    return { tokens, advertiser: toAdvertiserProfile(advertiser) };
  }

  async loginAdmin(email: string, password: string, meta: { ip: string; userAgent?: string }) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      this.security.warn('auth.invalid_credentials', { subjectType: 'admin', email, ip: meta.ip });
      throw AppException.unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }
    if (!admin.active) throw AppException.forbidden(ErrorCode.ADMIN_INACTIVE, 'Admin account deactivated');
    const updated = await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    const tokens = await this.tokens.issue({ type: 'admin', id: admin.id, role: admin.role }, meta);
    return { tokens, admin: toAdminProfile(updated) };
  }

  async refresh(refreshToken: string, meta: { ip: string; userAgent?: string }) {
    const { tokens } = await this.tokens.rotate(refreshToken, meta);
    return tokens;
  }

  async logout(refreshToken: string) {
    await this.tokens.revoke(refreshToken);
  }

  normalizePhone(raw: string): string {
    const normalized = normalizeEthiopianPhone(raw);
    if (!normalized)
      throw AppException.badRequest(ErrorCode.INVALID_PHONE_NUMBER, 'Enter a valid Ethiopian mobile number');
    return normalized;
  }

  static async hashPassword(password: string) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }
}
