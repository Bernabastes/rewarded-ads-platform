import type { LegalDocumentItem, UserProfile } from '@rap/shared';

import { consentFor, documentsToAccept, nextRouteAfterAuth, parseLegalMarkdown, remainingKinds } from '../consent';

const doc = (kind: 'terms' | 'privacy', version = '1.0'): LegalDocumentItem => ({
  id: `${kind}-${version}`,
  kind,
  version,
  locale: 'am',
  title: kind === 'terms' ? 'የGize የአገልግሎት ውል' : 'የGize የግላዊነት መግለጫ',
  url: `https://gize.app/legal/${kind}`,
  contentMarkdown: `# ${kind}\n\nBody`,
  publishedAt: '2026-09-01T00:00:00.000Z',
});

const user = (overrides: Partial<UserProfile>): Pick<UserProfile, 'profileComplete' | 'requiresConsent'> => ({
  profileComplete: true,
  requiresConsent: [],
  ...overrides,
});

describe('consent gating', () => {
  it('sends new users to complete-profile before anything else', () => {
    expect(nextRouteAfterAuth(user({ profileComplete: false, requiresConsent: ['terms', 'privacy'] }))).toBe('/complete-profile');
  });

  it('sends users with outstanding consent to the consent screen after the profile is complete', () => {
    expect(nextRouteAfterAuth(user({ requiresConsent: ['privacy'] }))).toBe('/consent');
  });

  it('lets fully consented users straight into the app', () => {
    expect(nextRouteAfterAuth(user({}))).toBe('/(tabs)');
    expect(nextRouteAfterAuth({ profileComplete: true, requiresConsent: undefined as never })).toBe('/(tabs)');
  });

  it('only shows the documents the server still requires', () => {
    const documents = [doc('terms'), doc('privacy')];
    expect(documentsToAccept(documents, ['privacy']).map((d) => d.kind)).toEqual(['privacy']);
    expect(documentsToAccept(documents, ['terms', 'privacy']).map((d) => d.kind)).toEqual(['terms', 'privacy']);
    // Re-reading from Profile → Legal: nothing required, show everything.
    expect(documentsToAccept(documents, []).map((d) => d.kind)).toEqual(['terms', 'privacy']);
  });

  it('tracks which kinds are still missing after partial acceptance', () => {
    expect(remainingKinds(['terms', 'privacy'], new Set(['terms']))).toEqual(['privacy']);
    expect(remainingKinds(['terms', 'privacy'], new Set(['terms', 'privacy']))).toEqual([]);
  });

  it('finds the stored consent for a kind', () => {
    const consents = [
      { kind: 'terms' as const, acceptedVersion: '1.0', currentVersion: '1.0', acceptedAt: '2026-09-29T14:31:05.124Z', outdated: false },
    ];
    expect(consentFor(consents, 'terms')?.acceptedVersion).toBe('1.0');
    expect(consentFor(consents, 'privacy')).toBeNull();
    expect(consentFor(undefined, 'terms')).toBeNull();
  });
});

describe('parseLegalMarkdown', () => {
  it('turns headings, paragraphs and bullets into blocks and strips inline emphasis', () => {
    const blocks = parseLegalMarkdown('# Title (v1.0)\n\nFirst **bold** line\ncontinues here.\n\n- one\n- _two_\n\n## Sub');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Title (v1.0)' },
      { type: 'paragraph', text: 'First bold line continues here.' },
      { type: 'bullet', text: 'one' },
      { type: 'bullet', text: 'two' },
      { type: 'heading', level: 2, text: 'Sub' },
    ]);
  });

  it('handles empty content', () => {
    expect(parseLegalMarkdown(null)).toEqual([]);
    expect(parseLegalMarkdown('')).toEqual([]);
  });
});
