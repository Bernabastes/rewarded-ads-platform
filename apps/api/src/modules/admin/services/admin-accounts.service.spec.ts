import { ErrorCode } from '@rap/shared';
import bcrypt from 'bcryptjs';
import { mockAudit, mockPrisma, mockSecurity, uuid } from '../../../testing/test-utils';
import { AdminAccountsService, generateTemporaryPassword } from './admin-accounts.service';

const SUPER = uuid(1);
const TARGET = uuid(2);
const actor = { adminId: SUPER, ip: '1.1.1.1' };

describe('AdminAccountsService (security audit #5)', () => {
  let prisma: any;
  let tokens: any;
  let audit: any;
  let security: any;
  let service: AdminAccountsService;

  const row = (over: Record<string, unknown> = {}) => ({
    id: TARGET,
    email: 'reviewer@rap.et',
    fullName: 'Reviewer',
    role: 'ad_reviewer',
    active: true,
    passwordHash: 'h',
    mfaSecret: null,
    mfaEnabledAt: null,
    mustChangePassword: false,
    passwordChangedAt: null,
    createdBy: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    prisma = mockPrisma();
    tokens = { revokeAllForSubject: jest.fn() };
    audit = mockAudit();
    security = mockSecurity();
    service = new AdminAccountsService(prisma, tokens, audit, security);
    prisma.adminUser.update.mockImplementation(async ({ data }: any) => row(data));
  });

  it('temporary passwords satisfy the policy (16 chars, letter + digit) and are never reused', () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).toHaveLength(16);
    expect(a).toMatch(/[A-Za-z]/);
    expect(a).toMatch(/\d/);
    expect(a).not.toBe(b);
  });

  it('create: hashes a one-time temporary password, sets mustChangePassword and records who created the account', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(null);
    prisma.adminUser.create.mockImplementation(async ({ data }: any) => row({ ...data, id: TARGET }));
    const res = await service.create(actor, { email: ' New.Admin@RAP.et ', fullName: ' Hana ', role: 'finance' });
    expect(res.temporaryPassword).toHaveLength(16);
    const data = prisma.adminUser.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ email: 'new.admin@rap.et', fullName: 'Hana', role: 'finance', mustChangePassword: true, createdBy: SUPER });
    expect(data.passwordHash).not.toContain(res.temporaryPassword);
    expect(await bcrypt.compare(res.temporaryPassword, data.passwordHash)).toBe(true);
    expect(res.admin).not.toHaveProperty('passwordHash');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.account_created', targetId: TARGET }));
    expect(security.info).toHaveBeenCalledWith('admin.account_created', expect.objectContaining({ role: 'finance' }));
  });

  it('create: duplicate e-mail → 409 EMAIL_ALREADY_REGISTERED', async () => {
    prisma.adminUser.findUnique.mockResolvedValue({ id: TARGET });
    await expect(service.create(actor, { email: 'reviewer@rap.et', fullName: 'X', role: 'support' })).rejects.toMatchObject({
      code: ErrorCode.EMAIL_ALREADY_REGISTERED,
    });
  });

  it('changeRole: updates the role, revokes every session (tokens_invalid_before) and audits before/after', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(row());
    const res = await service.changeRole(actor, TARGET, 'finance', 'moved to finance team');
    expect(res.role).toBe('finance');
    expect(tokens.revokeAllForSubject).toHaveBeenCalledWith('admin', TARGET, 'role_changed');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.role_changed', before: { role: 'ad_reviewer' }, after: { role: 'finance', reason: 'moved to finance team' } }),
    );
    expect(security.warn).toHaveBeenCalledWith('admin.role_changed', expect.objectContaining({ from: 'ad_reviewer', to: 'finance' }));
  });

  it('changeRole / deactivate refuse to remove the last active super_admin (409 LAST_SUPER_ADMIN)', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(row({ id: SUPER, role: 'super_admin' }));
    prisma.adminUser.count.mockResolvedValue(0);
    await expect(service.changeRole(actor, SUPER, 'support', 'demote')).rejects.toMatchObject({ code: ErrorCode.LAST_SUPER_ADMIN });
    await expect(service.setActive({ adminId: uuid(9), ip: '1.1.1.1' }, SUPER, false, 'leaving')).rejects.toMatchObject({ code: ErrorCode.LAST_SUPER_ADMIN });
    prisma.adminUser.count.mockResolvedValue(1);
    await expect(service.changeRole(actor, SUPER, 'support', 'demote')).resolves.toMatchObject({ role: 'support' });
  });

  it('resetPassword: new temporary password, mustChangePassword, all sessions revoked, audited', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(row());
    const res = await service.resetPassword(actor, TARGET);
    const data = prisma.adminUser.update.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(true);
    expect(await bcrypt.compare(res.temporaryPassword, data.passwordHash)).toBe(true);
    expect(tokens.revokeAllForSubject).toHaveBeenCalledWith('admin', TARGET, 'password_reset');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.password_reset' }));
  });

  it('setActive(false) revokes sessions; self-deactivation is refused', async () => {
    prisma.adminUser.findUnique.mockResolvedValue(row());
    await service.setActive(actor, TARGET, false, 'left the company');
    expect(tokens.revokeAllForSubject).toHaveBeenCalledWith('admin', TARGET, 'deactivated');
    prisma.adminUser.findUnique.mockResolvedValue(row({ id: SUPER, role: 'super_admin' }));
    await expect(service.setActive(actor, SUPER, false, 'oops')).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});
