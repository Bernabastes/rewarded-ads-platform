import type { LegalDocumentItem, LegalDocumentKind, UserConsentState, UserProfile } from '@rap/shared';

/** Where a signed-in user has to go next, evaluated after otp/verify, complete-profile and at launch. */
export type PostAuthRoute = '/complete-profile' | '/consent' | '/(tabs)';

export function nextRouteAfterAuth(user: Pick<UserProfile, 'profileComplete' | 'requiresConsent'>): PostAuthRoute {
  if (!user.profileComplete) return '/complete-profile';
  if ((user.requiresConsent?.length ?? 0) > 0) return '/consent';
  return '/(tabs)';
}

/**
 * The documents the consent screen must show: the current version of every kind the server still
 * requires. With an empty `requiresConsent` (re-reading from Profile → Legal) every document is listed.
 */
export function documentsToAccept(
  documents: LegalDocumentItem[],
  requiresConsent: readonly LegalDocumentKind[] | undefined,
): LegalDocumentItem[] {
  if (!requiresConsent || requiresConsent.length === 0) return documents;
  return documents.filter((doc) => requiresConsent.includes(doc.kind));
}

/** Kinds that still need a tap after the ones accepted so far in this session. */
export function remainingKinds(
  required: readonly LegalDocumentKind[],
  acceptedNow: ReadonlySet<LegalDocumentKind>,
): LegalDocumentKind[] {
  return required.filter((kind) => !acceptedNow.has(kind));
}

export function consentFor(consents: UserConsentState[] | undefined, kind: LegalDocumentKind) {
  return consents?.find((c) => c.kind === kind) ?? null;
}

/**
 * Renders the markdown subset used by the legal documents (`# heading`, `## heading`, paragraphs,
 * `- bullets`) into simple blocks for native rendering; anything else is shown as a paragraph.
 */
export type LegalBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string };

export function parseLegalMarkdown(markdown: string | null | undefined): LegalBlock[] {
  if (!markdown) return [];
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: stripInline(heading[2]) });
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ type: 'bullet', text: stripInline(bullet[1]) });
      continue;
    }
    paragraph.push(stripInline(line));
  }
  flush();
  return blocks;
}

/** Drops `**bold**` / `_italic_` markers (the Text primitive has no inline styling). */
function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2');
}
