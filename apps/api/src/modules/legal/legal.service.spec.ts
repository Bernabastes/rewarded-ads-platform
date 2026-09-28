import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@rap/shared';
import { ConsentGuard } from '../../common/guards/consent.guard';
import { REQUIRE_CONSENT_KEY } from '../../common/decorators/auth.decorators';
import { mockAudit, mockPrisma, uuid } from '../../testing/test-utils';
import { LegalService } from './legal.service';

function ctx(auth: unknown, requireConsent = true): ExecutionContext {
  const handler = () => undefined;
  const cls = class {};
  if (requireConsent) Reflect.defineMetadata(REQUIRE_CONSENT_KEY, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ auth }) }),
  } as unknown as ExecutionContext;
}

describe('LegalService consent state', () => {
  let prisma: any;
  let legal: LegalService;
  const USER = uuid(1);

  beforeEach(() => {
    prisma = mockPrisma();
    legal = new LegalService(prisma, mockAudit());
    // current versions: terms 1.1 (published later than 1.0), privacy 1.0
    prisma.legalDocument.findMany.mockResolvedValue([
      { kind: 'terms', version: '1.1' },
      { kind: 'terms', version: '1.0' },
      { kind: 'privacy', version: '1.0' },
    ]);
  });

  it('reports every kind as required when nothing was accepted', async () => {
    prisma.userConsent.findMany.mockResolvedValue([]);
    const state = await legal.userConsentState(USER);
    expect(state.requiresConsent).toEqual(['terms', 'privacy']);
    expect(state.consents.find((c) => c.kind === 'terms')).toMatchObject({ currentVersion: '1.1', acceptedVersion: null, outdated: true });
  });

  it('a newer published version makes the account require consent again', async () => {
    prisma.userConsent.findMany.mockResolvedValue([
      { kind: 'terms', version: '1.0', acceptedAt: new Date('2026-01-01') },
      { kind: 'privacy', version: '1.0', acceptedAt: new Date('2026-01-01') },
    ]);
    const state = await legal.userConsentState(USER);
    expect(state.requiresConsent).toEqual(['terms']);
    expect(state.consents.find((c) => c.kind === 'terms')).toMatchObject({ acceptedVersion: '1.0', currentVersion: '1.1', outdated: true });
    expect(state.consents.find((c) => c.kind === 'privacy')).toMatchObject({ outdated: false });
  });

  it('accepting requires the CURRENT version (409 CONSENT_VERSION_OUTDATED otherwise)', async () => {
    await expect(legal.acceptUserConsent(USER, 'terms', '1.0', {})).rejects.toMatchObject({
      code: ErrorCode.CONSENT_VERSION_OUTDATED,
      details: { currentVersion: '1.1' },
    });
    prisma.userConsent.findMany.mockResolvedValue([{ kind: 'terms', version: '1.1', acceptedAt: new Date() }]);
    const state = await legal.acceptUserConsent(USER, 'terms', '1.1', { ip: '1.1.1.1' });
    expect(prisma.userConsent.upsert).toHaveBeenCalled();
    expect(state.requiresConsent).toEqual(['privacy']);
  });

  it('advertisers only need the terms', async () => {
    prisma.advertiserConsent.findMany.mockResolvedValue([]);
    const state = await legal.advertiserConsentState(uuid(2));
    expect(state.requiresConsent).toEqual(['terms']);
    expect(state.requiresTermsAcceptance).toBe(true);
    expect(state.currentTermsVersion).toBe('1.1');
  });

  it('with no published documents nothing is required (fresh installs keep working)', async () => {
    prisma.legalDocument.findMany.mockResolvedValue([]);
    prisma.userConsent.findMany.mockResolvedValue([]);
    legal.invalidate();
    const state = await legal.userConsentState(USER);
    expect(state.requiresConsent).toEqual([]);
  });
});

describe('ConsentGuard', () => {
  const legal = { missingConsents: jest.fn() } as unknown as LegalService;
  const guard = new ConsentGuard(new Reflector(), legal);

  beforeEach(() => jest.resetAllMocks());

  it('blocks users with outdated consent with 403 CONSENT_REQUIRED listing the kinds', async () => {
    (legal.missingConsents as jest.Mock).mockResolvedValue(['terms']);
    await expect(guard.canActivate(ctx({ subjectType: 'user', subjectId: uuid(1) }))).rejects.toMatchObject({
      code: ErrorCode.CONSENT_REQUIRED,
      status: 403,
      details: { requiresConsent: ['terms'] },
    });
  });

  it('passes users whose consent is current', async () => {
    (legal.missingConsents as jest.Mock).mockResolvedValue([]);
    await expect(guard.canActivate(ctx({ subjectType: 'user', subjectId: uuid(1) }))).resolves.toBe(true);
  });

  it('ignores handlers without @RequireConsent, admins and read-only impersonation sessions', async () => {
    (legal.missingConsents as jest.Mock).mockResolvedValue(['terms', 'privacy']);
    await expect(guard.canActivate(ctx({ subjectType: 'user', subjectId: uuid(1) }, false))).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ subjectType: 'admin', subjectId: uuid(2) }))).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx({ subjectType: 'user', subjectId: uuid(1), impersonation: { actorAdminId: uuid(3) } })),
    ).resolves.toBe(true);
    expect(legal.missingConsents).not.toHaveBeenCalled();
  });
});
