import { Injectable, Logger } from '@nestjs/common';
import type { Language, LegalDocumentKind } from '@prisma/client';
import { ErrorCode } from '@rap/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export type ConsentAudience = 'user' | 'advertiser';

/** Which document kinds each audience must accept. Advertisers only sign the (advertiser) terms. */
export const REQUIRED_KINDS: Record<ConsentAudience, LegalDocumentKind[]> = {
  user: ['terms', 'privacy'],
  advertiser: ['terms'],
};

export interface ConsentState {
  kind: LegalDocumentKind;
  acceptedVersion: string | null;
  currentVersion: string | null;
  acceptedAt: Date | null;
  outdated: boolean;
}

const CACHE_TTL_MS = 60_000;

/**
 * Legal documents (terms / privacy) and consent records. "Current" = the latest published version per kind
 * (compared by publishedAt); consent is recorded per (kind, version), so publishing a new version makes every
 * account `requiresConsent` again until it is accepted. Money endpoints enforce this via ConsentGuard.
 */
@Injectable()
export class LegalService {
  private readonly logger = new Logger(LegalService.name);
  private cache: { at: number; versions: Map<LegalDocumentKind, string> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Latest published version per kind (cached for 60 s; publishing calls invalidate()). */
  async currentVersions(): Promise<Map<LegalDocumentKind, string>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.versions;
    const rows = await this.prisma.legalDocument.findMany({
      where: { publishedAt: { lte: new Date() } },
      orderBy: [{ publishedAt: 'desc' }],
      select: { kind: true, version: true },
    });
    const versions = new Map<LegalDocumentKind, string>();
    for (const row of rows) if (!versions.has(row.kind)) versions.set(row.kind, row.version);
    this.cache = { at: Date.now(), versions };
    return versions;
  }

  invalidate() {
    this.cache = null;
  }

