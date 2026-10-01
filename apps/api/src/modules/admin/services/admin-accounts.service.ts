import { Injectable } from '@nestjs/common';
import type { AdminRole, AdminUser } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { AppException } from '../../../common/errors/app.exception';
import { SecurityLogger } from '../../../infra/logger/logger.module';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TokenService } from '../../auth/token.service';

import { BCRYPT_ROUNDS } from '../../auth/password';
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export interface AdminActor {
  adminId: string;
  ip: string;
}

export function toAdminAccountItem(a: AdminUser) {
  return {
    id: a.id,
    email: a.email,
    fullName: a.fullName,
    role: a.role,
    active: a.active,
    mfaEnabled: Boolean(a.mfaEnabledAt),
    mustChangePassword: a.mustChangePassword,
    lastLoginAt: a.lastLoginAt,
    passwordChangedAt: a.passwordChangedAt,
    createdBy: a.createdBy,
    createdAt: a.createdAt,
  };
}

/** Random temporary password (letters + digits, no look-alikes) satisfying the password policy. */
export function generateTemporaryPassword(length = 16): string {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  // guarantee the letter+digit policy
  return `${out.slice(0, length - 2)}a7`;
}

/**
 * Security audit #5: super_admin-only management of admin accounts. Replaces "edit the seed / the database":
 * creation and password resets hand out a one-time temporary password with `mustChangePassword`, role changes
 * revoke every session of the target (tokens_invalid_before + refresh tokens) so the old role dies immediately,
 * and the platform can never be left without an active super_admin.
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly security: SecurityLogger,
  ) {}

  async list() {
    const admins = await this.prisma.adminUser.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] });
    return { data: admins.map(toAdminAccountItem), meta: { total: admins.length } };
  }

  async create(actor: AdminActor, input: { email: string; fullName: string; role: AdminRole }) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.adminUser.findUnique({ where: { email }, select: { id: true } })) {
      throw AppException.conflict(ErrorCode.EMAIL_ALREADY_REGISTERED, 'An admin with this email already exists');
    }
    const temporaryPassword = generateTemporaryPassword();
    const admin = await this.prisma.adminUser.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        role: input.role,
        passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
        mustChangePassword: true,
        createdBy: actor.adminId,
      },
    });
    this.security.info('admin.account_created', { actorAdminId: actor.adminId, adminId: admin.id, role: admin.role, ip: actor.ip });
    await this.audit.record({
      actorType: 'admin',
      actorId: actor.adminId,
      action: 'admin.account_created',
      targetType: 'admin',
      targetId: admin.id,
      after: { email: admin.email, role: admin.role, mustChangePassword: true },
      ipAddress: actor.ip,
    });
    return { admin: toAdminAccountItem(admin), temporaryPassword };
  }

  async changeRole(actor: AdminActor, targetId: string, role: AdminRole, reason: string) {
    const target = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (!target) throw AppException.notFound('Admin not found');
    if (target.role === role) return toAdminAccountItem(target);
    if (target.role === 'super_admin') await this.assertNotLastSuperAdmin(targetId);
    const updated = await this.prisma.adminUser.update({ where: { id: targetId }, data: { role } });
    // Audit #13: the embedded role claim must die with the old role.
    await this.tokens.revokeAllForSubject('admin', targetId, 'role_changed');
    this.security.warn('admin.role_changed', {
      actorAdminId: actor.adminId,
      adminId: targetId,
      from: target.role,
      to: role,
      ip: actor.ip,
    });
    await this.audit.record({
      actorType: 'admin',
      actorId: actor.adminId,
      action: 'admin.role_changed',
      targetType: 'admin',
      targetId,
      before: { role: target.role },
      after: { role, reason },
      ipAddress: actor.ip,
    });
    return toAdminAccountItem(updated);
  }

  async resetPassword(actor: AdminActor, targetId: string) {
    const target = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (!target) throw AppException.notFound('Admin not found');
    const temporaryPassword = generateTemporaryPassword();
    const updated = await this.prisma.adminUser.update({
      where: { id: targetId },
      data: {
        passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
    });
    await this.tokens.revokeAllForSubject('admin', targetId, 'password_reset');
    this.security.warn('admin.password_reset', { actorAdminId: actor.adminId, adminId: targetId, ip: actor.ip });
    await this.audit.record({
      actorType: 'admin',
      actorId: actor.adminId,
      action: 'admin.password_reset',
      targetType: 'admin',
      targetId,
      after: { mustChangePassword: true },
      ipAddress: actor.ip,
    });
    return { admin: toAdminAccountItem(updated), temporaryPassword };
  }

  async setActive(actor: AdminActor, targetId: string, active: boolean, reason: string) {
    const target = await this.prisma.adminUser.findUnique({ where: { id: targetId } });
    if (!target) throw AppException.notFound('Admin not found');
    if (targetId === actor.adminId && !active) {
      throw AppException.conflict(ErrorCode.CONFLICT, 'You cannot deactivate your own account');
    }
    if (!active && target.role === 'super_admin') await this.assertNotLastSuperAdmin(targetId);
    const updated = await this.prisma.adminUser.update({ where: { id: targetId }, data: { active } });
    if (!active) await this.tokens.revokeAllForSubject('admin', targetId, 'deactivated');
    await this.audit.record({
      actorType: 'admin',
      actorId: actor.adminId,
      action: active ? 'admin.activated' : 'admin.deactivated',
      targetType: 'admin',
      targetId,
      before: { active: target.active },
      after: { active, reason },
      ipAddress: actor.ip,
    });
    return toAdminAccountItem(updated);
  }

  private async assertNotLastSuperAdmin(excludingId: string) {
    const others = await this.prisma.adminUser.count({
      where: { role: 'super_admin', active: true, id: { not: excludingId } },
    });
    if (others === 0) {
      throw AppException.conflict(
        ErrorCode.LAST_SUPER_ADMIN,
        'This change would leave the platform without an active super_admin',
      );
    }
  }
}