  /** `GET /legal/current?locale=&audience=` - one document per kind in the requested locale (falls back to en/am). */
  async current(locale: Language = 'am', audience: ConsentAudience = 'user') {
    const versions = await this.currentVersions();
    const kinds = REQUIRED_KINDS[audience];
    const docs = await this.prisma.legalDocument.findMany({
      where: { OR: kinds.map((kind) => ({ kind, version: versions.get(kind) ?? '__none__' })) },
    });
    const documents = kinds
      .map((kind) => {
        const candidates = docs.filter((d) => d.kind === kind);
        return (
          candidates.find((d) => d.locale === locale) ??
          candidates.find((d) => d.locale === 'en') ??
          candidates.find((d) => d.locale === 'am') ??
          candidates[0]
        );
      })
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        version: d.version,
        locale: d.locale,
        title: d.title,
        url: d.url,
        contentMarkdown: d.contentMarkdown,
        publishedAt: d.publishedAt,
      }));
    return { locale, audience, documents };
  }

  /* ------------------------------ users ------------------------------ */

  async userConsentState(userId: string): Promise<{ consents: ConsentState[]; requiresConsent: LegalDocumentKind[] }> {
    const [versions, accepted] = await Promise.all([
      this.currentVersions(),
      this.prisma.userConsent.findMany({ where: { userId }, orderBy: { acceptedAt: 'desc' } }),
    ]);
    return this.buildState('user', versions, accepted);
  }

  async acceptUserConsent(
    userId: string,
    kind: LegalDocumentKind,
    version: string,
    meta: { ip?: string; deviceId?: string },
  ) {
    const current = (await this.currentVersions()).get(kind);
    if (!current) throw AppException.notFound(`No published ${kind} document`);
    if (current !== version) {
      throw AppException.conflict(
        ErrorCode.CONSENT_VERSION_OUTDATED,
        `Version ${version} is not the current ${kind} version`,
        { currentVersion: current },
      );
    }
    await this.prisma.userConsent.upsert({
      where: { userId_kind_version: { userId, kind, version } },
      create: { userId, kind, version, ipAddress: meta.ip, deviceId: meta.deviceId },
      update: { acceptedAt: new Date(), ipAddress: meta.ip, deviceId: meta.deviceId },
    });
    await this.audit.record({
      actorType: 'user',
      actorId: userId,
      action: 'consent.accepted',
      targetType: 'user',
      targetId: userId,
      after: { kind, version },
      ipAddress: meta.ip,
    });
    return this.userConsentState(userId);
  }

  /* ------------------------------ advertisers ------------------------------ */

  async advertiserConsentState(advertiserId: string) {
    const [versions, accepted] = await Promise.all([
      this.currentVersions(),
      this.prisma.advertiserConsent.findMany({ where: { advertiserId }, orderBy: { acceptedAt: 'desc' } }),
    ]);
    const state = this.buildState('advertiser', versions, accepted);
    const terms = state.consents.find((c) => c.kind === 'terms');
    return {
      ...state,
      acceptedTermsVersion: terms?.acceptedVersion ?? null,
      currentTermsVersion: terms?.currentVersion ?? null,
      requiresTermsAcceptance: state.requiresConsent.includes('terms'),
    };
  }

  async acceptAdvertiserConsent(advertiserId: string, kind: LegalDocumentKind, version: string, ip?: string) {
    const current = (await this.currentVersions()).get(kind);
    if (!current) throw AppException.notFound(`No published ${kind} document`);
    if (current !== version) {
      throw AppException.conflict(
        ErrorCode.CONSENT_VERSION_OUTDATED,
        `Version ${version} is not the current ${kind} version`,
        { currentVersion: current },
      );
    }
    await this.prisma.advertiserConsent.upsert({
      where: { advertiserId_kind_version: { advertiserId, kind, version } },
      create: { advertiserId, kind, version, ipAddress: ip },
      update: { acceptedAt: new Date(), ipAddress: ip },
    });
    await this.audit.record({
      actorType: 'advertiser',
      actorId: advertiserId,
      action: 'consent.accepted',
      targetType: 'advertiser',
      targetId: advertiserId,
      after: { kind, version },
      ipAddress: ip,
    });
    return this.advertiserConsentState(advertiserId);
  }

  /** Kinds the subject still has to accept (empty = all good). */
  async missingConsents(audience: ConsentAudience, subjectId: string): Promise<LegalDocumentKind[]> {
    const state =
      audience === 'user'
        ? await this.userConsentState(subjectId)
        : await this.advertiserConsentState(subjectId);
    return state.requiresConsent;
  }

  /** Publish a new version (seed / ops). Both locales should be published together. */
  async publish(input: {
    kind: LegalDocumentKind;
    version: string;
    locale: Language;
    title: string;
    url?: string;
    contentMarkdown?: string;
    publishedAt?: Date;
  }) {
    const doc = await this.prisma.legalDocument.upsert({
      where: { kind_version_locale: { kind: input.kind, version: input.version, locale: input.locale } },
      create: { ...input, publishedAt: input.publishedAt ?? new Date() },
      update: { title: input.title, url: input.url, contentMarkdown: input.contentMarkdown },
    });
    this.invalidate();
    this.logger.log(`Legal document published: ${input.kind} v${input.version} (${input.locale})`);
    return doc;
  }

  private buildState(
    audience: ConsentAudience,
    versions: Map<LegalDocumentKind, string>,
    accepted: Array<{ kind: LegalDocumentKind; version: string; acceptedAt: Date }>,
  ) {
    const consents: ConsentState[] = REQUIRED_KINDS[audience].map((kind) => {
      const current = versions.get(kind) ?? null;
      const match = current ? accepted.find((a) => a.kind === kind && a.version === current) : undefined;
      const latestAccepted = accepted.find((a) => a.kind === kind);
      return {
        kind,
        acceptedVersion: latestAccepted?.version ?? null,
        currentVersion: current,
        acceptedAt: match?.acceptedAt ?? latestAccepted?.acceptedAt ?? null,
        // no published document => nothing to accept (fresh installs without seeded legal docs keep working)
        outdated: Boolean(current) && !match,
      };
    });
    return { consents, requiresConsent: consents.filter((c) => c.outdated).map((c) => c.kind) };
  }
}
